// Motor visual de Pinceladas de Vida.
//
// Carga una pintura del catálogo (js/obras.js) y la representa en un lienzo
// de p5.js en modo instancia con WEBGL: una malla texturizada de 60×40 que
// permite deformaciones localizadas por zona.
//
// Interacciones:
//   - Índice extendido: los remolinos giran sobre sí mismos como un molino
//     de viento, con arranque y freno suaves.
//   - Paz: lluvia de meteoritos que rebotan dentro del lienzo (La noche
//     estrellada) o tormenta —nubes, lluvia, relámpagos y truenos— en las
//     obras que configuran pazEfecto: "tormenta".
//   - Pinza: mientras está cerrada enciende el resplandor de los cuerpos
//     celestes de la obra (todos a la vez) y oscurece el resto de la pintura
//     para generar contraste; al soltar, el brillo adicional desaparece con
//     un fundido suave y la luz de fondo vuelve a la normalidad.
//   - Pinza (profundidad): en las obras con pinzaEfecto: "profundidad", la
//     distancia entre los dedos controla el zoom: pinza cerrada acerca la
//     vista manteniendo la proporción, abierta vuelve a la foto original.
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

    // Tormenta (pazEfecto: "tormenta"): nubes, lluvia, relámpagos y oscuridad.
    let tormenta = 0;
    let objetivoTormenta = 0;
    let gotasAcumulador = 0;
    const gotasLluvia = [];
    const nubes = [];
    const relampagos = [];
    let destello = 0;
    let proximoRelampago = 0;

    let molinoHasta = 0; // instante hasta el que el molino sigue vivo (ms)
    let ultimoConMano = 0; // última vez que se vio una mano (ms)
    let girando = false;
    let desenrollando = false;
    let fase = 0;
    let velocidad = 0;
    let ultimoTiempo = 0;
    let vientoActual = 0; // desplazamiento horizontal suavizado (px de imagen)
    let faseViento = 0; // onda de la brisa que viaja con el viento
    let profundidad = 0; // profundidad visual controlada por la pinza
    let objetivoProfundidad = 0;
    let atmosfera = 0; // atmósfera de la obra (palma vertical)
    let objetivoAtmosfera = 0;

    // Despeje de la niebla (índice en movimiento horizontal): la posición de
    // la mano corre el frente de la niebla y revela la obra sin nubes.
    const MASCARA_ANCHO = 192; // resolución de la máscara del borde de niebla
    const MASCARA_ALTO = 128;
    let despeje = 0; // 0 = niebla completa, 1 = montañas al descubierto
    let objetivoDespeje = 0;
    let nieblaFase = 0; // fase de las ondas del borde (la mueve la mano)
    let despejeImagen = null; // obra con la niebla despejada
    let capaDespeje = null; // capa auxiliar del revelado
    let mascaraDespeje = null; // máscara del borde de niebla
    let mascaraDatos = null; // ImageData reutilizable de la máscara

    // Resplandor de los cuerpos celestes (la pinza cerrada lo enciende).
    let cuerposActivos = [];
    let lucesActivas = [];
    let personaje = null; // PNG del personaje (mismo tamaño, con alfa)
    let fondoImagen = null; // fondo de la obra (sin el personaje)
    let pinturaTinte = null; // pintura completa para el color grading
    let auraPersonaje = null; // silueta cálida difuminada para el halo
    let personajeCaja = null; // centro y radio del personaje (px de imagen)
    let capaAtmosfera = null; // capa auxiliar del etalonaje base
    let capaCielo = null; // capa auxiliar del refuerzo de cielo
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

                    // Profundidad de la pinza: fundido suave hacia el objetivo.
                    profundidad += (objetivoProfundidad - profundidad) * Math.min(1, dt * 4);
                    if (Math.abs(objetivoProfundidad - profundidad) < 0.002) {
                        profundidad = objetivoProfundidad;
                    }

                    // Atmósfera: la palma vertical la cambia progresivamente
                    // (despejado -> nublado -> oscuro).
                    atmosfera += (objetivoAtmosfera - atmosfera) * Math.min(1, dt * 2);
                    if (Math.abs(objetivoAtmosfera - atmosfera) < 0.002) {
                        atmosfera = objetivoAtmosfera;
                    }

                    // Despeje de la niebla: apenas aparece el índice se revela
                    // la obra sin nubes; al quitarlo, la niebla vuelve lenta.
                    if (obraActual && obraActual.indiceEfecto === "despejar") {
                        const suavidadDespeje = objetivoDespeje > despeje ? 1.5 : 0.45;
                        despeje +=
                            (objetivoDespeje - despeje) * Math.min(1, dt * suavidadDespeje);
                        if (Math.abs(objetivoDespeje - despeje) < 0.002) {
                            despeje = objetivoDespeje;
                        }
                        nieblaFase += dt * 0.6;
                    } else if (despeje !== 0 || objetivoDespeje !== 0) {
                        despeje = 0;
                        objetivoDespeje = 0;
                    }

                    // Viento: la velocidad de la palma abierta define el
                    // desplazamiento; al detenerse o perderse la mano, el
                    // objetivo es 0 y las pinceladas vuelven solas. Solo
                    // actúa si la obra lo tiene habilitado (viento: true).
                    const vientoDeObra = !!(obraActual && obraActual.viento);
                    const velocidadViento =
                        vientoDeObra && ultimaEntrada && ultimaEntrada.vientoManos > 0
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

                    dibujarTormenta(p);
                    dibujarAtmosfera(p);
                    dibujarDespeje(p);
                    dibujarNubesAura(p);

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
        // El gesto de la paz hace algo distinto según la obra: meteoritos
        // (La noche estrellada) o tormenta (El caminante). Obras sin
        // configuración: el gesto queda inactivo.
        const efectoPaz =
            obraActual && (obraActual.pazEfecto || (obraActual.meteoritos ? "meteoritos" : null));

        if (efectoPaz === "meteoritos") {
            actualizarMeteoritos(estado, dt, revertir);
        } else if (efectoPaz === "tormenta") {
            actualizarTormenta(estado, dt, revertir);
        } else if (tormenta > 0.001) {
            // Se cambió a una obra sin tormenta: limpiar y apagar el sonido.
            limpiarTormenta();
        }
    }

    // Lluvia de meteoritos: la paz los dispara por toda la obra.
    function actualizarMeteoritos(estado, dt, revertir) {
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

    // Tormenta: al mantener la paz, las nubes se acumulan, el cielo se
    // oscurece y caen lluvia y relámpagos con sus sonidos; al soltar el
    // gesto, la obra vuelve poco a poco a la normalidad.
    function actualizarTormenta(estado, dt, revertir) {
        const hayPaz = !!(estado && estado.paz);

        objetivoTormenta = hayPaz && !revertir ? 1 : 0;

        // Sube con el gesto y baja poco a poco al soltarlo.
        const ritmo = objetivoTormenta > tormenta ? 1.4 : 0.35;
        tormenta += (objetivoTormenta - tormenta) * Math.min(1, dt * ritmo);

        if (tormenta <= 0.001) {
            limpiarTormenta();
            return;
        }

        // Sonido de lluvia proporcional a la intensidad.
        if (typeof Musica !== "undefined" && Musica.tormenta) {
            Musica.tormenta(tormenta);
        }

        // Nubes que se acumulan y crecen en el cielo.
        if (nubes.length < 22) {
            nubes.push({
                x: Math.random(),
                y: Math.random() * 0.5,
                r: 0.06 + Math.random() * 0.1,
                vx: (Math.random() - 0.5) * 0.02,
                crecimiento: 0,
            });
        }
        for (const nube of nubes) {
            nube.x += nube.vx * dt;
            nube.crecimiento += dt * 0.8;
            if (nube.x < -0.2) nube.x = 1.2;
            if (nube.x > 1.2) nube.x = -0.2;
        }
        // Al calmarse la tormenta, las nubes se disuelven.
        for (let i = nubes.length - 1; i >= 0; i -= 1) {
            if (tormenta < 0.15 && Math.random() < dt * 2.5) nubes.splice(i, 1);
        }

        // Lluvia: gotas que caen inclinadas, con más fuerza a mayor tormenta.
        gotasAcumulador += 120 * tormenta * dt;
        while (gotasAcumulador >= 1) {
            gotasAcumulador -= 1;
            gotasLluvia.push({
                x: Math.random(),
                y: -0.02 - Math.random() * 0.1,
                vy: 1.1 + Math.random() * 0.7,
                vx: 0, // lluvia vertical
            });
        }
        if (gotasLluvia.length > 320) {
            gotasLluvia.splice(0, gotasLluvia.length - 320);
        }
        for (let i = gotasLluvia.length - 1; i >= 0; i -= 1) {
            const gota = gotasLluvia[i];
            gota.x += gota.vx * dt;
            gota.y += gota.vy * dt;
            if (gota.y > 1.02) gotasLluvia.splice(i, 1);
        }

        // Relámpagos: rayo + destello + trueno.
        const ahoraMs = performance.now();
        if (tormenta > 0.25 && ahoraMs > proximoRelampago) {
            proximoRelampago = ahoraMs + 2200 + Math.random() * 3200;
            relampagos.push(crearRayo());
            destello = 1;
            if (typeof Musica !== "undefined" && Musica.trueno) {
                Musica.trueno();
            }
        }
        destello = Math.max(0, destello - dt * 5);

        for (let i = relampagos.length - 1; i >= 0; i -= 1) {
            relampagos[i].vida -= dt;
            if (relampagos[i].vida <= 0) relampagos.splice(i, 1);
        }
    }

    function crearRayo() {
        const puntos = [];
        let x = Math.random();
        let y = -0.02;
        puntos.push({ x, y });
        while (y < 0.75) {
            x += (Math.random() - 0.5) * 0.18;
            y += 0.08 + Math.random() * 0.1;
            puntos.push({ x, y });
        }
        return { puntos, vida: 0.12 + Math.random() * 0.15 };
    }

    function limpiarTormenta() {
        tormenta = 0;
        objetivoTormenta = 0;
        gotasLluvia.length = 0;
        nubes.length = 0;
        relampagos.length = 0;
        destello = 0;
        if (typeof Musica !== "undefined" && Musica.tormenta) {
            Musica.tormenta(0);
        }
    }

    function dibujarTormenta(p) {
        if (tormenta <= 0.001) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ladoMenor = Math.min(dimensiones.ancho, dimensiones.alto);

        // Todo el clima queda recortado al rectángulo de la pintura.
        ctx.save();

        // El clima se acopla al zoom de la pinza: misma escala uniforme
        // alrededor del centro de la pintura que aplica la malla.
        if (profundidad > 0.001) {
            const cxZoom = vista.offsetX + vista.anchoDibujo / 2;
            const cyZoom = vista.offsetY + vista.altoDibujo / 2;
            const escalaZoom = 1 + profundidad * 0.4;
            ctx.translate(cxZoom, cyZoom);
            ctx.scale(escalaZoom, escalaZoom);
            ctx.translate(-cxZoom, -cyZoom);
        }

        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // 1. El cielo se oscurece.
        p.push();
        p.noStroke();
        p.fill(5, 10, 25, Math.min(220, tormenta * 165));
        p.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        p.pop();

        // 2. Nubes que se acumulan.
        for (const nube of nubes) {
            const c = aVista(nube.x, nube.y, p, vista);
            const r = nube.r * ladoMenor * vista.fit * Math.min(1.4, 0.4 + nube.crecimiento);
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
            grad.addColorStop(0, `rgba(34, 40, 60, ${(0.3 * tormenta).toFixed(3)})`);
            grad.addColorStop(1, "rgba(24, 30, 48, 0)");
            p.push();
            p.noStroke();
            ctx.fillStyle = grad;
            ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
            p.pop();
        }

        // 3. Lluvia.
        p.push();
        p.strokeCap(p.ROUND);
        for (const gota of gotasLluvia) {
            const a = aVista(gota.x, gota.y, p, vista);
            const b = aVista(gota.x - gota.vx * 0.035, gota.y - gota.vy * 0.02, p, vista);
            p.stroke(`rgba(190, 215, 245, ${(0.5 * tormenta).toFixed(3)})`);
            p.strokeWeight(Math.max(1, vista.anchoDibujo * 0.0012));
            p.line(a.x, a.y, b.x, b.y);
        }
        p.pop();

        // 4. Relámpagos.
        for (const rayo of relampagos) {
            const alpha = Math.max(0, Math.min(1, rayo.vida / 0.15));
            p.push();
            p.noFill();
            p.stroke(220, 230, 255, Math.round(alpha * 255));
            p.strokeWeight(Math.max(2, vista.anchoDibujo * 0.004));
            p.beginShape();
            for (const punto of rayo.puntos) {
                const c = aVista(punto.x, punto.y, p, vista);
                p.vertex(c.x, c.y);
            }
            p.endShape();
            p.pop();
        }

        // 5. Destello general del relámpago.
        if (destello > 0.01) {
            p.push();
            p.noStroke();
            p.fill(255, 255, 255, Math.min(140, destello * 90));
            p.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
            p.pop();
        }

        ctx.restore();
    }

    // Devuelve una capa auxiliar limpia del tamaño del lienzo de efectos.
    function prepararCapaAuxiliar(capa, p) {
        const canvas = capa || document.createElement("canvas");
        if (canvas.width !== p.width || canvas.height !== p.height) {
            canvas.width = p.width;
            canvas.height = p.height;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return canvas;
    }

    // Hora del día con la palma horizontal: a la derecha la obra toma los
    // tonos cálidos de un atardecer; a la izquierda, el frío de un anochecer.
    // En vez de un filtro plano se hace un color grading: la pintura completa
    // (nofondo-caminante) se calibra con multiply + screen para que todo el
    // cuadro —personaje incluido— se adapte al entorno, y encima se refuerza
    // el cielo recortado por el alfa de fondo-caminante.
    function dibujarAtmosfera(p) {
        if (Math.abs(atmosfera) <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const intensidad = Math.min(1, Math.abs(atmosfera));
        const ladoMenor = Math.min(dimensiones.ancho, dimensiones.alto);

        const x = vista.offsetX;
        const y = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;

        // Misma escala de zoom que la malla.
        const cxZoom = x + ancho / 2;
        const cyZoom = y + alto / 2;
        const escalaZoom = 1 + profundidad * 0.4;

        const base = pinturaTinte || imagen;

        // 1) Etalonaje de los elementos: el nuevo nofondo-caminante trae al
        // personaje y la piedra con transparencia, así que ambos reciben
        // exactamente la misma tonalidad con la luz de la hora.
        capaAtmosfera = prepararCapaAuxiliar(capaAtmosfera, p);
        const capa = capaAtmosfera.getContext("2d");
        capa.save();
        capa.translate(cxZoom, cyZoom);
        capa.scale(escalaZoom, escalaZoom);
        capa.translate(-cxZoom, -cyZoom);
        capa.beginPath();
        capa.rect(x, y, ancho, alto);
        capa.clip();

        capa.drawImage(base.canvas, x, y, ancho, alto);

        // Se levantan apenas las sombras (blacks lift): así la piedra oscura
        // recibe la luz de la hora con la misma tonalidad que el personaje,
        // en vez de encenderse en los extremos.
        capa.globalCompositeOperation = "screen";
        capa.fillStyle = "rgba(108, 108, 108, 0.12)";
        capa.fillRect(x, y, ancho, alto);

        // La luz de la hora lava la escena: primero se baja la saturación
        // para que el tinte no encienda los colores de la piedra.
        capa.globalCompositeOperation = "saturation";
        capa.fillStyle = "rgba(128, 128, 128, 0.35)";
        capa.fillRect(x, y, ancho, alto);

        if (atmosfera > 0) {
            // Atardecer: sombras cálidas y luces doradas.
            capa.globalCompositeOperation = "multiply";
            capa.fillStyle = "rgba(255, 158, 92, 0.45)";
            capa.fillRect(x, y, ancho, alto);
            capa.globalCompositeOperation = "screen";
            capa.fillStyle = "rgba(255, 150, 80, 0.1)";
        } else {
            // Anochecer: sombras azul profundo y luces frías.
            capa.globalCompositeOperation = "multiply";
            capa.fillStyle = "rgba(38, 60, 138, 0.48)";
            capa.fillRect(x, y, ancho, alto);
            capa.globalCompositeOperation = "screen";
            capa.fillStyle = "rgba(30, 70, 160, 0.1)";
        }
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "source-over";

        // El etalonaje solo debe quedar donde la base tiene contenido: los
        // rellenos de blend pintan también sobre las zonas transparentes.
        capa.globalCompositeOperation = "destination-in";
        capa.drawImage(base.canvas, x, y, ancho, alto);
        capa.globalCompositeOperation = "source-over";
        capa.restore();

        // 2) Refuerzo del cielo: el mismo etalonaje aplicado a
        // fondo-caminante, recortado por su alfa para no tocar el resto.
        if (fondoImagen) {
            capaCielo = prepararCapaAuxiliar(capaCielo, p);
            const cielo = capaCielo.getContext("2d");
            cielo.save();
            cielo.translate(cxZoom, cyZoom);
            cielo.scale(escalaZoom, escalaZoom);
            cielo.translate(-cxZoom, -cyZoom);
            cielo.beginPath();
            cielo.rect(x, y, ancho, alto);
            cielo.clip();

            cielo.drawImage(fondoImagen.canvas, x, y, ancho, alto);

            // Mismo criterio que en el etalonaje base: suavizar la
            // saturación antes de teñir el cielo con la luz de la hora.
            cielo.globalCompositeOperation = "saturation";
            cielo.fillStyle = "rgba(128, 128, 128, 0.25)";
            cielo.fillRect(x, y, ancho, alto);

            if (atmosfera > 0) {
                cielo.globalCompositeOperation = "multiply";
                cielo.fillStyle = "rgba(255, 165, 95, 0.45)";
                cielo.fillRect(x, y, ancho, alto);
                cielo.globalCompositeOperation = "screen";
                cielo.fillStyle = "rgba(255, 140, 70, 0.15)";
            } else {
                cielo.globalCompositeOperation = "multiply";
                cielo.fillStyle = "rgba(28, 48, 125, 0.48)";
                cielo.fillRect(x, y, ancho, alto);
                cielo.globalCompositeOperation = "screen";
                cielo.fillStyle = "rgba(25, 65, 155, 0.13)";
            }
            cielo.fillRect(x, y, ancho, alto);
            cielo.globalCompositeOperation = "source-over";

            // El teñido del cielo solo queda donde el fondo tiene imagen:
            // sin esto, el velo de los blend caía sobre la piedra y todo lo
            // que el fondo deja transparente.
            cielo.globalCompositeOperation = "destination-in";
            cielo.drawImage(fondoImagen.canvas, x, y, ancho, alto);
            cielo.globalCompositeOperation = "source-over";

            // El refuerzo extra no toca al personaje.
            if (personaje) {
                cielo.globalCompositeOperation = "destination-out";
                cielo.drawImage(personaje.canvas, x, y, ancho, alto);
            }

            cielo.globalCompositeOperation = "source-over";
            cielo.restore();

            // Se apila el cielo sobre el etalonaje base.
            capa.drawImage(capaCielo, 0, 0);
        }

        // 3) Se funde el conjunto con la intensidad de la hora.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = intensidad * 0.9;
        ctx.drawImage(capaAtmosfera, 0, 0);
        ctx.restore();

        // Luna a la izquierda y sol a la derecha, complementando los colores.
        const luna = Math.max(0, -atmosfera);
        const sol = Math.max(0, atmosfera);
        if (luna <= 0.02 && sol <= 0.02) return;

        ctx.save();
        p.push();
        ctx.translate(cxZoom, cyZoom);
        ctx.scale(escalaZoom, escalaZoom);
        ctx.translate(-cxZoom, -cyZoom);
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        if (luna > 0.02) {
            const c = aVista(0.18, 0.18, p, vista);
            const r = ladoMenor * vista.fit * 0.07;
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 3);
            grad.addColorStop(0, `rgba(220, 230, 255, ${(0.9 * luna).toFixed(3)})`);
            grad.addColorStop(0.4, `rgba(180, 200, 255, ${(0.35 * luna).toFixed(3)})`);
            grad.addColorStop(1, "rgba(160, 185, 255, 0)");

            ctx.fillStyle = grad;
            ctx.fillRect(c.x - r * 3, c.y - r * 3, r * 6, r * 6);
            p.fill(235, 240, 255, Math.round(255 * luna));
            p.noStroke();
            p.circle(c.x, c.y, r * 2);
        }

        if (sol > 0.02) {
            const c = aVista(0.82, 0.2, p, vista);
            const r = ladoMenor * vista.fit * 0.075;
            const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 3.2);
            grad.addColorStop(0, `rgba(255, 235, 170, ${(0.95 * sol).toFixed(3)})`);
            grad.addColorStop(0.35, `rgba(255, 180, 90, ${(0.4 * sol).toFixed(3)})`);
            grad.addColorStop(1, "rgba(255, 150, 60, 0)");

            ctx.fillStyle = grad;
            ctx.fillRect(c.x - r * 3.2, c.y - r * 3.2, r * 6.4, r * 6.4);
            p.fill(255, 240, 190, Math.round(255 * sol));
            p.noStroke();
            p.circle(c.x, c.y, r * 2);
        }

        p.pop();
        ctx.restore();
    }

    // Máscara del borde de niebla: un frente con ondas suaves que avanza
    // de izquierda a derecha según el despeje.
    function actualizarMascaraDespeje() {
        if (!mascaraDespeje) {
            mascaraDespeje = document.createElement("canvas");
            mascaraDespeje.width = MASCARA_ANCHO;
            mascaraDespeje.height = MASCARA_ALTO;
            mascaraDatos = mascaraDespeje
                .getContext("2d")
                .createImageData(MASCARA_ANCHO, MASCARA_ALTO);
        }
        const ctx = mascaraDespeje.getContext("2d");
        const datos = mascaraDatos;
        const buffer = datos.data;

        // El frente entra desde la izquierda y puede salir por la derecha.
        const frente = despeje * 1.2 - 0.1;

        for (let y = 0; y < MASCARA_ALTO; y++) {
            const v = y / (MASCARA_ALTO - 1);
            // Borde irregular: tres ondas, la fase la arrastra la mano.
            const ola =
                0.05 * Math.sin(v * 6.5 + nieblaFase) +
                0.03 * Math.sin(v * 16 - nieblaFase * 1.7) +
                0.015 * Math.sin(v * 33 + nieblaFase * 0.6);

            for (let x = 0; x < MASCARA_ANCHO; x++) {
                const u = x / (MASCARA_ANCHO - 1);
                const alpha = Math.max(0, Math.min(1, (frente + ola - u) / 0.07));
                const i = (y * MASCARA_ANCHO + x) * 4;
                buffer[i] = 255;
                buffer[i + 1] = 255;
                buffer[i + 2] = 255;
                buffer[i + 3] = Math.round(255 * alpha);
            }
        }

        ctx.putImageData(datos, 0, 0);
        return mascaraDespeje;
    }

    // La niebla se corre con la mano y se despeja: se revela la versión de la
    // obra con las montañas al descubierto, recortada por el borde de niebla.
    function dibujarDespeje(p) {
        if (!despejeImagen || despeje <= 0.004) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;

        const x = vista.offsetX;
        const y = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;

        // Misma escala de zoom que la malla.
        const cxZoom = x + ancho / 2;
        const cyZoom = y + alto / 2;
        const escalaZoom = 1 + profundidad * 0.4;

        const mascara = actualizarMascaraDespeje();

        capaDespeje = prepararCapaAuxiliar(capaDespeje, p);
        const capa = capaDespeje.getContext("2d");
        capa.save();
        capa.translate(cxZoom, cyZoom);
        capa.scale(escalaZoom, escalaZoom);
        capa.translate(-cxZoom, -cyZoom);
        capa.beginPath();
        capa.rect(x, y, ancho, alto);
        capa.clip();

        capa.drawImage(despejeImagen.canvas, x, y, ancho, alto);

        // El borde de niebla recorta el revelado con un fundido suave.
        capa.globalCompositeOperation = "destination-in";
        capa.drawImage(mascara, x, y, ancho, alto);
        capa.globalCompositeOperation = "source-over";
        capa.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(capaDespeje, 0, 0);
        ctx.restore();
    }

    // Nubes amarillas que rodean al personaje mientras se hace zoom.
    function dibujarNubesAura(p) {
        if (!personajeCaja || profundidad <= 0.02) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ahora = performance.now() / 1000;

        ctx.save();

        // Misma escala de zoom que la malla, para que las nubes no floten.
        const cxZoom = vista.offsetX + vista.anchoDibujo / 2;
        const cyZoom = vista.offsetY + vista.altoDibujo / 2;
        const escalaZoom = 1 + profundidad * 0.4;
        ctx.translate(cxZoom, cyZoom);
        ctx.scale(escalaZoom, escalaZoom);
        ctx.translate(-cxZoom, -cyZoom);

        const centro = aVista(
            personajeCaja.cx / dimensiones.ancho,
            personajeCaja.cy / dimensiones.alto,
            p,
            vista
        );
        const baseR = personajeCaja.radio * vista.fit;

        p.push();
        p.noStroke();
        ctx.globalCompositeOperation = "lighter";

        const puffs = 18;
        for (let i = 0; i < puffs; i += 1) {
            // Dos brazos espirales que giran sobre el personaje, como una
            // galaxia: el radio crece a lo largo de cada brazo.
            const brazo = i % 2;
            const avance = i / puffs;
            const angulo = brazo * Math.PI + avance * Math.PI * 2 + ahora * 0.5;
            const radio =
                baseR * (1.6 + 0.5 * avance + 0.1 * Math.sin(ahora * 0.5 + i));
            const x = centro.x + Math.cos(angulo) * radio;
            const y = centro.y + Math.sin(angulo) * radio * 0.9;
            const tamano = baseR * (0.32 + 0.1 * Math.sin(ahora * 0.9 + i));
            const alpha = Math.max(
                0,
                profundidad * (0.6 + 0.2 * Math.sin(ahora * 1.2 + i * 2.1))
            );

            const grad = ctx.createRadialGradient(x, y, 0, x, y, tamano);
            grad.addColorStop(0, `rgba(160, 205, 255, ${alpha.toFixed(3)})`);
            grad.addColorStop(0.6, `rgba(110, 165, 255, ${(alpha * 0.6).toFixed(3)})`);
            grad.addColorStop(1, "rgba(80, 130, 245, 0)");
            ctx.fillStyle = grad;
            ctx.fillRect(x - tamano, y - tamano, tamano * 2, tamano * 2);
        }

        // El personaje tapa las nubes: se recortan con su silueta, así la
        // galaxia gira por detrás y nunca se dibuja encima de él.
        if (personaje) {
            ctx.globalCompositeOperation = "destination-out";
            ctx.drawImage(
                personaje.canvas,
                vista.offsetX,
                vista.offsetY,
                vista.anchoDibujo,
                vista.altoDibujo
            );
        }

        ctx.globalCompositeOperation = "source-over";
        p.pop();
        ctx.restore();
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

        // Zoom controlado por la pinza: al cerrarla, la obra se acerca
        // manteniendo la proporción (vista en primera persona); al abrirla,
        // vuelve a la foto original.
        if (profundidad > 0.001) {
            const cx = dimensiones.ancho / 2;
            const cy = dimensiones.alto / 2;
            const escala = 1 + profundidad * 0.4;
            x = cx + (x - cx) * escala;
            y = cy + (y - cy) * escala;
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

    function dibujarMalla(p) {
        const vista = vistaPintura(p);

        p.noStroke();
        p.textureMode(p.NORMAL);

        // Pasada base: la pintura original. Con el zoom se oscurece casi a
        // negro (80%) para que el aura resalte.
        const oscurecer = iluminacion * OSCURECER_MAX + profundidad * 0.8;
        const brillo = 255 * (1 - oscurecer);
        p.tint(brillo, brillo, brillo);
        dibujarPasada(p, vista, imagen, 0);
        p.noTint();

        // Pasada de resplandor de los cuerpos celestes (pinza en las obras
        // que la usan): capa de solo luz sumada aditivamente.
        if (imagenResplandor && iluminacion > 0.002) {
            p.blendMode(p.ADD);
            p.tint(255, 255 * iluminacion);
            dibujarPasada(p, vista, imagenResplandor, 0.5);
            p.blendMode(p.BLEND);
            p.noTint();
        }

        // Aura del personaje: halo difuminado que sigue su silueta y se
        // enciende con el zoom; el personaje también se ilumina. Dos pasadas
        // del halo para que el aura sea bien intensa.
        if (personaje && profundidad > 0.002) {
            p.blendMode(p.ADD);
            if (auraPersonaje) {
                p.tint(255, 255 * profundidad * 0.9);
                dibujarPasada(p, vista, auraPersonaje, 0.55);
                dibujarPasada(p, vista, auraPersonaje, 0.56);
            }
            p.tint(255, 255 * profundidad * 0.12);
            dibujarPasada(p, vista, personaje, 0.6);
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

    // --- Aura del personaje (zoom) -----------------------------------------
    // Convierte el PNG del personaje (mismo tamaño que la pintura, con alfa)
    // en una silueta cálida difuminada: el halo que se enciende con el zoom.
    function crearAuraPersonaje(png) {
        if (!png || !sketchRef) return null;

        const silueta = sketchRef.createGraphics(png.width, png.height);
        silueta.pixelDensity(1);
        silueta.image(png, 0, 0);

        const ctxSilueta = silueta.drawingContext;
        ctxSilueta.globalCompositeOperation = "source-in";
        ctxSilueta.fillStyle = "rgba(255, 244, 205, 1)";
        ctxSilueta.fillRect(0, 0, png.width, png.height);
        ctxSilueta.globalCompositeOperation = "source-over";

        const halo = sketchRef.createGraphics(png.width, png.height);
        halo.pixelDensity(1);
        halo.drawingContext.filter = "blur(42px)";
        halo.image(silueta, 0, 0);
        halo.drawingContext.filter = "none";

        // Caja del personaje (centro y radio), para ubicar sus nubes.
        png.loadPixels();
        let minX = png.width;
        let minY = png.height;
        let maxX = 0;
        let maxY = 0;
        for (let y = 0; y < png.height; y += 4) {
            for (let x = 0; x < png.width; x += 4) {
                const alfa = png.pixels[(y * png.width + x) * 4 + 3];
                if (alfa > 20) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        personajeCaja =
            maxX > minX && maxY > minY
                ? {
                      cx: (minX + maxX) / 2,
                      cy: (minY + maxY) / 2,
                      radio: Math.max(maxX - minX, maxY - minY) / 2,
                  }
                : null;

        return halo;
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

        lucesActivas = Array.isArray(obra.luces)
            ? obra.luces.map((luz) => ({ ...luz }))
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
        profundidad = 0;
        objetivoProfundidad = 0;
        atmosfera = 0;
        objetivoAtmosfera = 0;

        // Resplandor: cada obra arranca con la pintura original.
        iluminacion = 0;
        objetivoIluminacion = 0;
        imagenResplandor = null;
        personaje = null;
        fondoImagen = null;
        pinturaTinte = null;
        despejeImagen = null;
        despeje = 0;
        objetivoDespeje = 0;
        nieblaFase = 0;
        auraPersonaje = null;
        personajeCaja = null;

        // Meteoritos: pizarra limpia.
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        ultimaEntrada = null;

        // Tormenta: pizarra limpia y lluvia en silencio.
        limpiarTormenta();

        if (!sketchRef) return;

        const id = ++solicitudId;

        sketchRef.loadImage(
            obra.archivo,
            function (cargada) {
                if (id !== solicitudId) return; // una carga más nueva ya ganó
                imagen = cargada;
                dimensiones = { ancho: cargada.width, alto: cargada.height };
                imagenResplandor = crearVersionResplandor(
                    cuerposActivos.length > 0 ? cuerposActivos : lucesActivas
                );

                // Aura del personaje: se carga el PNG (mismo tamaño, con
                // alfa) y se hornea su silueta difuminada.
                if (obra.personaje) {
                    sketchRef.loadImage(
                        obra.personaje,
                        function (pngPersonaje) {
                            if (id !== solicitudId) return;
                            personaje = pngPersonaje;
                            auraPersonaje = crearAuraPersonaje(pngPersonaje);
                        },
                        function () {
                            console.error("No se pudo cargar el personaje:", obra.personaje);
                        }
                    );
                }

                // Fondo sin personaje: la atmósfera lo tiñe sin afectarlo.
                if (obra.fondo) {
                    sketchRef.loadImage(
                        obra.fondo,
                        function (imgFondo) {
                            if (id !== solicitudId) return;
                            fondoImagen = imgFondo;
                        },
                        function () {
                            console.error("No se pudo cargar el fondo:", obra.fondo);
                        }
                    );
                }

                // Pintura completa para el etalonaje de la atmósfera.
                if (obra.baseAtmosfera) {
                    sketchRef.loadImage(
                        obra.baseAtmosfera,
                        function (imgTinte) {
                            if (id !== solicitudId) return;
                            pinturaTinte = imgTinte;
                        },
                        function () {
                            console.error(
                                "No se pudo cargar la base de la atmósfera:",
                                obra.baseAtmosfera
                            );
                        }
                    );
                }

                // Obra con la niebla despejada (las montañas al descubierto).
                if (obra.despeje) {
                    sketchRef.loadImage(
                        obra.despeje,
                        function (imgDespeje) {
                            if (id !== solicitudId) return;
                            despejeImagen = imgDespeje;
                        },
                        function () {
                            console.error("No se pudo cargar el despeje:", obra.despeje);
                        }
                    );
                }
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

            if (obraActual && obraActual.palmEfecto === "atmosfera") {
                // La posición horizontal de la palma recorre la hora del
                // día: izquierda = anochecer frío, derecha = atardecer cálido.
                const x = estado.palmaX;
                objetivoAtmosfera =
                    typeof x === "number"
                        ? Math.max(-1, Math.min(1, (x - 0.5) * 2))
                        : 0;
            }

            if (obraActual && obraActual.pinzaEfecto === "profundidad") {
                // La distancia entre los dedos controla el zoom: pinza
                // cerrada acerca la vista (primera persona), abierta vuelve
                // a la foto original.
                const d = estado.pinzaDistancia;
                objetivoProfundidad =
                    typeof d === "number"
                        ? Math.max(0, Math.min(1, 1 - (d - 0.06) / 0.26))
                        : 0;
            } else {
                // La pinza manda sobre los cuerpos celestes a la vez:
                // cerrada enciende el resplandor, abierta lo apaga. Sin manos
                // no se toca el objetivo: se conserva el último estado.
                objetivoIluminacion = estado.pinzaCerrada ? 1 : 0;
            }
        }

        // Despeje de la niebla: con el índice extendido la niebla se corre y
        // se revelan las montañas; al soltar el gesto vuelve lenta a su forma.
        if (obraActual && obraActual.indiceEfecto === "despejar") {
            objetivoDespeje = estado.molino ? 1 : 0;
            if (estado.molino) {
                nieblaFase += (estado.indiceVelocidad || 0) * 9;
            }
        }

        if (estado.molino && obraActual && Array.isArray(obraActual.zonas) && obraActual.zonas.length > 0) {
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
        lucesActivas = [];
        personaje = null;
        fondoImagen = null;
        pinturaTinte = null;
        despejeImagen = null;
        despeje = 0;
        objetivoDespeje = 0;
        nieblaFase = 0;
        auraPersonaje = null;
        personajeCaja = null;
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
        profundidad = 0;
        objetivoProfundidad = 0;
        atmosfera = 0;
        objetivoAtmosfera = 0;
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        ultimaEntrada = null;
        limpiarTormenta();
        solicitudId += 1;
        ultimoTiempo = 0;
        ultimoTiempoEfectos = 0;
    }

    return { montar, cargar, actualizar, estadoMolino, dimensiones: obtenerDimensiones, destruir };
})();
