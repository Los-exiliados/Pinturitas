// Motor visual de Pinceladas de Vida.
//
// Carga una pintura del catálogo (js/obras.js) y la representa en un lienzo
// de p5.js en modo instancia con WEBGL: una malla texturizada de 60×40 que
// permite deformaciones localizadas por zona.
//
// Interacciones:
//   - Índice extendido: los remolinos giran sobre sí mismos como un molino
//     de viento, con arranque y freno suaves.
//   - Paz: lluvia de meteoritos que rebotan dentro del lienzo.
//   - Pinza: mientras está cerrada enciende el resplandor de los cuerpos
//     celestes de la obra (todos a la vez) y oscurece el resto de la pintura
//     para generar contraste; al soltar, el brillo adicional desaparece con
//     un fundido suave y la luz de fondo vuelve a la normalidad.
//   - Viento: la palma abierta en movimiento horizontal desplaza las
//     pinceladas del cielo en esa dirección con una ondulación de brisa que
//     deja rastro; al detenerse (o perderse la mano), las pinceladas
//     vuelven suavemente a su lugar.
//
// Modo DEBUG (window.DEBUG = true): dibuja el círculo de cada zona de
// remolino y permite hacer clic sobre la pintura para leer coordenadas
// normalizadas en la consola.
//
// El modo global de p5 pertenece a handpose.js; este motor usa modo
// instancia para no interferir.
//
// Interfaz publicada: el global `Artwork` con:
//   - montar(contenedor): crea el lienzo p5 dentro del nodo indicado.
//   - cargar(obra): carga una obra del catálogo (imagen + zonas).
//   - actualizar(estado): recibe el estado por frame ({ molino, paz, manos }).
//   - destruir(): quita el lienzo y libera la instancia p5.

