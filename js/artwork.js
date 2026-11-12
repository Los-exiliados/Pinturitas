// Motor visual de Pinceladas de Vida.
//
// Carga una pintura del catálogo (js/obras.js) y la representa en un lienzo
// de p5.js en modo instancia con WEBGL: una malla texturizada de 60×40 que
// permite deformaciones localizadas por zona.
//
// Interacciones (se suman por etapas):
//   - Índice extendido: los remolinos giran sobre sí mismos como un molino
//     de viento, con arranque y freno suaves.
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
//   - actualizar(estado): recibe el estado por frame ({ molino: boolean }).
//   - destruir(): quita el lienzo y libera la instancia p5.

const Artwork = (function () {
    "use strict";

    const COLS = 60;
    const ROWS = 40;
    const MOLINO_VELOCIDAD = 2.4; // radianes por segundo en giro pleno
    const REVERTIR_MS = 7000; // sin manos: revertir los efectos tras este tiempo
    const VIDA_TRAZO = 3; // segundos que dura una pincelada
    const MAX_TRAZOS = 420; // tope de segmentos de pincelada
    const MAX_PARTICULAS = 400; // tope de partículas
    const MAX_METEOROS = 60; // tope de meteoros simultáneos de la paz

    // Colores neón de las partículas de carga y explosión.
    const PALETA_PARTICULAS = [
        [0, 255, 255], // cian
        [255, 0, 200], // magenta
        [120, 255, 120], // verde neón
        [255, 240, 80], // amarillo
        [90, 160, 255], // azul eléctrico
    ];

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

    const trazos = [];
    const particulas = [];
    const meteoros = [];
    let lluviaAcumulador = 0;
    let ultimaPaz = 0; // última vez que se vio la paz (para el margen de 5 s)
    let palmaPrevia = true; // para detectar la apertura de la mano (explosión)
    let puñoPrevio = false; // para detectar el cierre del puño (ráfaga de carga)
    let ultimaExplosion = 0; // instante de la última explosión (ms)
    let oscuridad = 0; // oscurecimiento del fondo mientras carga
    let cargaAcumulador = 0; // ritmo de aparición de partículas de carga
    let ultimasPalmas = [];
    let ultimaEntrada = null;
    let ultimoTiempoEfectos = 0;

    let molinoHasta = 0; // instante hasta el que el molino sigue vivo (ms)
    let ultimoConMano = 0; // última vez que se vio una mano (ms)
    let girando = false;
    let desenrollando = false;
    let fase = 0;
    let velocidad = 0;
    let ultimoTiempo = 0;

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

    // --- Capa de efectos: pinceladas de la palma ---------------------------

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

                    dibujarOscurecimiento(p);
                    dibujarTrazos(p);
                    dibujarMeteoros(p);
                    dibujarParticulas(p);
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

    // Color de la pintura en un punto, con contraste y saturación realzados:
    // cada canal se aleja del gris medio para que la pincelada resalte.
    function colorMuestra(nx, ny) {
        try {
            const px = Math.round(Math.min(1, Math.max(0, nx)) * (imagen.width - 1));
            const py = Math.round(Math.min(1, Math.max(0, ny)) * (imagen.height - 1));
            const c = imagen.get(px, py);
            return [
                canal(128 + (c[0] - 128) * 1.9 + 18),
                canal(128 + (c[1] - 128) * 1.9 + 16),
                canal(128 + (c[2] - 128) * 1.9 + 14),
            ];
        } catch (error) {
            return [170, 200, 255];
        }
    }

    function canal(valor) {
        return Math.max(0, Math.min(255, Math.round(valor)));
    }

    // Mezcla el color hacia el blanco: la cerda central y las partículas.
    function aclarar(color) {
        return [
            canal(color[0] + (255 - color[0]) * 0.65),
            canal(color[1] + (255 - color[1]) * 0.65),
            canal(color[2] + (255 - color[2]) * 0.65),
        ];
    }

    // Posición de aparición de las partículas de carga: directamente en el
    // centro de la imagen, con un jitter pequeño.
    function posicionCarga() {
        return {
            x: 0.5 + (Math.random() - 0.5) * 0.04,
            y: 0.5 + (Math.random() - 0.5) * 0.04,
        };
    }

    function actualizarEfectos(estado, dt, revertir) {
        const palmas = estado && Array.isArray(estado.palmas) ? estado.palmas : [];

        // Segmentos nuevos y partículas: la palma abierta pinta siguiendo
        // su trayectoria y suelta partículas alrededor del recorrido.
        for (let i = 0; i < palmas.length; i += 1) {
            const mano = palmas[i];
            const previo = ultimasPalmas[i];

            if (mano.posture === "open_palm" && previo) {
                const desplazamiento = Math.hypot(mano.x - previo.x, mano.y - previo.y);
                if (desplazamiento >= 0.012 && desplazamiento < 0.2) {
                    const color = colorMuestra(mano.x, mano.y);
                    trazos.push({
                        x1: previo.x,
                        y1: previo.y,
                        x2: mano.x,
                        y2: mano.y,
                        color,
                        core: aclarar(color),
                        grosor: 0.9 + Math.random() * 0.6,
                        vida: VIDA_TRAZO,
                    });
                    if (trazos.length > MAX_TRAZOS) trazos.shift();
                }

                // Partículas: cuantas más rápido se mueve la mano, más salen.
                if (desplazamiento > 0.004) {
                    const cantidad = Math.min(5, 1 + Math.floor(desplazamiento * 30));
                    for (let n = 0; n < cantidad; n += 1) {
                        particulas.push({
                            x: mano.x + (Math.random() - 0.5) * 0.02,
                            y: mano.y + (Math.random() - 0.5) * 0.02,
                            vx: (Math.random() - 0.5) * 0.09,
                            vy: (Math.random() - 0.5) * 0.09 - 0.015,
                            vida: 0.9 + Math.random() * 0.7,
                            tamaño: 0.9 + Math.random() * 1.0,
                            color: aclarar(colorMuestra(mano.x, mano.y)),
                        });
                    }
                }
            }

            ultimasPalmas[i] =
                mano.posture === "open_palm" ? { x: mano.x, y: mano.y } : null;
        }
        ultimasPalmas.length = palmas.length;

        // --- Lluvia de meteoritos: la paz los dispara por toda la obra -----
        const hayPaz = palmas.some((mano) => mano.posture === "peace");
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

        if (particulas.length > MAX_PARTICULAS) {
            particulas.splice(0, particulas.length - MAX_PARTICULAS);
        }

        // --- Carga: al cerrar el puño, una gran cantidad de partículas neón
        // se concentra en el centro y el fondo se oscurece casi a negro.
        const hayPuño = palmas.some((mano) => mano.posture === "fist");
        const hayPalma = palmas.some((mano) => mano.posture === "open_palm");
        const ahoraEfectos = performance.now();

        if (hayPuño) {
            // Ráfaga inicial al cerrar el puño.
            if (!puñoPrevio) {
                for (let n = 0; n < 30; n += 1) {
                    const posicion = posicionCarga();
                    particulas.push({
                        x: posicion.x,
                        y: posicion.y,
                        vx: (0.5 - posicion.x) * 0.4,
                        vy: (0.5 - posicion.y) * 0.4,
                        vida: 4 + Math.random() * 2,
                        tamaño: 1.0 + Math.random() * 1.2,
                        color: PALETA_PARTICULAS[Math.floor(Math.random() * PALETA_PARTICULAS.length)],
                        ambiente: false,
                    });
                }
            }
            // Flujo continuo mientras el puño está cerrado.
            if (!revertir) {
                cargaAcumulador += 24 * dt;
                while (cargaAcumulador >= 1) {
                    cargaAcumulador -= 1;
                    const posicion = posicionCarga();
                    particulas.push({
                        x: posicion.x,
                        y: posicion.y,
                        vx: (0.5 - posicion.x) * 0.4,
                        vy: (0.5 - posicion.y) * 0.4,
                        vida: 4 + Math.random() * 2,
                        tamaño: 1.0 + Math.random() * 1.2,
                        color: PALETA_PARTICULAS[Math.floor(Math.random() * PALETA_PARTICULAS.length)],
                        ambiente: false,
                    });
                }
            }

            // El fondo se oscurece mientras carga.
            oscuridad += (1 - oscuridad) * Math.min(1, dt * 2.5);
        } else {
            // Sin puño: el fondo se ilumina de nuevo, lento (~5 segundos).
            oscuridad = Math.max(0, oscuridad - dt * 0.2);
        }
        puñoPrevio = hayPuño;

        // --- Explosión: al ABRIR la mano, las partículas salen disparadas
        // hacia todas las direcciones y desaparecen; el fondo se ilumina.
        if (hayPalma && !palmaPrevia && ahoraEfectos - ultimaExplosion > 800) {
            ultimaExplosion = ahoraEfectos;
            for (const par of particulas) {
                const dx = par.x - 0.5;
                const dy = par.y - 0.5;
                const d = Math.hypot(dx, dy) || 1e-4;
                const fuerza = 0.35 + Math.random() * 0.45;
                par.vx += (dx / d) * fuerza + (Math.random() - 0.5) * 0.6;
                par.vy += (dy / d) * fuerza + (Math.random() - 0.5) * 0.6;
                // Vida corta: desaparecen mientras vuelan.
                par.vida = Math.min(par.vida, 0.8 + Math.random() * 0.7);
            }
            for (let n = 0; n < 30; n += 1) {
                const angulo = Math.random() * Math.PI * 2;
                const velocidad = 0.25 + Math.random() * 0.55;
                particulas.push({
                    x: 0.5 + (Math.random() - 0.5) * 0.02,
                    y: 0.5 + (Math.random() - 0.5) * 0.02,
                    vx: Math.cos(angulo) * velocidad,
                    vy: Math.sin(angulo) * velocidad,
                    vida: 0.7 + Math.random() * 0.7,
                    tamaño: 1.4 + Math.random() * 1.2,
                    color: PALETA_PARTICULAS[Math.floor(Math.random() * PALETA_PARTICULAS.length)],
                    ambiente: false,
                });
            }
        }
        palmaPrevia = hayPalma;

        // Envejecimiento; mientras carga no envejecen (la bola crece); se
        // acelera durante el revertido global.
        const desgaste = revertir ? dt * 3 : hayPuño ? 0 : dt;
        for (let i = trazos.length - 1; i >= 0; i -= 1) {
            trazos[i].vida -= desgaste;
            if (trazos[i].vida <= 0) trazos.splice(i, 1);
        }
        for (let i = particulas.length - 1; i >= 0; i -= 1) {
            const par = particulas[i];
            par.vida -= desgaste;

            // Abrir / cerrar la mano: el puño concentra las partículas en el
            // centro de la imagen; la palma abierta las esparce desde el
            // centro hacia todo el lugar.
            for (const mano of palmas) {
                if (mano.posture === "fist") {
                    const dx = 0.5 - par.x;
                    const dy = 0.5 - par.y;
                    const d2 = dx * dx + dy * dy + 0.001;
                    par.vx += (dx / d2) * 0.0022;
                    par.vy += (dy / d2) * 0.0022;
                } else if (mano.posture === "open_palm") {
                    const dx = par.x - 0.5;
                    const dy = par.y - 0.5;
                    const d = Math.hypot(dx, dy) || 1e-4;
                    const f = Math.max(0, 1 - d) * 0.25;
                    par.vx += (dx / d) * f + (Math.random() - 0.5) * 0.15;
                    par.vy += (dy / d) * f + (Math.random() - 0.5) * 0.15;
                }
            }

            par.x += par.vx * dt;
            par.y += par.vy * dt;

            // El límite de las partículas es el tamaño de la imagen:
            // rebotan suavemente en los bordes.
            if (par.x < 0) { par.x = -par.x; par.vx = Math.abs(par.vx) * 0.7; }
            if (par.x > 1) { par.x = 2 - par.x; par.vx = -Math.abs(par.vx) * 0.7; }
            if (par.y < 0) { par.y = -par.y; par.vy = Math.abs(par.vy) * 0.7; }
            if (par.y > 1) { par.y = 2 - par.y; par.vy = -Math.abs(par.vy) * 0.7; }

            par.vx *= 0.985;
            par.vy *= 0.985;

            if (par.vida <= 0) particulas.splice(i, 1);
        }
    }

    // Oscurecimiento del fondo mientras las partículas cargan: llega a casi
    // negro y se ilumina de nuevo solo al soltar el puño.
    function dibujarOscurecimiento(p) {
        if (oscuridad <= 0.001) return;
        const vista = vistaPintura(p);
        p.push();
        p.noStroke();
        // p5 usa alfa de 0 a 255: 0.88 * 255 ≈ 224 = casi negro.
        p.fill(0, 0, 0, Math.min(224, oscuridad * 224));
        p.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        p.pop();
    }

    function dibujarTrazos(p) {
        if (trazos.length === 0) return;
        const vista = vistaPintura(p);
        const grosorBase = Math.min(18, vista.anchoDibujo * 0.012);

        p.push();
        p.drawingContext.lineCap = "round";

        // Primera pasada: halo ancho y tenue (pincel cargado).
        for (const trazo of trazos) {
            const vida = Math.max(0, Math.min(1, trazo.vida / VIDA_TRAZO));
            const a = aVista(trazo.x1, trazo.y1, p, vista);
            const b = aVista(trazo.x2, trazo.y2, p, vista);
            p.stroke(`rgba(${trazo.color[0]}, ${trazo.color[1]}, ${trazo.color[2]}, ${(vida * 0.3).toFixed(3)})`);
            p.strokeWeight(trazo.grosor * grosorBase * 1.7);
            p.line(a.x, a.y, b.x, b.y);
        }

        // Segunda pasada: cuerpo del pincel.
        for (const trazo of trazos) {
            const vida = Math.max(0, Math.min(1, trazo.vida / VIDA_TRAZO));
            const a = aVista(trazo.x1, trazo.y1, p, vista);
            const b = aVista(trazo.x2, trazo.y2, p, vista);
            p.stroke(`rgba(${trazo.color[0]}, ${trazo.color[1]}, ${trazo.color[2]}, ${(vida * 0.55).toFixed(3)})`);
            p.strokeWeight(trazo.grosor * grosorBase);
            p.line(a.x, a.y, b.x, b.y);
        }

        // Tercera pasada: cerda central fina y clara.
        for (const trazo of trazos) {
            const vida = Math.max(0, Math.min(1, trazo.vida / VIDA_TRAZO));
            const a = aVista(trazo.x1, trazo.y1, p, vista);
            const b = aVista(trazo.x2, trazo.y2, p, vista);
            p.stroke(`rgba(${trazo.core[0]}, ${trazo.core[1]}, ${trazo.core[2]}, ${(vida * 0.4).toFixed(3)})`);
            p.strokeWeight(Math.max(1, trazo.grosor * grosorBase * 0.35));
            p.line(a.x, a.y, b.x, b.y);
        }

        p.pop();
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

    function dibujarParticulas(p) {
        if (particulas.length === 0) return;
        const vista = vistaPintura(p);
        const escala = vista.anchoDibujo / 1600;

        p.push();
        p.noStroke();
        p.drawingContext.shadowBlur = 14;
        p.drawingContext.shadowColor = "rgba(255, 235, 190, 0.95)";

        for (const par of particulas) {
            const c = aVista(par.x, par.y, p, vista);
            const alpha = Math.max(0, Math.min(1, par.vida / 1.2));
            p.fill(`rgba(${par.color[0]}, ${par.color[1]}, ${par.color[2]}, ${alpha.toFixed(3)})`);
            p.circle(c.x, c.y, Math.max(3, par.tamaño * 5.5 * escala));
        }

        p.drawingContext.shadowBlur = 0;
        p.pop();
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

        return { x, y };
    }

    function dibujarMalla(p) {
        const vista = vistaPintura(p);

        p.noStroke();
        p.textureMode(p.NORMAL);
        p.texture(imagen);

        for (let j = 0; j < ROWS; j++) {
            p.beginShape(p.TRIANGLE_STRIP);
            for (let i = 0; i <= COLS; i++) {
                emitirVertice(p, vista, i, j);
                emitirVertice(p, vista, i, j + 1);
            }
            p.endShape();
        }
    }

    function emitirVertice(p, vista, i, j) {
        const px = (i / COLS) * dimensiones.ancho;
        const py = (j / ROWS) * dimensiones.alto;
        const punto = deformar(px, py);

        const x = punto.x * vista.fit - vista.anchoDibujo / 2;
        const y = punto.y * vista.fit - vista.altoDibujo / 2;

        p.vertex(x, y, 0, i / COLS, j / ROWS);
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

        // Estado fresco del molino en cada obra.
        molinoHasta = 0;
        ultimoConMano = performance.now();
        girando = false;
        desenrollando = false;
        fase = 0;
        velocidad = 0;

        // Efectos de la palma: pizarra limpia.
        trazos.length = 0;
        particulas.length = 0;
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        palmaPrevia = true;
        puñoPrevio = false;
        ultimaExplosion = 0;
        oscuridad = 0;
        cargaAcumulador = 0;
        ultimasPalmas = [];
        ultimaEntrada = null;

        if (!sketchRef) return;

        const id = ++solicitudId;

        sketchRef.loadImage(
            obra.archivo,
            function (cargada) {
                if (id !== solicitudId) return; // una carga más nueva ya ganó
                imagen = cargada;
                dimensiones = { ancho: cargada.width, alto: cargada.height };
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
        molinoHasta = 0;
        ultimoConMano = 0;
        girando = false;
        desenrollando = false;
        fase = 0;
        velocidad = 0;
        trazos.length = 0;
        particulas.length = 0;
        meteoros.length = 0;
        lluviaAcumulador = 0;
        ultimaPaz = 0;
        palmaPrevia = true;
        puñoPrevio = false;
        ultimaExplosion = 0;
        oscuridad = 0;
        cargaAcumulador = 0;
        ultimasPalmas = [];
        ultimaEntrada = null;
        solicitudId += 1;
        ultimoTiempo = 0;
        ultimoTiempoEfectos = 0;
    }

    return { montar, cargar, actualizar, estadoMolino, dimensiones: obtenerDimensiones, destruir };
})();
