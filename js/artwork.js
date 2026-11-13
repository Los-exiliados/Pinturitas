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
//     celestes de la obra (todos a la vez); al soltar, el brillo adicional
//     desaparece con un fundido suave y vuelve la pintura original.
//   - Viento: la palma abierta en movimiento horizontal desplaza las
//     pinceladas del cielo en esa dirección; al detenerse (o perderse la
//     mano), las pinceladas vuelven suavemente a su lugar.
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

    // Resplandor de los cuerpos celestes (la pinza cerrada lo enciende).
    let cuerposActivos = [];
    let imagenResplandor = null; // pintura con el resplandor horneado
    let iluminacion = 0; // 0 = original, 1 = resplandor completo
    let objetivoIluminacion = 0;

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
                        ultimaEntrada && ultimaEntrada.vientoManos > 0
                            ? ultimaEntrada.vientoVelocidad
                            : 0;
                    const objetivoViento = Math.max(
                        -VIENTO_MAX,
                        Math.min(VIENTO_MAX, velocidadViento * VIENTO_ESCALA)
                    );
                    vientoActual += (objetivoViento - vientoActual) * Math.min(1, dt * VIENTO_SUAVIDAD);
                    if (Math.abs(objetivoViento - vientoActual) < 0.1) {
                        vientoActual = objetivoViento;
                    }

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

                    dibujarMeteoros(p);
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
        const hayPaz = !!(estado && estado.paz);
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
        // máscara (cero sobre los cuerpos celestes y el paisaje).
        if (vientoActual !== 0) {
            x += vientoActual * mascaraViento(px, py);
        }

        return { x, y };
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
                peso *= 1 - Math.exp(-(d2 / (radio * radio)) * 3);
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

    function dibujarMalla(p) {
        const vista = vistaPintura(p);

        p.noStroke();
        p.textureMode(p.NORMAL);

        // Pasada base: la pintura original.
        dibujarPasada(p, vista, imagen, 0);

        // Pasada de resplandor: la misma malla (misma deformación) con la
        // versión iluminada; el alpha del tint funde ambas y mantiene la
        // alineación exacta con la pintura, incluidos los remolinos. Un
        // offset mínimo de z evita el z-fighting entre las dos pasadas.
        if (imagenResplandor && iluminacion > 0.002) {
            p.tint(255, 255 * iluminacion);
            dibujarPasada(p, vista, imagenResplandor, 0.5);
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
    // Hornea en el propio espacio de la imagen una versión iluminada: la
    // misma pintura con un resplandor cálido y aditivo (modo "screen")
    // alrededor de cada cuerpo. Al usarla como textura de la misma malla, el
    // brillo queda siempre alineado con la pintura (incluida la deformación
    // de los remolinos) y no parece una capa superpuesta. No hay rellenos
    // negros ni máscaras opacas: solo luz que se suma a la obra.
    function crearVersionResplandor(cuerpos) {
        if (!imagen || !sketchRef || cuerpos.length === 0) return null;

        const g = sketchRef.createGraphics(imagen.width, imagen.height);
        g.pixelDensity(1);
        g.image(imagen, 0, 0);

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

        // Resplandor: cada obra arranca con la pintura original.
        iluminacion = 0;
        objetivoIluminacion = 0;
        imagenResplandor = null;

        // Meteoritos: pizarra limpia.
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        ultimaEntrada = null;

        if (!sketchRef) return;

        const id = ++solicitudId;

        sketchRef.loadImage(
            obra.archivo,
            function (cargada) {
                if (id !== solicitudId) return; // una carga más nueva ya ganó
                imagen = cargada;
                dimensiones = { ancho: cargada.width, alto: cargada.height };
                imagenResplandor = crearVersionResplandor(cuerposActivos);
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
            objetivoIluminacion = estado.pinzaCerrada ? 1 : 0;
        }
        if (estado.molino) {
            molinoHasta = performance.now() + 900;
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