const Artwork = (function () {
    "use strict";

    const COLS = 60;
    const ROWS = 40;
    const MOLINO_VELOCIDAD = 2.4; // radianes por segundo en giro pleno
    const REVERTIR_MS = 7000; // sin manos: revertir los efectos tras este tiempo
    const MAX_METEOROS = 60; // tope de meteoros simultáneos de la paz

    // Viento: desplazamiento horizontal de las pinceladas del cielo.
    const VIENTO_ESCALA = 1400; // px de imagen por unidad de velocidad de la palma
    const VIENTO_MAX = 80; // tope de desplazamiento en px de imagen
    const VIENTO_SUAVIDAD = 4; // acercamiento al objetivo (1/s)
    const VIENTO_HORIZONTE = 0.66; // debajo de esta fracción del alto no hay viento
    const OSCURECER_MAX = 0.55; // contraste de la pinza: cuánto se oscurece el fondo

    // Paletas de los meteoritos: alternan entre el amarillo cálido y el
    // azul de la noche de la obra.
    const METEOROS_PALETA = {
        amarillo: {
            colaInicio: [255, 240, 150],
            colaFin: [255, 220, 120],
            sombra: "rgba(255, 230, 140, 0.95)",
            relleno: [255, 250, 220],
        },
        azul: {
            colaInicio: [150, 190, 255],
            colaFin: [61, 123, 255],
            sombra: "rgba(120, 160, 255, 0.95)",
            relleno: [215, 232, 255],
        },
    };

    let instancia = null;
    let sketchRef = null;
    let instanciaEfectos = null;
    let contenedor = null;
    let obraActual = null;
    let imagen = null;
    let dimensiones = null;
    let zonasActivas = [];
    let solicitudId = 0;

    const meteoros = [];
    let lluviaAcumulador = 0;
    let ultimaPaz = 0; // última vez que se vio la paz (para el margen de 5 s)
    let ultimaEntrada = null;
    let ultimoTiempoEfectos = 0;

    let molinoHasta = 0; // instante hasta el que el molino sigue vivo (ms)
    let ultimoConMano = 0; // última vez que se vio una mano (ms)
    let girando = false;
    let desenrollando = false;
    let fase = 0;
    let velocidad = 0;
    let ultimoTiempo = 0;
    let vientoActual = 0; // desplazamiento horizontal suavizado (px de imagen)
    let faseViento = 0; // onda de la brisa que viaja con el viento

    // Oleaje (efecto por obra; hoy sólo La gran ola): la palma abierta
    // arrastra el mar y los barcos en horizontal y el cielo queda quieto.
    // La región del agua la define una máscara propia de la obra.
    let oleajeConfig = null;
    let mascaraPesos = null;
    let oleajeNeutral = null;
    let oleajeUltimaPalma = 0;
    const oleaje = {
        objetivo: 0,
        desplazamiento: 0,
        velocidad: 0,
        fase: 0,
        palma: false,
        palmaX: 0,
        palmaSuave: 0,
        activo: false,
        // 0 = pintura quieta; 1 = mar despierto. Lo enciende la palma y lo
        // apaga su ausencia: sin gesto no hay vaivén ni ondulación.
        ambiente: 0,
    };

    // Tormenta (efecto por obra; hoy sólo La gran ola): el índice extendido
    // oscurece la pintura, hace llover sobre todo el cuadro y arranca
    // salpicaduras de la espuma de la cresta.
    let tormentaConfig = null;
    let emisoresEspuma = [];
    let emisoresBase = [];
    const gotas = [];
    const salpicaduras = [];
    const tormenta = {
        nivel: 0, // 0 = calma, 1 = tormenta plena
        activa: false,
        acumulador: 0, // salpicaduras pendientes de emitir
        fase: 0, // reloj propio del oleaje de tormenta
        destello: 0, // fogonazo del último rayo
        proximoRayo: 0,
    };
    const rayos = [];

    // Corriente (efecto por obra; hoy sólo La gran ola): una mano en paz
    // abre un canal de agua horizontal. El mar corre a lo largo del canal,
    // con espuma viajando y los botes arrastrados por el mismo campo que
    // mueve el agua.
    let corrienteConfig = null;
    const corriente = {
        nivel: 0,
        activa: false,
        ax: 0.5,
        ay: 0.5,
        bx: 0.5,
        by: 0.5,
        objetivoAx: 0.5,
        objetivoAy: 0.5,
        objetivoBx: 0.5,
        objetivoBy: 0.5,
        fase: 0,
        acumulador: 0,
    };
    const corrienteEspuma = [];

    // Barcas: cada una tiene su propio campo local sobre la malla (bob,
    // inclinación y deriva). Así no se mueven todas rígidas con el agua.
    let barcasActivas = [];
    let faseBarcas = 0;

    // Noche (efecto por obra; hoy sólo La gran ola): la pinza cerrada la
    // hace caer. El cuadro se vuelve azul profundo, aparecen estrellas en el
    // cielo y el mar se agita. Al abrir la pinza, amanece.
    let nocheConfig = null;
    const noche = { nivel: 0, activa: false, fase: 0 };
    let estrellas = [];
    let astroConfig = null;

    // Resplandor de los cuerpos celestes (la pinza cerrada lo enciende).
    let cuerposActivos = [];
    let imagenResplandor = null; // pintura con el resplandor horneado
    let iluminacion = 0; // 0 = original, 1 = resplandor completo
    let objetivoIluminacion = 0;

    // Qué efectos habilita cada obra. Una obra sin `gestos` conserva el
    // comportamiento histórico (todos los efectos del motor); una obra que
    // los declara enciende sólo los suyos y no hereda nada de las demás.
    const efectosActivos = {
        molino: false,
        meteoros: false,
        viento: false,
        resplandor: false,
        oleaje: false,
        tormenta: false,
        corriente: false,
        noche: false,
    };

    function crearSketch() {
        return function (p) {
            p.setup = function () {
                p.pixelDensity(1);
                p.createCanvas(1, 1, p.WEBGL);
                // Clase propia: el CSS de la interfaz no debe confundir este
                // lienzo con el canvas de cámara de handpose.js.
                p.canvas.classList.add("lienzo-pintura");
                sketchRef = p;

                if (obraActual) {
                    const pendiente = obraActual;
                    obraActual = null;
                    cargar(pendiente);
                }
            };

            p.draw = function () {
                try {
                    const ahora = performance.now();
                    const dt = ultimoTiempo ? Math.min(0.05, (ahora - ultimoTiempo) / 1000) : 0.016;
                    ultimoTiempo = ahora;

                    ajustarTamaño(p);
                    p.background(10, 14, 22);

                    // Sin manos por un buen rato: todos los efectos vuelven
                    // poco a poco al estado base de la pintura.
                    const revertir = ahora - ultimoConMano > REVERTIR_MS;

                    // El molino sigue vivo un margen generoso después del
                    // último índice: los parpadeos del modelo no lo cortan.
                    const molinoVivo = !revertir && ahora < molinoHasta;

                    // Con el índice acelera; sin él frena con una inercia
                    // breve y arranca el desenrollado, siempre garantizado.
                    const objetivo = molinoVivo ? MOLINO_VELOCIDAD : 0;
                    const suavidad = molinoVivo ? 3.5 : 2.5;
                    velocidad += (objetivo - velocidad) * Math.min(1, dt * suavidad);
                    fase += velocidad * dt;

                    // Dentro de una vuelta completa: girar 2π no cambia la forma.
                    fase = fase % (Math.PI * 2);

                    if (molinoVivo) {
                        girando = true;
                        desenrollando = false;
                    } else {
                        // Desenrollado lento hacia la forma original, por el
                        // camino más corto (media vuelta como máximo).
                        const objetivoFase = fase < Math.PI ? 0 : Math.PI * 2;
                        fase += (objetivoFase - fase) * Math.min(1, dt * 1.4);
                        girando = Math.abs(velocidad) > 0.15;
                        desenrollando = Math.abs(objetivoFase - fase) > 0.02;
                    }

                    // Resplandor de los cuerpos celestes: fundido suave hacia
                    // el objetivo que deja la pinza (sin manos, se conserva).
                    iluminacion += (objetivoIluminacion - iluminacion) * Math.min(1, dt * 3);
                    if (Math.abs(objetivoIluminacion - iluminacion) < 0.002) {
                        iluminacion = objetivoIluminacion;
                    }

                    // Viento: la velocidad de la palma abierta define el
                    // desplazamiento; al detenerse o perderse la mano, el
                    // objetivo es 0 y las pinceladas vuelven solas.
                    const velocidadViento =
                        efectosActivos.viento &&
                        ultimaEntrada &&
                        ultimaEntrada.vientoManos > 0
                            ? ultimaEntrada.vientoVelocidad
                            : 0;
                    const objetivoViento = Math.max(
                        -VIENTO_MAX,
                        Math.min(VIENTO_MAX, velocidadViento * VIENTO_ESCALA)
                    );
                    // Sube rápido con la palma; al soltarla se desvanece
                    // lento, para que la brisa dure varios segundos.
                    const vientoSube =
                        Math.abs(objetivoViento) > Math.abs(vientoActual);
                    const suavidadViento = vientoSube ? VIENTO_SUAVIDAD : 0.5;
                    vientoActual += (objetivoViento - vientoActual) * Math.min(1, dt * suavidadViento);
                    if (Math.abs(objetivoViento - vientoActual) < 0.1) {
                        vientoActual = objetivoViento;
                    }

                    // La onda de la brisa viaja en el sentido del viento:
                    // velocidad base + un extra según la fuerza, para que el
                    // rastro se mueva siempre, aunque la brisa sea suave.
                    faseViento +=
                        (5.5 + Math.abs(vientoActual) * 0.1) *
                        dt *
                        (vientoActual >= 0 ? 1 : -1);

                    pasoOleaje(dt);
                    pasoTormenta(dt);
                    pasoCorriente(dt);
                    pasoBarcas(dt);
                    pasoNoche(dt);

                    if (!imagen || !dimensiones) return;
                    dibujarMalla(p);

                    if (window.DEBUG) dibujarDebug(p);
                } catch (error) {
                    // Un frame con error no debe apagar el motor visual.
                    console.error("Error en el motor visual:", error);
                }
            };

            // Modo DEBUG: clic sobre la pintura -> coordenadas normalizadas.
            p.mousePressed = function () {
                if (!window.DEBUG || !imagen || !dimensiones) return;
                const vista = vistaPintura(p);
                const nx = (p.mouseX - vista.offsetX) / vista.anchoDibujo;
                const ny = (p.mouseY - vista.offsetY) / vista.altoDibujo;
                if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
                    console.log(`x: ${nx.toFixed(2)}, y: ${ny.toFixed(2)}`);
                } else {
                    console.log("Clic fuera de la pintura.");
                }
            };
        };
    }

    // --- Capa de efectos: meteoritos ---------------------------------------

    function crearSketchEfectos() {
        return function (p) {
            p.setup = function () {
                p.pixelDensity(1);
                p.createCanvas(1, 1);
                p.canvas.classList.add("capa-efectos");
            };

            p.draw = function () {
                try {
                    const ahora = performance.now();
                    const dt = ultimoTiempoEfectos
                        ? Math.min(0.05, (ahora - ultimoTiempoEfectos) / 1000)
                        : 0.016;
                    ultimoTiempoEfectos = ahora;

                    ajustarTamaño(p);
                    p.clear();

                    if (!imagen || !dimensiones) return;

                    const revertir = ahora - ultimoConMano > REVERTIR_MS;
                    actualizarEfectos(ultimaEntrada, dt, revertir);
                    actualizarTormenta(dt, revertir);
                    actualizarCorriente(dt);

                    dibujarMeteoros(p);
                    dibujarNoche(p);
                    dibujarAstro(p);
                    dibujarTormenta(p);
                    dibujarCorriente(p);
                } catch (error) {
                    // Un frame con error no debe apagar la capa de efectos.
                    console.error("Error en la capa de efectos:", error);
                }
            };
        };
    }

    // Convierte coordenadas normalizadas de la pintura a píxeles del lienzo.
    function aVista(nx, ny, p, vista) {
        return {
            x: vista.offsetX + nx * vista.anchoDibujo,
            y: vista.offsetY + ny * vista.altoDibujo,
        };
    }

    function actualizarEfectos(estado, dt, revertir) {
        // --- Lluvia de meteoritos: la paz los dispara por toda la obra -----
        const hayPaz = !!(efectosActivos.meteoros && estado && estado.paz);
        const ahoraMs = performance.now();

        if (hayPaz) ultimaPaz = ahoraMs;
        // Tras soltar la paz, los meteoritos siguen vivos unos 5 segundos.
        const pazViva = hayPaz || ahoraMs - ultimaPaz < 5000;

        if (hayPaz && !revertir) {
            lluviaAcumulador += 8 * dt;
            while (lluviaAcumulador >= 1) {
                lluviaAcumulador -= 1;
                const angulo = Math.PI / 6 + Math.random() * (Math.PI / 6);
                const direccion = Math.random() < 0.5 ? 1 : -1;
                const velocidad = 0.22 + Math.random() * 0.16;
                meteoros.push({
                    x: Math.random() * 0.8 + 0.1,
                    y: Math.random() * 0.7 + 0.05,
                    vx: Math.cos(angulo) * velocidad * direccion,
                    vy: Math.sin(angulo) * velocidad,
                    vida: 7 + Math.random() * 2,
                    tamaño: 1.3 + Math.random() * 1.1,
                    tono: Math.random() < 0.5 ? "amarillo" : "azul",
                });
            }
        }
        if (meteoros.length > MAX_METEOROS) {
            meteoros.splice(0, meteoros.length - MAX_METEOROS);
        }

        // Física: rebotan dentro de la pintura y no sobresalen de la imagen.
        let desgasteMeteoros;
        if (revertir) {
            desgasteMeteoros = dt * 3; // reset global: se apagan ya
        } else if (!pazViva) {
            desgasteMeteoros = dt * 2.5; // pasaron los 5 s: se apagan gradual
        } else {
            desgasteMeteoros = dt * 0.12; // lluvia viva o margen: duran
        }

        for (let i = meteoros.length - 1; i >= 0; i -= 1) {
            const meteorito = meteoros[i];
            meteorito.vida -= desgasteMeteoros;
            meteorito.x += meteorito.vx * dt;
            meteorito.y += meteorito.vy * dt;

            if (meteorito.x < 0) { meteorito.x = -meteorito.x; meteorito.vx = Math.abs(meteorito.vx); }
            if (meteorito.x > 1) { meteorito.x = 2 - meteorito.x; meteorito.vx = -Math.abs(meteorito.vx); }
            if (meteorito.y < 0) { meteorito.y = -meteorito.y; meteorito.vy = Math.abs(meteorito.vy); }
            if (meteorito.y > 1) { meteorito.y = 2 - meteorito.y; meteorito.vy = -Math.abs(meteorito.vy); }

            if (meteorito.vida <= 0) meteoros.splice(i, 1);
        }
    }

    function dibujarMeteoros(p) {
        if (meteoros.length === 0) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const escala = vista.anchoDibujo / 1600;

        // Recorte al rectángulo de la pintura: nada sobresale de la imagen.
        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        for (const meteorito of meteoros) {
            const c = aVista(meteorito.x, meteorito.y, p, vista);
            const colaX = c.x - meteorito.vx * vista.anchoDibujo * 0.45;
            const colaY = c.y - meteorito.vy * vista.altoDibujo * 0.45;
            const alpha = Math.max(0, Math.min(1, meteorito.vida / 1.4));
            const paleta = meteorito.tono === "azul" ? METEOROS_PALETA.azul : METEOROS_PALETA.amarillo;

            // Cola: degradado del color del meteorito a transparente.
            const grad = ctx.createLinearGradient(c.x, c.y, colaX, colaY);
            grad.addColorStop(0, `rgba(${paleta.colaInicio[0]}, ${paleta.colaInicio[1]}, ${paleta.colaInicio[2]}, ${(0.9 * alpha).toFixed(3)})`);
            grad.addColorStop(1, `rgba(${paleta.colaFin[0]}, ${paleta.colaFin[1]}, ${paleta.colaFin[2]}, 0)`);

            p.push();
            p.noStroke();
            ctx.strokeStyle = grad;
            ctx.lineCap = "round";
            ctx.lineWidth = Math.max(2, meteorito.tamaño * 3 * escala);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y);
            ctx.lineTo(colaX, colaY);
            ctx.stroke();

            // Cabeza brillante con resplandor.
            ctx.shadowBlur = 10;
            ctx.shadowColor = paleta.sombra;
            p.fill(paleta.relleno[0], paleta.relleno[1], paleta.relleno[2], Math.round(alpha * 255));
            p.circle(c.x, c.y, Math.max(3, meteorito.tamaño * 3.2 * escala));
            ctx.shadowBlur = 0;
            p.pop();
        }

        ctx.restore();
    }

    // --- Tormenta: lluvia y salpicaduras ------------------------------------

    function reiniciarGota(gota) {
        gota.x = Math.random() * 1.14 - 0.07;
        gota.y = -0.05 - Math.random() * 0.25;
        gota.vx = 0.08 + Math.random() * 0.07;
        gota.vy = 1.2 + Math.random() * 0.8;
        gota.largo = 0.02 + Math.random() * 0.03;
        return gota;
    }

    function crearGota() {
        const gota = reiniciarGota({});
        gota.y = Math.random(); // el primer reparto cubre todo el cuadro
        return gota;
    }

    // Cada salpicadura nace en la espuma de la cresta, en la posición que
    // ocupa AHORA (deformar aplica el oleaje): si la ola se corrió con la
    // palma, la espuma escupe desde donde se ve, no desde la pintura quieta.
    // Emisores derivados de la máscara: la línea de agua de TODA la obra.
    // Así la espuma de la ola grande, la del costado derecho y la de abajo
    // salpican sin tener que cargar puntos a mano.
    function emisoresDesdeMascara() {
        if (!mascaraPesos) return [];

        const margen = 0.13; // el mismo margen con que se generó la máscara
        const emisores = [];

        for (let i = 0; i <= COLS; i += 2) {
            let fila = -1;
            for (let j = 0; j <= ROWS; j++) {
                if (mascaraPesos[j * (COLS + 1) + i] > 0.5) {
                    fila = j;
                    break;
                }
            }
            if (fila < 0) continue;

            const y = fila / ROWS + margen;
            if (y > 0.97) continue; // el borde inferior no escupe

            emisores.push({ x: i / COLS, y: Math.min(0.97, y + 0.01) });
        }

        return emisores;
    }

    function crearSalpicadura() {
        const emisor = emisoresEspuma[(Math.random() * emisoresEspuma.length) | 0];
        const punto = deformar(
            emisor.x * dimensiones.ancho,
            emisor.y * dimensiones.alto
        );

        const angulo = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const velocidad = 0.22 + Math.random() * 0.55;
        const vida = 0.45 + Math.random() * 0.75;

        return {
            x: punto.x / dimensiones.ancho,
            y: punto.y / dimensiones.alto,
            vx: Math.cos(angulo) * velocidad * 0.7,
            vy: Math.sin(angulo) * velocidad,
            vida,
            vidaMax: vida,
            tamaño: 1.4 + Math.random() * 2.6,
        };
    }

    // Rayo: una polilínea quebrada desde el borde superior hasta media
    // altura. Vive unas décimas y deja un destello en toda la escena.
    function crearRayo() {
        const pasos = 7 + Math.floor(Math.random() * 5);
        const fin = 0.40 + Math.random() * 0.30;
        let x = 0.12 + Math.random() * 0.76;
        const puntos = [{ x, y: 0 }];

        for (let i = 1; i <= pasos; i += 1) {
            x += (Math.random() - 0.5) * 0.07;
            x = Math.max(0.03, Math.min(0.97, x));
            puntos.push({ x, y: (fin * i) / pasos });
        }

        const vida = 0.12 + Math.random() * 0.16;
        return { puntos, vida, vidaMax: vida };
    }

    function actualizarTormenta(dt, revertir) {
        if (!tormentaConfig) return;

        const nivel = revertir ? 0 : tormenta.nivel;

        // Lluvia: parque fijo dibujado con alfa = nivel, así entra y sale
        // con un fundido sin que aparezcan o desaparezcan gotas de golpe.
        const maxGotas = tormentaConfig.gotas || 150;
        if (nivel > 0.01) {
            while (gotas.length < maxGotas) gotas.push(crearGota());
        } else if (gotas.length > 0) {
            gotas.length = 0;
        }

        for (const gota of gotas) {
            gota.x += gota.vx * dt;
            gota.y += gota.vy * dt;
            if (gota.y > 1.08 || gota.x > 1.12) reiniciarGota(gota);
        }

        // Salpicaduras: sólo con la tormenta viva. Vuelan en abanico desde
        // la cresta, caen y se apagan.
        if (nivel > 0.02 && emisoresEspuma.length > 0) {
            tormenta.acumulador += (tormentaConfig.salpicaduras || 36) * nivel * dt;
            while (tormenta.acumulador >= 1) {
                tormenta.acumulador -= 1;
                salpicaduras.push(crearSalpicadura());
            }
        }

        for (let i = salpicaduras.length - 1; i >= 0; i -= 1) {
            const salpicadura = salpicaduras[i];
            salpicadura.vy += 0.9 * dt; // la gravedad las devuelve al mar
            salpicadura.x += salpicadura.vx * dt;
            salpicadura.y += salpicadura.vy * dt;
            salpicadura.vida -= dt;
            if (salpicadura.vida <= 0) salpicaduras.splice(i, 1);
        }

        // Rayos: caen al azar mientras la tormenta está alta. Cada uno vive
        // unas décimas y deja un destello breve en toda la escena.
        const ahoraMs = performance.now();
        if (nivel > 0.3 && ahoraMs >= tormenta.proximoRayo) {
            rayos.push(crearRayo());
            tormenta.destello = 1;

            const espera = ((tormentaConfig.rayos || 1.6) * 1000) / Math.max(0.4, nivel);
            tormenta.proximoRayo = ahoraMs + espera * (0.6 + Math.random() * 0.8);
        }

        for (let i = rayos.length - 1; i >= 0; i -= 1) {
            rayos[i].vida -= dt;
            if (rayos[i].vida <= 0) rayos.splice(i, 1);
        }

        tormenta.destello *= Math.exp(-dt * 7);
    }

    function dibujarTormenta(p) {
        if (tormenta.nivel <= 0.001 || !dimensiones) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const nivel = tormenta.nivel;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Cielo de tormenta: más oscuro arriba que abajo. Va debajo de la
        // lluvia y de las salpicaduras para que las partículas queden
        // brillantes sobre el cuadro apagado.
        const gradiente = ctx.createLinearGradient(
            0,
            vista.offsetY,
            0,
            vista.offsetY + vista.altoDibujo
        );
        gradiente.addColorStop(0, `rgba(10, 18, 32, ${0.55 * nivel})`);
        gradiente.addColorStop(0.55, `rgba(9, 16, 28, ${0.34 * nivel})`);
        gradiente.addColorStop(1, `rgba(8, 13, 22, ${0.16 * nivel})`);
        ctx.fillStyle = gradiente;
        ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);

        const escala = Math.max(1, vista.anchoDibujo / 1600);

        if (gotas.length > 0) {
            ctx.strokeStyle = `rgba(205, 228, 250, ${0.42 * nivel})`;
            ctx.lineWidth = Math.max(1, vista.anchoDibujo * 0.0009);
            ctx.lineCap = "round";
            ctx.beginPath();

            for (const gota of gotas) {
                const cabeza = aVista(gota.x, gota.y, p, vista);
                const cola = aVista(
                    gota.x - gota.vx * 0.03,
                    gota.y - gota.largo,
                    p,
                    vista
                );
                ctx.moveTo(cabeza.x, cabeza.y);
                ctx.lineTo(cola.x, cola.y);
            }

            ctx.stroke();
        }

        // Rayos: trazo quebrado con resplandor. Van después de la lluvia y
        // antes de las salpicaduras para que la espuma quede al frente.
        for (const rayo of rayos) {
            const alpha = Math.max(0, rayo.vida / rayo.vidaMax);

            ctx.save();
            ctx.strokeStyle = `rgba(224, 240, 255, ${0.95 * alpha})`;
            ctx.shadowColor = `rgba(150, 195, 255, ${0.9 * alpha})`;
            ctx.shadowBlur = 16 * escala;
            ctx.lineWidth = Math.max(1.5, 2.4 * escala);
            ctx.lineJoin = "round";
            ctx.beginPath();

            for (let i = 0; i < rayo.puntos.length; i += 1) {
                const punto = aVista(rayo.puntos[i].x, rayo.puntos[i].y, p, vista);
                if (i === 0) ctx.moveTo(punto.x, punto.y);
                else ctx.lineTo(punto.x, punto.y);
            }

            ctx.stroke();
            ctx.restore();
        }

        for (const salpicadura of salpicaduras) {
            const alpha = Math.max(0, salpicadura.vida / salpicadura.vidaMax) * 0.85 * nivel;
            if (alpha <= 0.01) continue;

            const centro = aVista(salpicadura.x, salpicadura.y, p, vista);
            ctx.fillStyle = `rgba(228, 244, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, Math.max(1, salpicadura.tamaño * escala), 0, Math.PI * 2);
            ctx.fill();
        }

        // Fogonazo: ilumina toda la escena un instante, por encima de todo.
        if (tormenta.destello > 0.01) {
            ctx.fillStyle = `rgba(198, 220, 255, ${0.13 * tormenta.destello * nivel})`;
            ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        }

        ctx.restore();
    }

    // --- Corriente: canal entre las dos manos -------------------------------

    function pasoCorriente(dt) {
        if (!corrienteConfig) return;

        const objetivo = corriente.activa ? 1 : 0;
        const ritmo = corriente.activa
            ? corrienteConfig.entrada || 3
            : corrienteConfig.salida || 1.2;
        corriente.nivel += (objetivo - corriente.nivel) * Math.min(1, dt * ritmo);
        if (objetivo === 0 && corriente.nivel < 0.003) corriente.nivel = 0;

        // Los dos puntos se siguen con filtro: el modelo tiembla y el canal
        // no debe vibrar.
        const suavidad = Math.min(1, dt * 7);
        corriente.ax += (corriente.objetivoAx - corriente.ax) * suavidad;
        corriente.ay += (corriente.objetivoAy - corriente.ay) * suavidad;
        corriente.bx += (corriente.objetivoBx - corriente.bx) * suavidad;
        corriente.by += (corriente.objetivoBy - corriente.by) * suavidad;

        corriente.fase += dt * (2 + 3 * corriente.nivel);
    }

    // Geometría del canal en un punto: dirección del flujo y caída por
    // distancia al segmento. Devuelve null si no hay corriente.
    function campoCorriente(px, py) {
        if (!corrienteConfig || corriente.nivel <= 0.001 || !dimensiones) {
            return null;
        }

        const ax = corriente.ax * dimensiones.ancho;
        const ay = corriente.ay * dimensiones.alto;
        const bx = corriente.bx * dimensiones.ancho;
        const by = corriente.by * dimensiones.alto;
        const dx = bx - ax;
        const dy = by - ay;
        const largo = Math.hypot(dx, dy);
        if (largo <= 1) return null;

        const ux = dx / largo;
        const uy = dy / largo;
        let t = ((px - ax) * ux + (py - ay) * uy) / largo;
        t = Math.max(0, Math.min(1, t));

        const cx = ax + ux * largo * t;
        const cy = ay + uy * largo * t;
        const distancia = Math.hypot(px - cx, py - cy);

        const radio = Math.max(
            (corrienteConfig.ancho || 0.12) * dimensiones.ancho,
            largo * (corrienteConfig.avance || 0.14)
        );

        return {
            ux,
            uy,
            caida: Math.exp(-(distancia * distancia) / (radio * radio)),
        };
    }

    // Cuánto llega la corriente a un punto: 0 = nada, 1 = centro del canal.
    function caidaCorriente(px, py) {
        const campo = campoCorriente(px, py);
        return campo ? corriente.nivel * campo.caida : 0;
    }

    // Cada barco recibe su propia actividad según lo que tenga alrededor:
    // mar despierto, tormenta o la corriente pasando por encima.
    function pasoBarcas(dt) {
        if (barcasActivas.length === 0 || !dimensiones) return;

        const actividad = Math.max(
            oleaje.ambiente * 0.55,
            tormenta.nivel,
            corriente.nivel,
            noche.nivel * 0.8
        );
        faseBarcas += dt * (0.8 + 1.6 * actividad);

        for (const barca of barcasActivas) {
            const agua = caidaCorriente(
                barca.x * dimensiones.ancho,
                barca.y * dimensiones.alto
            );
            barca.actividad = Math.max(
                oleaje.ambiente * 0.55,
                tormenta.nivel,
                agua,
                noche.nivel * 0.8
            );
        }
    }

    // La pinza cerrada hace caer la noche; al abrirla amanece.
    function pasoNoche(dt) {
        if (!nocheConfig) return;

        if (noche.activa) {
            noche.nivel += dt * (nocheConfig.entrada || 0.9);
        } else {
            noche.nivel -= dt * (nocheConfig.salida || 1.3);
        }

        noche.nivel = Math.max(0, Math.min(1, noche.nivel));

        // Reloj de la agitación y del titileo de las estrellas.
        noche.fase += dt * (1.2 + 2.0 * noche.nivel);

        // Las estrellas se reparten cuando el cielo ya está disponible.
        if (noche.nivel > 0.01 && estrellas.length === 0) {
            estrellas = crearEstrellas();
        }
    }

    // Estrellas del cielo nocturno: se reparten donde la máscara es 0
    // (cielo, no agua) y fuera del cartucho. Se generan una vez por obra.
    function crearEstrellas() {
        if (!mascaraPesos || !dimensiones) return [];

        const total = nocheConfig ? nocheConfig.estrellas || 70 : 0;
        const lista = [];

        for (
            let intento = 0;
            intento < total * 6 && lista.length < total;
            intento += 1
        ) {
            const x = 0.03 + Math.random() * 0.94;
            const y = 0.02 + Math.random() * 0.53;

            if (x < 0.17 && y < 0.35) continue; // cartucho y firma
            if (pesoMascara(x * dimensiones.ancho, y * dimensiones.alto) > 0.2) {
                continue; // agua
            }

            lista.push({
                x,
                y,
                fase: Math.random() * Math.PI * 2,
                brillo: 0.4 + Math.random() * 0.6,
                tamaño: 0.7 + Math.random() * 1.5,
            });
        }

        return lista;
    }

    function dibujarNoche(p) {
        if (!nocheConfig || noche.nivel <= 0.001 || estrellas.length === 0) {
            return;
        }

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const escala = Math.max(1, vista.anchoDibujo / 1600);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        for (const estrella of estrellas) {
            const titileo =
                0.55 +
                0.45 *
                    Math.sin(noche.fase * (1.2 + estrella.brillo) + estrella.fase);
            const alpha = noche.nivel * estrella.brillo * titileo;
            if (alpha <= 0.02) continue;

            const centro = aVista(estrella.x, estrella.y, p, vista);
            const radio = Math.max(0.6, estrella.tamaño * escala);

            // Halo tenue + núcleo: una estrella sola de 1 px no se lee.
            ctx.fillStyle = `rgba(200, 222, 255, ${alpha * 0.22})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio * 2.6, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(238, 246, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // Sol de día y luna de noche en el mismo punto del cielo. El astro sólo
    // existe mientras la pinza está activa: en reposo la pintura queda
    // original, sin sol agregado. Con la pinza, el sol se pone y la luna
    // sube; al abrir, el sol vuelve a asomar un instante y se va.
    function dibujarAstro(p) {
        if (!astroConfig || !dimensiones || noche.nivel <= 0.001) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const centro = aVista(astroConfig.x, astroConfig.y, p, vista);
        const radio = Math.max(4, (astroConfig.radio || 0.034) * vista.anchoDibujo);
        const nivel = noche.nivel;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Sol: sólo durante la transición (puesta o salida). En noche plena
        // y en día no se ve.
        const sol = nivel * (1 - nivel);
        if (sol > 0.01) {
            const halo = ctx.createRadialGradient(
                centro.x,
                centro.y,
                radio,
                centro.x,
                centro.y,
                radio * 3.4
            );
            halo.addColorStop(0, `rgba(255, 232, 160, ${0.55 * sol})`);
            halo.addColorStop(0.45, `rgba(255, 210, 120, ${0.16 * sol})`);
            halo.addColorStop(1, "rgba(255, 200, 100, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio * 3.4, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(255, 248, 214, ${0.98 * sol})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio, 0, Math.PI * 2);
            ctx.fill();
        }

        // Luna: halo frío, disco pálido y una sombra suave para que no sea
        // un círculo plano.
        if (nivel > 0.01) {
            const halo = ctx.createRadialGradient(
                centro.x,
                centro.y,
                radio,
                centro.x,
                centro.y,
                radio * 3.0
            );
            halo.addColorStop(0, `rgba(214, 230, 252, ${0.32 * nivel})`);
            halo.addColorStop(0.5, `rgba(180, 205, 240, ${0.10 * nivel})`);
            halo.addColorStop(1, "rgba(160, 190, 230, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio * 3.0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(238, 245, 255, ${0.98 * nivel})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = `rgba(176, 198, 232, ${0.22 * nivel})`;
            ctx.beginPath();
            ctx.arc(
                centro.x + radio * 0.28,
                centro.y + radio * 0.18,
                radio * 0.72,
                0,
                Math.PI * 2
            );
            ctx.fill();
        }

        ctx.restore();
    }

    function crearEspumaCorriente() {
        const ax = corriente.ax;
        const ay = corriente.ay;
        const dx = corriente.bx - ax;
        const dy = corriente.by - ay;
        const largo = Math.hypot(dx, dy) || 1;
        const ux = dx / largo;
        const uy = dy / largo;

        // La espuma sólo puede nacer donde hay agua: si el canal está sobre
        // el cielo, no sale nada.
        for (let intento = 0; intento < 4; intento += 1) {
            const t = Math.random();
            const desvio = (Math.random() - 0.5) * 0.07;
            const x = ax + ux * largo * t - uy * desvio;
            const y = ay + uy * largo * t + ux * desvio;

            if (!dimensiones) return null;
            if (pesoMascara(x * dimensiones.ancho, y * dimensiones.alto) < 0.3) {
                continue;
            }

            const velocidad = 0.18 + Math.random() * 0.22;
            const vida = 0.7 + Math.random() * 0.7;

            return {
                x,
                y,
                vx: ux * velocidad,
                vy: uy * velocidad,
                vida,
                vidaMax: vida,
                tamaño: 1.2 + Math.random() * 2,
            };
        }

        return null;
    }

    function actualizarCorriente(dt) {
        if (!corrienteConfig) return;

        if (corriente.nivel > 0.02) {
            corriente.acumulador +=
                (corrienteConfig.espuma || 34) * corriente.nivel * dt;
            while (corriente.acumulador >= 1) {
                corriente.acumulador -= 1;
                const particula = crearEspumaCorriente();
                if (particula) corrienteEspuma.push(particula);
            }
        } else {
            corriente.acumulador = 0;
        }

        for (let i = corrienteEspuma.length - 1; i >= 0; i -= 1) {
            const particula = corrienteEspuma[i];
            particula.x += particula.vx * dt;
            particula.y += particula.vy * dt;
            particula.vida -= dt;
            if (particula.vida <= 0) corrienteEspuma.splice(i, 1);
        }
    }

    function dibujarCorriente(p) {
        if (corriente.nivel <= 0.001 || corrienteEspuma.length === 0) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const escala = Math.max(1, vista.anchoDibujo / 1600);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        ctx.lineCap = "round";

        for (const particula of corrienteEspuma) {
            const alpha =
                Math.max(0, particula.vida / particula.vidaMax) *
                0.7 *
                corriente.nivel;
            if (alpha <= 0.01) continue;

            const cabeza = aVista(particula.x, particula.y, p, vista);
            const cola = aVista(
                particula.x - particula.vx * 0.09,
                particula.y - particula.vy * 0.09,
                p,
                vista
            );

            ctx.strokeStyle = `rgba(222, 242, 255, ${alpha})`;
            ctx.lineWidth = Math.max(1, particula.tamaño * escala);
            ctx.beginPath();
            ctx.moveTo(cabeza.x, cabeza.y);
            ctx.lineTo(cola.x, cola.y);
            ctx.stroke();
        }

        ctx.restore();
    }

    // --- Tamaño y geometría ------------------------------------------------

    function ajustarTamaño(p) {
        // El lienzo llena el área central de la experiencia y se recalcula
        // ante cambios de tamaño de la ventana.
        if (!contenedor) return;
        const ancho = Math.max(1, contenedor.clientWidth);
        const alto = Math.max(1, contenedor.clientHeight);
        if (p.width !== ancho || p.height !== alto) {
            p.resizeCanvas(ancho, alto);
        }
    }

    // Ajuste "contain" de la pintura dentro del lienzo.
    function vistaPintura(p) {
        const fit = Math.min(p.width / dimensiones.ancho, p.height / dimensiones.alto);
        return {
            fit,
            anchoDibujo: dimensiones.ancho * fit,
            altoDibujo: dimensiones.alto * fit,
            offsetX: (p.width - dimensiones.ancho * fit) / 2,
            offsetY: (p.height - dimensiones.alto * fit) / 2,
        };
    }

    // --- Deformación de la malla ------------------------------------------

    // Devuelve la posición deformada de un punto de la malla (en píxeles de
    // imagen). Cada vértice parte de su coordenada original y aplica en orden
    // TODAS las zonas de remolino: sin acumulación entre frames.
    function deformar(px, py) {
        let x = px;
        let y = py;

        for (const zona of zonasActivas) {
            if (zona.efecto !== "remolino") continue;

            const cx = zona.x * dimensiones.ancho;
            const cy = zona.y * dimensiones.alto;
            const radio = zona.radio * Math.min(dimensiones.ancho, dimensiones.alto);
            const dx = x - cx;
            const dy = y - cy;

            const caida = Math.exp(-(dx * dx + dy * dy) / (radio * radio));
            // Los remolinos chicos giran algo más rápido, como un cielo real.
            const factor = Math.max(0.7, Math.min(2.5, 0.13 / zona.radio));
            const angulo = -fase * caida * factor;
            const cos = Math.cos(angulo);
            const sin = Math.sin(angulo);

            x = cx + dx * cos - dy * sin;
            y = cy + dx * sin + dy * cos;
        }

        // Viento: desplazamiento horizontal del cielo, suavizado por la
        // máscara (cero sobre los cuerpos celestes y el paisaje), más una
        // ondulación que viaja con el viento y deja rastro de brisa.
        if (vientoActual !== 0) {
            const peso = mascaraViento(px, py);
            x += vientoActual * peso;

            if (Math.abs(vientoActual) > 0.1) {
                // Ondulación fuerte (factor 3) con el movimiento notándose
                // bastante en AMBOS lados de la obra.
                const lateral = 0.6 + 1.1 * Math.abs((px / dimensiones.ancho) - 0.5) * 2;
                const onda =
                    Math.sin(px * 0.035 - faseViento) +
                    0.5 * Math.sin(px * 0.012 + faseViento * 0.6);
                const desplazamiento = onda * Math.abs(vientoActual) * 3 * peso * lateral;
                y += Math.max(-190, Math.min(190, desplazamiento));
            }
        }

        // Oleaje: la palma abierta arrastra el agua en horizontal. El peso
        // sale de la máscara de la obra (0 = cielo, 1 = mar), así el cielo,
        // el Fuji y el cartucho no se mueven.
        if (oleajeConfig && mascaraPesos && (oleaje.desplazamiento !== 0 || oleaje.ambiente > 0.001)) {
            const peso = pesoMascara(px, py);
            if (peso > 0) {
                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const profundidad = 1 - (oleajeConfig.profundidad || 0) * (1 - v);

                // Flujo interno: el agua no se corre en bloque. Dos ondas de
                // distinta longitud viajan por el mar y hacen que unas
                // franjas acompañen más que otras.
                const intensidad = oleajeConfig.desvio || 0.16;
                const modulacion =
                    1 +
                    intensidad * Math.sin(u * 6.3 + oleaje.fase * 0.9) +
                    intensidad * 0.5 * Math.sin(u * 13.1 - oleaje.fase * 1.3 + 1.7);

                x += oleaje.desplazamiento * peso * profundidad * modulacion;

                // Vaivén vertical: sólo con el mar despierto. Sin palma el
                // agua se queda quieta, como la pintura original; con la
                // palma delante respira y crece cuando el mar se mueve.
                const tope = (oleajeConfig.desplazamiento || 0.06) * dimensiones.ancho;
                const fuerza = Math.min(
                    1,
                    Math.abs(oleaje.desplazamiento) / Math.max(1, tope)
                );
                const vaiven =
                    Math.sin(u * 7.5 - oleaje.fase * 1.5) *
                    Math.cos(v * 4.2 + oleaje.fase * 0.4);
                y +=
                    vaiven *
                    ((oleajeConfig.reposo || 7) + (oleajeConfig.vaiven || 16) * fuerza) *
                    peso *
                    oleaje.ambiente;
            }
        }

        // Tormenta: el mar se agita aunque no haya palma. Chapoteo vertical
        // de varias frecuencias más un empuje lateral, todo escalado por el
        // nivel: con la tormenta a pleno, el agua hierve.
        if (tormentaConfig && tormenta.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            if (peso > 0) {
                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const reloj = tormenta.fase;
                const nivel = tormenta.nivel;

                const agitacion =
                    0.55 * Math.sin(u * 9.1 + reloj * 2.0) +
                    0.3 * Math.sin(u * 16.7 - reloj * 2.7 + 2.1) +
                    0.25 * Math.sin(v * 12.0 + reloj * 1.4);

                y += agitacion * nivel * peso * (tormentaConfig.agitacion || 30);
                x += Math.sin(u * 6.3 - reloj * 1.6) * nivel * peso * 14;
            }
        }

        // Corriente: una mano en paz abre un canal por el que el agua corre.
        // El desplazamiento va a lo largo del segmento del canal, con caída
        // por distancia y una ondulación que viaja.
        if (corrienteConfig && corriente.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            const campo = peso > 0 ? campoCorriente(px, py) : null;

            if (campo && campo.caida > 0.002) {
                const flujo =
                    0.6 + 0.4 * Math.sin(px * 0.008 - corriente.fase * 2.2);
                const empuje =
                    corriente.nivel *
                    peso *
                    campo.caida *
                    flujo *
                    (corrienteConfig.amplitud || 52);

                x += campo.ux * empuje;
                y += campo.uy * empuje;

                // El agua no sólo se corre: se revuelve. Chapoteo vertical
                // y un vaivén lateral dentro del canal.
                const revuelo = corriente.nivel * peso * campo.caida;
                y +=
                    Math.sin(px * 0.012 + corriente.fase * 2.4) *
                    Math.cos(py * 0.015 - corriente.fase * 1.7) *
                    revuelo *
                    (corrienteConfig.agitacion || 18);
                x +=
                    Math.sin(py * 0.02 + corriente.fase * 1.9) *
                    revuelo *
                    9;
            }
        }

        // Barcas: cada una suma su propio vaivén, inclinación y deriva. Se
        // aplica sólo dentro de su elipse y con el peso de la máscara, así
        // no toca el cielo, el Fuji ni el agua lejana.
        if (barcasActivas.length > 0) {
            for (const barca of barcasActivas) {
                if (barca.actividad <= 0.001) continue;

                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const d =
                    ((u - barca.x) / barca.rx) ** 2 +
                    ((v - barca.y) / barca.ry) ** 2;
                if (d >= 1.5) continue;

                // Núcleo plano: el casco se mueve rígido y el borde se
                // funde con el agua. Si el peso variara dentro del casco,
                // el barco se vería de goma.
                const t = Math.min(1, Math.max(0, (1.5 - d) / 0.65));
                const peso =
                    t * t * (3 - 2 * t) * barca.actividad * pesoMascara(px, py);
                if (peso < 0.002) continue;

                const fase = faseBarcas + (barca.fase || 0);
                const bob = Math.sin(fase) * (barca.bob || 7) * peso;
                const deriva =
                    Math.sin(fase * 0.63 + 1.1) * (barca.deriva || 4) * peso;
                const inclina =
                    Math.sin(fase * 0.8 + 0.5) * (barca.inclina || 0.028) * peso;
                const dx = px - barca.x * dimensiones.ancho;
                const dy = py - barca.y * dimensiones.alto;

                x += deriva - dy * inclina;
                y += bob + dx * inclina;
            }
        }

        // Noche: el mar se agita aunque no haya palma. Chapoteo de tres
        // frecuencias, escalado por el nivel de noche.
        if (nocheConfig && noche.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            if (peso > 0) {
                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const reloj = noche.fase;
                const nivel = noche.nivel;

                const agitacion =
                    0.5 * Math.sin(u * 8.7 + reloj * 2.2) +
                    0.3 * Math.sin(u * 15.1 - reloj * 2.8 + 1.4) +
                    0.2 * Math.sin(v * 13.0 + reloj * 1.6);

                y += agitacion * nivel * peso * (nocheConfig.agitacion || 26);
                x += Math.sin(u * 5.9 - reloj * 1.7) * nivel * peso * 9;
            }
        }

        return { x, y };
    }

    // Peso de la máscara en un punto de la imagen. La máscara se muestrea
    // una sola vez sobre la grilla de la malla (61 × 41 valores).
    function pesoMascara(px, py) {
        if (!mascaraPesos || !dimensiones) return 0;
        const i = Math.round((px / dimensiones.ancho) * COLS);
        const j = Math.round((py / dimensiones.alto) * ROWS);
        if (i < 0 || i > COLS || j < 0 || j > ROWS) return 0;
        return mascaraPesos[j * (COLS + 1) + i];
    }

    // Peso del viento en un punto de la imagen (0 = protegido, 1 = cielo
    // abierto). Excluye suavemente los cuerpos celestes (luna y estrellas) y
    // el paisaje por debajo del horizonte, sin bordes duros.
    function mascaraViento(px, py) {
        let peso = 1;

        for (const cuerpo of cuerposActivos) {
            const dx = px - cuerpo.x;
            const dy = py - cuerpo.y;
            const radio = cuerpo.radio * 1.25;
            const d2 = dx * dx + dy * dy;
            if (d2 < radio * radio * 6.25) {
                // Los cuerpos amortiguan la brisa, pero sin apagarla del
                // todo: la luna y las estrellas también respiran con ella.
                peso *= Math.max(0.25, 1 - Math.exp(-(d2 / (radio * radio)) * 3));
            }
        }

        const horizonte = VIENTO_HORIZONTE * dimensiones.alto;
        const banda = 0.1 * dimensiones.alto;
        if (py > horizonte - banda) {
            const t = Math.min(1, Math.max(0, (py - (horizonte - banda)) / banda));
            peso *= 1 - t;
        }

        return peso;
    }

    // --- Oleaje: arrastre del mar con la palma ------------------------------

    // La máscara se muestrea sobre la grilla de la malla (una lectura por
    // vértice), no por píxel: es lo único que el warping necesita.
    function cargarMascara(url, id) {
        if (!sketchRef) return;

        sketchRef.loadImage(
            url,
            function (mascara) {
                if (id !== solicitudId) return; // una carga más nueva ya ganó
                mascara.loadPixels();
                if (!mascara.pixels) {
                    console.error("La máscara del oleaje no tiene píxeles:", url);
                    return;
                }

                const pesos = new Float32Array((COLS + 1) * (ROWS + 1));
                const anchoMascara = Math.max(1, mascara.width - 1);
                const altoMascara = Math.max(1, mascara.height - 1);

                for (let j = 0; j <= ROWS; j++) {
                    const sy = Math.round((j / ROWS) * altoMascara);
                    for (let i = 0; i <= COLS; i++) {
                        const sx = Math.round((i / COLS) * anchoMascara);
                        pesos[j * (COLS + 1) + i] =
                            mascara.pixels[(sy * mascara.width + sx) * 4] / 255;
                    }
                }

                mascaraPesos = pesos;
                emisoresEspuma = emisoresBase.concat(emisoresDesdeMascara());
            },
            function () {
                if (id !== solicitudId) return;
                console.error("No se pudo cargar la máscara del oleaje:", url);
            }
        );
    }

    // El objetivo sale de la POSICIÓN de la palma respecto del punto donde
    // apareció: moverla a un lado corre el agua hacia ese lado y volver al
    // punto de partida la devuelve. Un resorte amortiguado le da masa al
    // agua: sigue a la mano con un pequeño sobrepaso en vez de copiarla.
    function pasoOleaje(dt) {
        if (!oleajeConfig || !dimensiones) return;

        const tope = (oleajeConfig.desplazamiento || 0.05) * dimensiones.ancho;

        // Un parpadeo del modelo no puede devolver el mar al centro: la
        // posición se conserva un instante antes de soltar el gesto.
        const ahora = performance.now();
        const presente = oleaje.activo || ahora - oleajeUltimaPalma < 400;

        if (presente) {
            if (oleajeNeutral === null) {
                oleajeNeutral = oleaje.palmaX;
                oleaje.palmaSuave = oleaje.palmaX;
            }

            // La mano tiembla; el agua no debe temblar con ella. Filtro
            // exponencial corto + zona muerta alrededor del punto neutro:
            // el pulso del modelo no llega a mover el mar.
            oleaje.palmaSuave +=
                (oleaje.palmaX - oleaje.palmaSuave) * Math.min(1, dt * 7);

            let desvio = oleaje.palmaSuave - oleajeNeutral;
            const muerto = 0.012; // fracción del ancho del cuadro
            if (Math.abs(desvio) < muerto) desvio = 0;
            else desvio -= Math.sign(desvio) * muerto;

            const recorrido = desvio * (oleajeConfig.sensibilidad || 3.2);
            oleaje.objetivo = Math.max(-tope, Math.min(tope, recorrido * tope));
        } else {
            // Sin palma el agua se acomoda sola, despacio.
            oleajeNeutral = null;
            oleaje.objetivo *= Math.exp(-dt / (oleajeConfig.retorno || 2.2));
            if (Math.abs(oleaje.objetivo) < 0.5) oleaje.objetivo = 0;
        }

        // El mar se despierta con la palma y se duerme cuando se va: entra
        // rápido para que responda, sale lento para que no corte seco.
        const objetivoAmbiente = presente ? 1 : 0;
        const ritmo =
            objetivoAmbiente > oleaje.ambiente
                ? oleajeConfig.avivar || 3.5
                : oleajeConfig.dormir || 1.2;
        oleaje.ambiente +=
            (objetivoAmbiente - oleaje.ambiente) * Math.min(1, dt * ritmo);
        if (objetivoAmbiente === 0 && oleaje.ambiente < 0.002) oleaje.ambiente = 0;

        // Resorte casi crítico: el agua no rebota ni se sacude, llega.
        const rigidez = oleajeConfig.rigidez || 15;
        const amortiguacion = oleajeConfig.amortiguacion || 7.8;
        const aceleracion =
            (oleaje.objetivo - oleaje.desplazamiento) * rigidez -
            oleaje.velocidad * amortiguacion;
        oleaje.velocidad += aceleracion * dt;
        oleaje.desplazamiento += oleaje.velocidad * dt;

        // Reposo exacto: sin gesto, la pintura vuelve a ser la original.
        if (
            oleaje.objetivo === 0 &&
            Math.abs(oleaje.desplazamiento) < 0.05 &&
            Math.abs(oleaje.velocidad) < 0.05
        ) {
            oleaje.desplazamiento = 0;
            oleaje.velocidad = 0;
        }

        // La ondulación viaja siempre; con el mar en movimiento, más rápido.
        const fuerza = Math.min(1, Math.abs(oleaje.desplazamiento) / Math.max(1, tope));
        oleaje.fase += dt * (0.9 + fuerza * 1.5);
    }

    // --- Tormenta: nivel y partículas ---------------------------------------

    // El nivel sube mientras el índice está extendido y baja cuando se
    // suelta. Todo lo demás (tinte, lluvia, salpicaduras) se cuelga de acá.
    function pasoTormenta(dt) {
        if (!tormentaConfig) return;

        const objetivo = tormenta.activa ? 1 : 0;
        const ritmo = tormenta.activa
            ? tormentaConfig.entrada || 2.2
            : tormentaConfig.salida || 0.8;

        tormenta.nivel += (objetivo - tormenta.nivel) * Math.min(1, dt * ritmo);
        if (objetivo === 0 && tormenta.nivel < 0.003) tormenta.nivel = 0;

        // Reloj propio del chapoteo: mucho más rápido que el del oleaje.
        tormenta.fase += dt * (1.6 + 2.2 * tormenta.nivel);
    }

    // Oscurecimiento de la pintura: la pinza y la tormenta comparten el
    // tinte para que el agua y el cielo se apaguen de verdad, con textura,
    // en vez de recibir un velo plano por encima.
    function tintePintura() {
        const oscuridadPinza = iluminacion * OSCURECER_MAX;
        const oscuridadTormenta =
            tormenta.nivel * (tormentaConfig ? tormentaConfig.oscuridad || 0.3 : 0);
        const oscuridadNoche =
            noche.nivel * (nocheConfig ? nocheConfig.oscuridad || 0.55 : 0);
        const oscuridad = Math.min(
            0.84,
            oscuridadPinza + oscuridadTormenta + oscuridadNoche
        );
        const brillo = 255 * (1 - oscuridad);

        const frialdadTormenta =
            tormenta.nivel * (tormentaConfig ? tormentaConfig.frialdad || 0.4 : 0);
        const frialdadNoche =
            noche.nivel * (nocheConfig ? nocheConfig.frialdad || 0.85 : 0);

        // La noche no sólo oscurece: baja el rojo mucho más que el azul, que
        // es lo que hace que el cielo se lea azul profundo y no gris.
        return {
            r:
                brillo *
                (1 - frialdadTormenta * 0.38) *
                (1 - frialdadNoche * 0.62),
            g:
                brillo *
                (1 - frialdadTormenta * 0.14) *
                (1 - frialdadNoche * 0.32),
            b: brillo,
        };
    }

    function dibujarMalla(p) {
        const vista = vistaPintura(p);

        p.noStroke();
        p.textureMode(p.NORMAL);

        const tinte = tintePintura();

        // Con oleaje, la pintura original queda de fondo: si la malla se corre
        // y deja ver el borde, se ve mar quieto y no un hueco negro.
        if (oleajeConfig && imagen) {
            p.push();
            p.translate(0, 0, -1); // detrás de la malla: evita z-fighting
            p.tint(tinte.r, tinte.g, tinte.b);
            p.image(
                imagen,
                -vista.anchoDibujo / 2,
                -vista.altoDibujo / 2,
                vista.anchoDibujo,
                vista.altoDibujo
            );
            p.noTint();
            p.pop();
        }

        // Pasada base: la pintura original, oscurecida por la pinza o por
        // la tormenta.
        p.tint(tinte.r, tinte.g, tinte.b);
        dibujarPasada(p, vista, imagen, 0);
        p.noTint();

        // Pasada de resplandor: la misma malla (misma deformación) con la
        // capa de solo luz, sumada aditivamente; el alpha del tint funde el
        // brillo y mantiene la alineación exacta con la pintura. Un offset
        // mínimo de z evita el z-fighting entre las dos pasadas.
        if (imagenResplandor && iluminacion > 0.002) {
            p.blendMode(p.ADD);
            p.tint(255, 255 * iluminacion);
            dibujarPasada(p, vista, imagenResplandor, 0.5);
            p.blendMode(p.BLEND);
            p.noTint();
        }
    }

    function dibujarPasada(p, vista, textura, z) {
        p.texture(textura);

        for (let j = 0; j < ROWS; j++) {
            p.beginShape(p.TRIANGLE_STRIP);
            for (let i = 0; i <= COLS; i++) {
                emitirVertice(p, vista, i, j, z);
                emitirVertice(p, vista, i, j + 1, z);
            }
            p.endShape();
        }
    }

    function emitirVertice(p, vista, i, j, z) {
        const px = (i / COLS) * dimensiones.ancho;
        const py = (j / ROWS) * dimensiones.alto;
        const punto = deformar(px, py);

        const x = punto.x * vista.fit - vista.anchoDibujo / 2;
        const y = punto.y * vista.fit - vista.altoDibujo / 2;

        p.vertex(x, y, z, i / COLS, j / ROWS);
    }

    // --- Resplandor de los cuerpos celestes --------------------------------
    // Hornea en el propio espacio de la imagen una capa de SOLO luz: fondo
    // transparente con un resplandor cálido alrededor de cada cuerpo. La
    // pintura base se dibuja oscurecida durante el gesto y esta capa se suma
    // aditivamente con la misma malla, así el brillo queda siempre alineado
    // (incluida la deformación de los remolinos) y el contraste se genera
    // sin rellenos negros ni máscaras opacas.
    function crearVersionResplandor(cuerpos) {
        if (!imagen || !sketchRef || cuerpos.length === 0) return null;

        const g = sketchRef.createGraphics(imagen.width, imagen.height);
        g.pixelDensity(1);

        const ctx = g.drawingContext;
        ctx.save();
        ctx.globalCompositeOperation = "screen";

        for (const cuerpo of cuerpos) {
            const cx = cuerpo.x;
            const cy = cuerpo.y;
            const r = cuerpo.radio;

            const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            grad.addColorStop(0, "rgba(255, 244, 200, 1)");
            grad.addColorStop(0.35, "rgba(255, 222, 150, 0.75)");
            grad.addColorStop(0.7, "rgba(255, 206, 120, 0.3)");
            grad.addColorStop(1, "rgba(255, 200, 110, 0)");

            ctx.fillStyle = grad;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }

        ctx.restore();
        return g;
    }

    // --- Modo DEBUG -------------------------------------------------------

    function dibujarDebug(p) {
        const vista = vistaPintura(p);
        const ladoMenor = Math.min(dimensiones.ancho, dimensiones.alto);

        p.push();
        p.noFill();
        p.strokeWeight(2);
        for (const zona of zonasActivas) {
            if (zona.efecto !== "remolino") continue;

            const cx = zona.x * dimensiones.ancho * vista.fit - vista.anchoDibujo / 2;
            const cy = zona.y * dimensiones.alto * vista.fit - vista.altoDibujo / 2;
            const r = zona.radio * ladoMenor * vista.fit;

            p.stroke(61, 123, 255, 160);
            p.ellipse(cx, cy, r * 2, r * 2);

            p.stroke(255, 200, 80, 220);
            p.line(cx - 6, cy, cx + 6, cy);
            p.line(cx, cy - 6, cx, cy + 6);
        }
        p.pop();
    }

    // --- API pública ------------------------------------------------------

    function montar(nodo) {
        if (!nodo || instancia) return;
        contenedor = nodo;
        instancia = new p5(crearSketch(), nodo);
        instanciaEfectos = new p5(crearSketchEfectos(), nodo);
    }

    function cargar(obra) {
        if (!obra || !obra.archivo) return;
        obraActual = obra;

        // Contrato de gestos por obra: si la obra no declara un efecto para
        // el gesto, no pasa nada. Así ninguna obra hereda los efectos de otra.
        // Las obras sin `gestos` (la noche estrellada) conservan el
        // comportamiento histórico completo.
        const legado = !obra.gestos;
        const efectoPoint = obra.gestos && obra.gestos.point ? obra.gestos.point.efecto : null;
        const efectoPeace = obra.gestos && obra.gestos.peace ? obra.gestos.peace.efecto : null;
        const efectoPinza = obra.gestos && obra.gestos.pinza ? obra.gestos.pinza.efecto : null;

        efectosActivos.molino = legado || efectoPoint === "molino";
        efectosActivos.meteoros = legado || efectoPeace === "meteoros";
        efectosActivos.viento =
            legado || !!(obra.gestos.palma && obra.gestos.palma.efecto === "viento");
        efectosActivos.resplandor = legado || efectoPinza === "resplandor";
        efectosActivos.oleaje =
            !!obra.gestos &&
            !!obra.gestos.palma &&
            obra.gestos.palma.efecto === "oleaje";
        efectosActivos.tormenta = efectoPoint === "tormenta";
        efectosActivos.corriente = efectoPeace === "corriente";
        efectosActivos.noche = efectoPinza === "noche";

        oleajeConfig = efectosActivos.oleaje ? Object.assign({}, obra.gestos.palma) : null;
        tormentaConfig = efectosActivos.tormenta
            ? Object.assign({}, obra.gestos.point)
            : null;
        corrienteConfig = efectosActivos.corriente
            ? Object.assign({}, obra.gestos.peace)
            : null;
        nocheConfig = efectosActivos.noche
            ? Object.assign({}, obra.gestos.pinza)
            : null;
        astroConfig = obra.astro
            ? { x: obra.astro.x, y: obra.astro.y, radio: obra.astro.radio }
            : null;
        emisoresBase = Array.isArray(obra.espuma)
            ? obra.espuma.map((punto) => ({ x: punto.x, y: punto.y }))
            : [];
        emisoresEspuma = emisoresBase.slice();

        barcasActivas = Array.isArray(obra.barcas)
            ? obra.barcas.map((barca) => Object.assign({ actividad: 0 }, barca))
            : [];
        faseBarcas = 0;
        mascaraPesos = null;
        oleajeNeutral = null;
        oleajeUltimaPalma = 0;
        oleaje.objetivo = 0;
        oleaje.desplazamiento = 0;
        oleaje.velocidad = 0;
        oleaje.fase = 0;
        oleaje.activo = false;
        oleaje.palmaSuave = 0;
        oleaje.ambiente = 0;

        zonasActivas = Array.isArray(obra.zonas)
            ? obra.zonas.map((zona) => ({ ...zona }))
            : [];

        cuerposActivos = Array.isArray(obra.cuerpos)
            ? obra.cuerpos.map((cuerpo) => ({ ...cuerpo }))
            : [];

        // Estado fresco del molino en cada obra.
        molinoHasta = 0;
        ultimoConMano = performance.now();
        girando = false;
        desenrollando = false;
        fase = 0;
        velocidad = 0;
        vientoActual = 0;
        faseViento = 0;

        // Resplandor: cada obra arranca con la pintura original.
        iluminacion = 0;
        objetivoIluminacion = 0;
        imagenResplandor = null;

        // Meteoritos: pizarra limpia.
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        ultimaEntrada = null;

        // Tormenta: pizarra limpia.
        tormenta.nivel = 0;
        tormenta.activa = false;
        tormenta.acumulador = 0;
        tormenta.fase = 0;
        tormenta.destello = 0;
        tormenta.proximoRayo = 0;
        gotas.length = 0;
        salpicaduras.length = 0;
        rayos.length = 0;

        // Corriente: pizarra limpia.
        corriente.nivel = 0;
        corriente.activa = false;
        corriente.ax = 0.5;
        corriente.ay = 0.5;
        corriente.bx = 0.5;
        corriente.by = 0.5;
        corriente.objetivoAx = 0.5;
        corriente.objetivoAy = 0.5;
        corriente.objetivoBx = 0.5;
        corriente.objetivoBy = 0.5;
        corriente.fase = 0;
        corriente.acumulador = 0;
        corrienteEspuma.length = 0;

        // Noche: pizarra limpia.
        noche.nivel = 0;
        noche.activa = false;
        noche.fase = 0;
        estrellas = [];

        if (!sketchRef) return;

        const id = ++solicitudId;

        if (oleajeConfig && obra.mascara) {
            cargarMascara(obra.mascara, id);
        } else if (oleajeConfig) {
            console.warn("La obra declara oleaje pero no tiene máscara:", obra.id);
        }

        sketchRef.loadImage(
            obra.archivo,
            function (cargada) {
                if (id !== solicitudId) return; // una carga más nueva ya ganó
                imagen = cargada;
                dimensiones = { ancho: cargada.width, alto: cargada.height };
                imagenResplandor = efectosActivos.resplandor
                    ? crearVersionResplandor(cuerposActivos)
                    : null;
            },
            function () {
                if (id !== solicitudId) return;
                console.error("No se pudo cargar la imagen:", obra.archivo);
            }
        );
    }

    function actualizar(estado) {
        if (!estado) return;
        ultimaEntrada = estado;
        if (estado.manos > 0) {
            ultimoConMano = performance.now();

            // La pinza manda sobre los cuatro cuerpos a la vez: cerrada
            // enciende el resplandor, abierta lo apaga. Sin manos no se toca
            // el objetivo: se conserva el último estado.
            if (efectosActivos.resplandor) {
                objetivoIluminacion = estado.pinzaCerrada ? 1 : 0;
            }
        }
        if (efectosActivos.molino && estado.molino) {
            molinoHasta = performance.now() + 900;
        }

        // Tormenta: el índice extendido la sostiene; al bajarlo escampa.
        if (tormentaConfig) {
            tormenta.activa = !!estado.point;
        }

        // Corriente: una mano en paz abre el canal; se apaga al bajarla.
        if (corrienteConfig) {
            corriente.activa = !!estado.corriente;
            if (corriente.activa) {
                corriente.objetivoAx = estado.corriente.ax;
                corriente.objetivoAy = estado.corriente.ay;
                corriente.objetivoBx = estado.corriente.bx;
                corriente.objetivoBy = estado.corriente.by;
            }
        }

        // Noche: la pinza cerrada la hace caer; al abrirla amanece.
        if (nocheConfig) {
            noche.activa = !!estado.pinzaCerrada;
        }

        // Oleaje: la posición de la palma se mide en cada frame; el arrastre
        // real lo integra el resorte en el dibujo (pasoOleaje).
        if (oleajeConfig) {
            oleaje.activo = estado.manos > 0 && !!estado.palma;
            if (oleaje.activo) {
                oleaje.palmaX = estado.palmaX || 0;
                oleajeUltimaPalma = performance.now();
            }
        }
    }

    function estadoMolino() {
        return {
            girando,
            desenrollando,
            revertir: performance.now() - ultimoConMano > REVERTIR_MS,
        };
    }

    function obtenerDimensiones() {
        return dimensiones ? { ancho: dimensiones.ancho, alto: dimensiones.alto } : null;
    }

    function destruir() {
        if (instancia) {
            instancia.remove();
        }
        if (instanciaEfectos) {
            instanciaEfectos.remove();
        }
        instancia = null;
        sketchRef = null;
        instanciaEfectos = null;
        contenedor = null;
        imagen = null;
        dimensiones = null;
        obraActual = null;
        zonasActivas = [];
        cuerposActivos = [];
        imagenResplandor = null;
        iluminacion = 0;
        objetivoIluminacion = 0;
        molinoHasta = 0;
        ultimoConMano = 0;
        girando = false;
        desenrollando = false;
        fase = 0;
        velocidad = 0;
        vientoActual = 0;
        faseViento = 0;
        oleajeConfig = null;
        mascaraPesos = null;
        oleajeNeutral = null;
        oleajeUltimaPalma = 0;
        oleaje.objetivo = 0;
        oleaje.desplazamiento = 0;
        oleaje.velocidad = 0;
        oleaje.fase = 0;
        oleaje.activo = false;
        oleaje.palmaSuave = 0;
        oleaje.ambiente = 0;
        efectosActivos.molino = false;
        efectosActivos.meteoros = false;
        efectosActivos.viento = false;
        efectosActivos.resplandor = false;
        efectosActivos.oleaje = false;
        efectosActivos.tormenta = false;
        efectosActivos.corriente = false;
        efectosActivos.noche = false;
        corrienteConfig = null;
        tormentaConfig = null;
        emisoresEspuma = [];
        emisoresBase = [];
        barcasActivas = [];
        faseBarcas = 0;
        tormenta.nivel = 0;
        tormenta.activa = false;
        tormenta.acumulador = 0;
        tormenta.fase = 0;
        tormenta.destello = 0;
        tormenta.proximoRayo = 0;
        gotas.length = 0;
        salpicaduras.length = 0;
        rayos.length = 0;
        corriente.nivel = 0;
        corriente.activa = false;
        corriente.acumulador = 0;
        corriente.fase = 0;
        corrienteEspuma.length = 0;
        nocheConfig = null;
        noche.nivel = 0;
        noche.activa = false;
        noche.fase = 0;
        estrellas = [];
        astroConfig = null;
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        ultimaEntrada = null;
        solicitudId += 1;
        ultimoTiempo = 0;
        ultimoTiempoEfectos = 0;
    }

    return { montar, cargar, actualizar, estadoMolino, dimensiones: obtenerDimensiones, destruir };
})();
