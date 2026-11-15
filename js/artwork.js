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

    // Derretir (La persistencia de la memoria): la pinza ablanda los relojes.
    let derretir = 0; // 0 = forma original, 1 = relojes escurridos
    let objetivoDerretir = 0;
    let faseDerretir = 0; // ondulación viscosa del derretimiento

    // Paz en La persistencia: un video de párpados se superpone a la obra
    // (quitándole el verde) y se cierra/abre con el gesto.
    let ojosProgreso = 0; // 0 = abiertos, 1 = cerrados
    let objetivoOjos = 0;
    let videoOjos = null;
    let ojosListo = false;

    // Manecillas de La persistencia: parejas sueltas que giran sobre los
    // relojes con el gesto de paz.
    let recortesManecillas = null;
    let recortesRelojes = null;
    let faseManecillas = 0;
    let relojesFundido = 0; // aparición/desaparición progresiva de los relojes

    // Sueño (La persistencia, palma): la escena se vuelve onírica.
    let sueno = 0; // 0 = natural, 1 = universo onírico
    let objetivoSueno = 0;
    let suenoLado = 0.5; // 0 = paleta fria (izquierda), 1 = violeta (derecha)
    let objetivoSuenoLado = 0.5;
    let faseSueno = 0; // giro de colores de la dimensión invertida
    let capaSueno = null;

    // Lluvia de estrellas del sueño.
    const estrellasSueno = [];
    let estrellasSuenoAcum = 0;

    // Pintura derretida cayendo desde el borde superior de la obra.
    const chorreos = [];
    let chorreosAcum = 0;

    // Índice (La persistencia): la obra se descompone en dimensiones.
    let disolucion = 0;
    let objetivoDisolucion = 0;
    let faseDisolucion = 0;
    let empujeDisolucion = 0;
    const estrellasDisolucion = [];

    // Cuadrados del multiverso: crecen a distintos ritmos, como animación.
    const cuadradosDisolucion = [];
    let cuadradosDisolucionAcum = 0;

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
    let capaNoche = null; // capa auxiliar del etalonaje nocturno

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

                    // Derretir: la pinza ablanda los relojes; al abrirla
                    // recuperan lentos su forma original.
                    derretir +=
                        (objetivoDerretir - derretir) *
                        Math.min(1, dt * (objetivoDerretir > derretir ? 3 : 1.6));
                    if (Math.abs(objetivoDerretir - derretir) < 0.002) {
                        derretir = objetivoDerretir;
                    }
                    faseDerretir += dt * 1.6;

                    // Con la paz activa las manecillas giran sin control; al
                    // disolverse el gesto el giro se frena solo.
                    faseManecillas += dt * ojosProgreso;

                    // Sueño: la palma enciende el universo onírico; al
                    // soltarla, la escena vuelve suave a lo natural.
                    if (obraActual && obraActual.palmEfecto === "sueno") {
                        sueno +=
                            (objetivoSueno - sueno) *
                            Math.min(1, dt * (objetivoSueno > sueno ? 1.6 : 0.7));
                        if (Math.abs(objetivoSueno - sueno) < 0.002) {
                            sueno = objetivoSueno;
                        }
                        suenoLado += (objetivoSuenoLado - suenoLado) * Math.min(1, dt * 1.6);
                        faseSueno += dt * (0.35 + 0.65 * sueno);
                    } else if (sueno !== 0 || objetivoSueno !== 0) {
                        sueno = 0;
                        objetivoSueno = 0;
                    }

                    // Índice: descomposición en dimensiones; se arma suave
                    // y se repliega al soltar el gesto.
                    if (obraActual && obraActual.indiceEfecto === "disolver") {
                        disolucion +=
                            (objetivoDisolucion - disolucion) *
                            Math.min(1, dt * (objetivoDisolucion > disolucion ? 1.1 : 0.9));
                        if (Math.abs(objetivoDisolucion - disolucion) < 0.002) {
                            disolucion = objetivoDisolucion;
                        }
                        faseDisolucion += dt * (0.35 + 0.65 * disolucion);
                        const empuje =
                            ultimaEntrada && typeof ultimaEntrada.indiceVelocidad === "number"
                                ? Math.min(1, Math.abs(ultimaEntrada.indiceVelocidad) * 30)
                                : 0;
                        empujeDisolucion +=
                            (empuje - empujeDisolucion) * Math.min(1, dt * 4);
                    } else if (disolucion !== 0 || objetivoDisolucion !== 0) {
                        disolucion = 0;
                        objetivoDisolucion = 0;
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
                    actualizarEstrellasSueno(dt);
                    actualizarChorreos(dt);
                    actualizarCuadrados(dt);

                    dibujarTormenta(p);
                    dibujarAtmosfera(p);
                    dibujarDespeje(p);
                    dibujarLocura(p);
                    dibujarChorreos(p);
                    dibujarDisolucion(p);
                    dibujarSueno(p);
                    dibujarRelojesSueno(p);
                    dibujarEstrellasSueno(p);
                    dibujarNoche(p);
                    dibujarRelojesLimpios(p);
                    dibujarManecillas(p);
                    dibujarVeladuraNoche(p);
                    dibujarNubesAura(p);

                    dibujarMeteoros(p);
                    actualizarOjos(p, dt);
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

    // Locura: mientras la pinza derrite los relojes, la escena se enciende
    // con colores psicodélicos que giran (el mundo de Dalí se desquicia).
    function dibujarLocura(p) {
        if (derretir <= 0.005) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;

        const x = vista.offsetX;
        const y = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;
        const intensidad = Math.min(1, derretir);
        const t = faseDerretir;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, ancho, alto);
        ctx.clip();

        // Ola psicodélica: el tono gira por toda la escena.
        const hue = (t * 55) % 360;
        const ola = ctx.createLinearGradient(x, y, x + ancho, y + alto);
        ola.addColorStop(0, `hsla(${hue}, 95%, 60%, ${(0.35 * intensidad).toFixed(3)})`);
        ola.addColorStop(
            0.5,
            `hsla(${(hue + 120) % 360}, 95%, 60%, ${(0.175 * intensidad).toFixed(3)})`
        );
        ola.addColorStop(
            1,
            `hsla(${(hue + 240) % 360}, 95%, 60%, ${(0.35 * intensidad).toFixed(3)})`
        );
        ctx.fillStyle = ola;
        ctx.fillRect(x, y, ancho, alto);

        // Auras de colores girando sobre cada reloj que se derrite.
        for (const zona of zonasActivas) {
            if (zona.efecto !== "derretir") continue;

            const c = aVista(zona.x, zona.y, p, vista);
            const r =
                zona.radio * Math.min(dimensiones.ancho, dimensiones.alto) * vista.fit * 1.4;
            const hz = (hue + zona.x * 360 + zona.y * 180) % 360;
            const aura = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
            aura.addColorStop(0, `hsla(${hz}, 100%, 65%, ${(0.55 * intensidad).toFixed(3)})`);
            aura.addColorStop(
                0.6,
                `hsla(${(hz + 70) % 360}, 100%, 55%, ${(0.275 * intensidad).toFixed(3)})`
            );
            aura.addColorStop(1, "hsla(0, 0%, 0%, 0)");
            ctx.fillStyle = aura;
            ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
        }

        ctx.restore();
    }

    // Recortes por pareja: se preparan una vez desde el sprite (copiando
    // regiones, sin leer píxeles) para dibujar cada par por separado, sin
    // recortes ni manecillas de otros relojes colándose.
    function crearRecortesManecillas(img) {
        const regiones = [
            { x: 880, y: 170, w: 620, h: 362, hubX: 1331, hubY: 470 },
            { x: 110, y: 180, w: 620, h: 360, hubX: 519, hubY: 475 },
            { x: 460, y: 710, w: 640, h: 362, hubX: 925, hubY: 937 },
        ];
        const recortes = [];
        for (const region of regiones) {
            const lienzo = document.createElement("canvas");
            lienzo.width = region.w;
            lienzo.height = region.h;
            const ctx = lienzo.getContext("2d");
            ctx.drawImage(
                img.canvas,
                region.x,
                region.y,
                region.w,
                region.h,
                0,
                0,
                region.w,
                region.h
            );
            recortes.push({
                lienzo,
                hubX: region.hubX - region.x,
                hubY: region.hubY - region.y,
            });
        }
        return recortes;
    }

    // Pintura derretida: chorrea desde el borde superior de la obra y baja
    // por la superficie mientras la pinza derrite los relojes.
    function actualizarChorreos(dt) {
        if (derretir > 0.02) {
            chorreosAcum += 6 * derretir * dt;
            while (chorreosAcum >= 1) {
                chorreosAcum -= 1;
                chorreos.push({
                    x: Math.random(),
                    ancho: 0.012 + Math.random() * 0.02,
                    largo: 0.02 + Math.random() * 0.04,
                    vy: 0.12 + Math.random() * 0.18,
                    tono: Math.floor(Math.random() * 4),
                });
            }
            if (chorreos.length > 40) {
                chorreos.splice(0, chorreos.length - 40);
            }
        }

        for (let i = chorreos.length - 1; i >= 0; i -= 1) {
            const chorreo = chorreos[i];
            chorreo.largo += chorreo.vy * dt;
            if (chorreo.largo > 1.05) chorreos.splice(i, 1);
        }
    }

    function dibujarChorreos(p) {
        if (chorreos.length === 0 || derretir <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const paleta = [
            "rgba(214, 158, 58, ", // dorado de los acantilados
            "rgba(38, 92, 176, ", // azul del cielo
            "rgba(224, 128, 118, ", // rosa de la carne
            "rgba(126, 146, 62, ", // oliva del paisaje
        ];

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        for (const chorreo of chorreos) {
            const x = vista.offsetX + chorreo.x * vista.anchoDibujo;
            const ancho = Math.max(1.5, chorreo.ancho * vista.anchoDibujo);
            const largo = Math.max(ancho, chorreo.largo * vista.altoDibujo);
            const alpha = Math.min(1, derretir * 0.55);
            const base = paleta[chorreo.tono];

            // Barra viscosa con punta redondeada.
            ctx.fillStyle = base + alpha.toFixed(3) + ")";
            ctx.beginPath();
            ctx.moveTo(x - ancho / 2, vista.offsetY);
            ctx.lineTo(x + ancho / 2, vista.offsetY);
            ctx.lineTo(x + ancho / 2, vista.offsetY + largo - ancho / 2);
            ctx.arc(x, vista.offsetY + largo - ancho / 2, ancho / 2, 0, Math.PI);
            ctx.closePath();
            ctx.fill();

            // Brillo húmedo sobre la pintura que escurre.
            ctx.fillStyle = base + (alpha * 0.35).toFixed(3) + ")";
            ctx.fillRect(
                x - ancho * 0.18,
                vista.offsetY,
                Math.max(1, ancho * 0.22),
                Math.max(2, largo * 0.7)
            );
        }

        ctx.restore();
    }

    // Sueño (La persistencia, palma): detrás de la escena natural aparece una
    // dimensión invertida: cielo abajo, el mar flotando sobre las montañas,
    // los relojes cayendo hacia arriba y colores que giran en el tiempo.
    function dibujarSueno(p) {
        if (!imagen || sueno <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const x = vista.offsetX;
        const y = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;
        const t = faseSueno;
        const giro = t * 45 + suenoLado * 120;

        capaSueno = prepararCapaAuxiliar(capaSueno, p);
        const capa = capaSueno.getContext("2d");
        capa.save();
        capa.beginPath();
        capa.rect(x, y, ancho, alto);
        capa.clip();

        // Mundo invertido: la pintura dada vuelta (el cielo queda abajo y el
        // suelo arriba) con colores distintos pero sin tapar la dimensión.
        capa.save();
        capa.translate(x, y + alto);
        capa.scale(1, -1);
        capa.filter = `hue-rotate(${giro % 360}deg) saturate(1.45) contrast(1.02)`;
        capa.drawImage(imagen.canvas, 0, 0, ancho, alto);
        capa.filter = "none";
        capa.restore();

        // El mar flota sobre las montañas: franja del horizonte espejada.
        // (Quitada: dejaba una banda de color en medio de la escena.)

        // Lavados suaves: el tono cambia con el tiempo sin esconder el mundo.
        const r = Math.round(127 + 127 * Math.sin(t * 0.9));
        const g = Math.round(127 + 127 * Math.sin(t * 0.9 + 2.1));
        const b = Math.round(127 + 127 * Math.sin(t * 0.9 + 4.2));
        capa.globalCompositeOperation = "saturation";
        capa.fillStyle = "rgba(128, 128, 128, 0.2)";
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "multiply";
        capa.fillStyle = `rgba(${r}, ${g}, ${b}, 0.22)`;
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "screen";
        capa.fillStyle = `rgba(${255 - r}, ${255 - g}, ${255 - b}, 0.1)`;
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "source-over";
        capa.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.min(1, sueno);
        ctx.drawImage(capaSueno, 0, 0);
        ctx.restore();
    }

    // Fuegos artificiales: estallidos de chispas dentro de la obra mientras
    // el índice descompone el universo.
    function actualizarCuadrados(dt) {
        if (disolucion > 0.05) {
            cuadradosDisolucionAcum += 6 * disolucion * dt;
            while (cuadradosDisolucionAcum >= 1) {
                cuadradosDisolucionAcum -= 1;
                cuadradosDisolucion.push({
                    x: 0.08 + Math.random() * 0.84,
                    y: 0.08 + Math.random() * 0.84,
                    lado: 0.01 + Math.random() * 0.02,
                    crece: 0.02 + Math.random() * 0.05,
                    max: 0.06 + Math.random() * 0.16,
                    fase: Math.random() * Math.PI * 2,
                    tono: Math.floor(Math.random() * 3),
                });
            }
            if (cuadradosDisolucion.length > 40) {
                cuadradosDisolucion.splice(0, cuadradosDisolucion.length - 40);
            }
        }

        for (let i = cuadradosDisolucion.length - 1; i >= 0; i -= 1) {
            const cuadrado = cuadradosDisolucion[i];
            cuadrado.lado += cuadrado.crece * dt;
            if (cuadrado.lado >= cuadrado.max) cuadradosDisolucion.splice(i, 1);
        }
    }

    // Índice (La persistencia): la obra se descompone en dimensiones
    // superpuestas: fragmentos flotantes, mar estrellado y múltiples
    // horizontes.
    function dibujarDisolucion(p) {
        if (!imagen || disolucion <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const x0 = vista.offsetX;
        const y0 = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;
        const d = disolucion;
        const t = faseDisolucion;
        const ladoMenor = Math.min(ancho, alto);

        if (estrellasDisolucion.length === 0) {
            for (let i = 0; i < 140; i += 1) {
                estrellasDisolucion.push({
                    x: Math.random(),
                    y: Math.random(),
                    r: 0.4 + Math.random() * 1.1,
                    fase: Math.random() * Math.PI * 2,
                });
            }
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, ancho, alto);
        ctx.clip();

        // 1) Vacío estrellado detrás de los fragmentos.
        ctx.fillStyle = "rgba(5, 7, 22, 0.92)";
        ctx.fillRect(x0, y0, ancho, alto);
        for (const estrella of estrellasDisolucion) {
            const ex = x0 + estrella.x * ancho;
            const ey = y0 + estrella.y * alto;
            const brillo = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + estrella.fase));
            ctx.fillStyle = `rgba(220, 230, 255, ${(brillo * d).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(ex, ey, Math.max(0.6, estrella.r * vista.fit * 1.6), 0, Math.PI * 2);
            ctx.fill();
        }

        // 2) El paisaje se divide en fragmentos flotantes.
        const cols = 8;
        const filas = 5;
        const anchoImagen = dimensiones.ancho;
        const altoImagen = dimensiones.alto;

        for (let fy = 0; fy < filas; fy += 1) {
            for (let fx = 0; fx < cols; fx += 1) {
                const sx = (fx * anchoImagen) / cols;
                const sy = (fy * altoImagen) / filas;
                const sw = anchoImagen / cols;
                const sh = altoImagen / filas;

                const cxF = (fx + 0.5) / cols;
                const cyF = (fy + 0.5) / filas;
                const dirX = cxF - 0.5;
                const dirY = cyF - 0.5;
                const onda = Math.sin(t * 1.6 + fx * 0.9 + fy * 1.3);
                const deriva = (0.1 + 0.1 * onda) * d + empujeDisolucion * 0.015;

                const destinoX = x0 + cxF * ancho + dirX * deriva * ancho * 1.8;
                const destinoY = y0 + cyF * alto + dirY * deriva * alto * 1.8;
                const rotacion = (dirX + dirY) * d * 0.12 + onda * d * 0.05;
                const anchoF = (ancho / cols) * (1 - 0.1 * d);
                const altoF = (alto / filas) * (1 - 0.1 * d);

                ctx.save();
                ctx.translate(destinoX, destinoY);
                ctx.rotate(rotacion);
                ctx.drawImage(
                    imagen.canvas,
                    sx,
                    sy,
                    sw,
                    sh,
                    -anchoF / 2,
                    -altoF / 2,
                    anchoF,
                    altoF
                );
                ctx.restore();
            }
        }

        // 3) El mar se transforma en un cielo estrellado.
        const bandaY = y0 + alto * 0.36;
        const bandaH = alto * 0.26;
        const banda = ctx.createLinearGradient(x0, bandaY, x0, bandaY + bandaH);
        banda.addColorStop(0, `rgba(24, 36, 96, ${(0.55 * d).toFixed(3)})`);
        banda.addColorStop(0.5, `rgba(6, 10, 36, ${(0.75 * d).toFixed(3)})`);
        banda.addColorStop(1, "rgba(6, 10, 36, 0)");
        ctx.fillStyle = banda;
        ctx.fillRect(x0, bandaY, ancho, bandaH);
        for (const estrella of estrellasDisolucion) {
            if (estrella.y < 0.36 || estrella.y > 0.64) continue;
            const ex = x0 + estrella.x * ancho;
            const ey = y0 + estrella.y * alto;
            const brillo = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.6 + estrella.fase));
            ctx.fillStyle = `rgba(235, 242, 255, ${(brillo * d).toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(ex, ey, Math.max(0.8, estrella.r * vista.fit * 2), 0, Math.PI * 2);
            ctx.fill();
        }

        // 4) Cromática: la izquierda es noche y la derecha es día.
        {
            const crisol = ctx.createLinearGradient(x0, 0, x0 + ancho, 0);
            crisol.addColorStop(0, `rgba(10, 18, 66, ${(0.6 * d).toFixed(3)})`);
            crisol.addColorStop(0.34, `rgba(12, 22, 80, ${(0.28 * d).toFixed(3)})`);
            crisol.addColorStop(0.5, `rgba(20, 30, 70, 0)`);
            crisol.addColorStop(0.66, `rgba(255, 196, 96, ${(0.28 * d).toFixed(3)})`);
            crisol.addColorStop(1, `rgba(255, 176, 70, ${(0.6 * d).toFixed(3)})`);
            ctx.fillStyle = crisol;
            ctx.fillRect(x0, y0, ancho, alto);

            // Destello de día entrando por el borde derecho.
            const sol = ctx.createRadialGradient(
                x0 + ancho,
                y0 + alto * 0.42,
                0,
                x0 + ancho,
                y0 + alto * 0.42,
                ancho * 0.5
            );
            sol.addColorStop(0, `rgba(255, 224, 150, ${(0.5 * d).toFixed(3)})`);
            sol.addColorStop(1, "rgba(255, 224, 150, 0)");
            ctx.fillStyle = sol;
            ctx.fillRect(x0, y0, ancho, alto);
        }

        // 5) Cuadrados que crecen aleatoriamente, como una animación.
        const tonosCuadrado = [
            [255, 205, 110],
            [120, 170, 255],
            [200, 140, 255],
        ];
        for (const cuadrado of cuadradosDisolucion) {
            const lado = cuadrado.lado * ladoMenor;
            const px = x0 + cuadrado.x * ancho;
            const py = y0 + cuadrado.y * alto;
            const avance = Math.min(1, cuadrado.lado / cuadrado.max);
            const aparicion = Math.sin(Math.PI * Math.min(1, avance + 0.08));
            const color = tonosCuadrado[cuadrado.tono] || tonosCuadrado[0];
            const alpha = aparicion * d * 0.55;

            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(
                alpha * 0.35
            ).toFixed(3)})`;
            ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
            ctx.lineWidth = Math.max(1, ladoMenor * 0.0016);
            ctx.fillRect(px - lado / 2, py - lado / 2, lado, lado);
            ctx.strokeRect(px - lado / 2, py - lado / 2, lado, lado);
        }

        // 6) Múltiples horizontes dentro de la misma pintura.
        for (let i = 0; i < 3; i += 1) {
            const hy = y0 + alto * (0.28 + i * 0.18);
            const grad = ctx.createLinearGradient(x0, 0, x0 + ancho, 0);
            grad.addColorStop(0, "rgba(255, 210, 140, 0)");
            grad.addColorStop(0.5, `rgba(255, 224, 175, ${(0.5 * d).toFixed(3)})`);
            grad.addColorStop(1, "rgba(255, 210, 140, 0)");
            ctx.fillStyle = grad;
            ctx.fillRect(x0, hy, ancho, 2);
        }

        ctx.restore();
    }

    // Lluvia de estrellas del sueño: caen en vertical dentro de la obra.
    function actualizarEstrellasSueno(dt) {
        if (sueno > 0.02) {
            estrellasSuenoAcum += 45 * sueno * dt;
            while (estrellasSuenoAcum >= 1) {
                estrellasSuenoAcum -= 1;
                estrellasSueno.push({
                    x: Math.random(),
                    y: -0.02 - Math.random() * 0.06,
                    vy: 0.12 + Math.random() * 0.22,
                    tam: 0.004 + Math.random() * 0.006,
                    fase: Math.random() * Math.PI * 2,
                });
            }
            if (estrellasSueno.length > 140) {
                estrellasSueno.splice(0, estrellasSueno.length - 140);
            }
        }

        for (let i = estrellasSueno.length - 1; i >= 0; i -= 1) {
            const estrella = estrellasSueno[i];
            estrella.y += estrella.vy * dt;
            if (estrella.y > 1.03) estrellasSueno.splice(i, 1);
        }
    }

    function dibujarEstrellasSueno(p) {
        if (estrellasSueno.length === 0 || sueno <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ladoMenor = Math.min(dimensiones.ancho, dimensiones.alto);
        const t = faseSueno;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        for (const estrella of estrellasSueno) {
            const c = aVista(estrella.x, estrella.y, p, vista);
            const tam = Math.max(1.5, estrella.tam * ladoMenor * vista.fit);
            // Titilan para mantener la estética suave del sueño.
            const brillo = 0.45 + 0.55 * Math.max(0, Math.sin(t * 3 + estrella.fase));
            const alpha = Math.min(1, sueno * brillo);
            const color = `rgba(255, 248, 220, ${alpha.toFixed(3)})`;

            // Destello de cuatro puntas.
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, tam * 0.18);
            ctx.beginPath();
            ctx.moveTo(c.x, c.y - tam);
            ctx.lineTo(c.x, c.y + tam);
            ctx.moveTo(c.x - tam, c.y);
            ctx.lineTo(c.x + tam, c.y);
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(c.x, c.y, Math.max(1, tam * 0.28), 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // Relojes cayendo hacia arriba en la dimensión del sueño.
    function dibujarRelojesSueno(p) {
        if (!recortesRelojes || sueno <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const t = faseSueno;

        const flotantes = [
            { recorte: 0, nx: 0.16, escala: 0.28, fase: 0, giro: 2.2, colorFase: 0 },
            { recorte: 1, nx: 0.36, escala: 0.4, fase: 0.22, giro: -3.0, colorFase: 60 },
            { recorte: 2, nx: 0.58, escala: 0.2, fase: 0.5, giro: 4.0, colorFase: -50 },
            { recorte: 0, nx: 0.78, escala: 0.34, fase: 0.12, giro: -2.4, colorFase: 120 },
            { recorte: 1, nx: 0.5, escala: 0.16, fase: 0.68, giro: 3.4, colorFase: -100 },
            { recorte: 2, nx: 0.28, escala: 0.24, fase: 0.38, giro: -4.2, colorFase: 180 },
            { recorte: 0, nx: 0.68, escala: 0.14, fase: 0.82, giro: 5.0, colorFase: 40 },
            { recorte: 1, nx: 0.9, escala: 0.18, fase: 0.6, giro: -3.6, colorFase: -70 },
            { recorte: 2, nx: 0.44, escala: 0.3, fase: 0.9, giro: 2.8, colorFase: 150 },
            // Uno de frente, sin girar, como el reloj que observa.
            { recorte: 1, nx: 0.52, escala: 0.26, fase: 0.05, giro: 0, colorFase: -30 },
        ];

        // Los relojes toman el tono complementario del fondo: contrastan.
        const giroFondo = t * 45 + suenoLado * 120;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();
        ctx.globalAlpha = Math.min(1, sueno * 0.72);

        for (const reloj of flotantes) {
            const recorte = recortesRelojes[reloj.recorte];
            if (!recorte) continue;

            // Sube de abajo hacia arriba y vuelve a empezar.
            const progreso = (t * 0.09 + reloj.fase) % 1;
            const ny = 1.2 - progreso * 1.4;
            const cx = vista.offsetX + reloj.nx * vista.anchoDibujo;
            const cy = vista.offsetY + ny * vista.altoDibujo;

            ctx.save();
            ctx.translate(cx, cy);
            // Gira sobre su propio eje, cada uno a su ritmo.
            ctx.rotate(t * reloj.giro + reloj.fase * 6);
            ctx.scale(vista.fit * reloj.escala, vista.fit * reloj.escala);
            ctx.filter = `hue-rotate(${(giroFondo + 180 + reloj.colorFase) % 360}deg) saturate(1.4)`;
            ctx.drawImage(recorte.lienzo, -recorte.lienzo.width / 2, -recorte.lienzo.height / 2);
            ctx.filter = "none";
            ctx.restore();
        }

        ctx.restore();
    }

    // Noche (La persistencia): la misma paleta fría que el anochecer del
    // caminante, sin luna: la escena se apaga en azules profundos.
    function dibujarNoche(p) {
        if (!imagen || relojesFundido <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const x = vista.offsetX;
        const y = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;

        capaNoche = prepararCapaAuxiliar(capaNoche, p);
        const capa = capaNoche.getContext("2d");
        capa.save();
        capa.beginPath();
        capa.rect(x, y, ancho, alto);
        capa.clip();
        capa.drawImage(imagen.canvas, x, y, ancho, alto);

        // El color propio de la escena se apaga y manda el azul nocturno.
        capa.globalCompositeOperation = "saturation";
        capa.fillStyle = "rgba(128, 128, 128, 0.45)";
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "multiply";
        capa.fillStyle = "rgba(38, 60, 138, 0.48)";
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "screen";
        capa.fillStyle = "rgba(30, 70, 160, 0.1)";
        capa.fillRect(x, y, ancho, alto);
        capa.globalCompositeOperation = "source-over";
        capa.restore();

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.min(1, relojesFundido * 0.92);
        ctx.drawImage(capaNoche, 0, 0);
        ctx.restore();
    }

    // Veladura final: unifica los relojes y las manecillas con la noche.
    function dibujarVeladuraNoche(p) {
        if (relojesFundido <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();
        ctx.fillStyle = `rgba(12, 22, 60, ${(0.22 * relojesFundido).toFixed(3)})`;
        ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.restore();
    }

    // Recortes de los relojes limpios (con alfa) que reemplazan visualmente
    // a los pintados durante el gesto de paz.
    function crearRecortesRelojes(img) {
        const regiones = [
            { x: 640, y: 0, w: 420, h: 620 },
            { x: 40, y: 520, w: 660, h: 646 },
            { x: 950, y: 620, w: 630, h: 520 },
        ];
        const recortes = [];
        for (const region of regiones) {
            const lienzo = document.createElement("canvas");
            lienzo.width = region.w;
            lienzo.height = region.h;
            lienzo
                .getContext("2d")
                .drawImage(
                    img.canvas,
                    region.x,
                    region.y,
                    region.w,
                    region.h,
                    0,
                    0,
                    region.w,
                    region.h
                );
            recortes.push({ lienzo });
        }
        return recortes;
    }

    // Relojes limpios sobre los pintados: mientras la paz está activa, la
    // escena "descompone" los relojes y aparecen nítidos con sus manecillas.
    function dibujarRelojesLimpios(p) {
        if (!recortesRelojes || relojesFundido <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;

        const config = [
            { recorte: 0, nx: 0.353, ny: 0.298, escala: 0.7 },
            { recorte: 1, nx: 0.207, ny: 0.69, escala: 0.74 },
            { recorte: 2, nx: 0.534, ny: 0.609, escala: 0.34 },
        ];

        ctx.save();
        ctx.globalAlpha = Math.min(1, relojesFundido);

        for (const reloj of config) {
            const recorte = recortesRelojes[reloj.recorte];
            if (!recorte) continue;

            const cx = vista.offsetX + reloj.nx * vista.anchoDibujo;
            const cy = vista.offsetY + reloj.ny * vista.altoDibujo;
            const escala = vista.fit * reloj.escala;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(escala, escala);
            ctx.drawImage(recorte.lienzo, -recorte.lienzo.width / 2, -recorte.lienzo.height / 2);
            ctx.restore();
        }

        ctx.restore();
    }

    // Manecillas: cada reloj recibe una pareja que gira sobre su propio eje,
    // como si alguien cambiara la hora a lo loco, mientras la paz está activa.
    function dibujarManecillas(p) {
        if (!recortesManecillas || relojesFundido <= 0.01) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;

        // Pivote real de cada reloj (normalizado), pareja del sprite, escala,
        // orientación del plano (base), aplastamiento de la esfera (sx/sy)
        // y velocidad de giro en rad/s.
        const config = [
            {
                recorte: 1,
                nx: 0.375,
                ny: 0.257,
                escala: 0.23,
                velocidad: 9,
                base: 0.1,
                sx: 0.4,
                sy: 1.0,
            },
            {
                recorte: 0,
                nx: 0.269,
                ny: 0.6,
                escala: 0.33,
                velocidad: -13,
                base: -0.1,
                sx: 1.0,
                sy: 0.55,
            },
            {
                recorte: 2,
                nx: 0.531,
                ny: 0.6,
                escala: 0.12,
                velocidad: 16,
                base: 0.15,
                sx: 1.0,
                sy: 0.75,
            },

            // Manecillas sueltas flotando por toda la obra.
            {
                recorte: 0,
                nx: 0.12,
                ny: 0.16,
                escala: 0.18,
                velocidad: 7,
                base: 0.8,
                sx: 0.9,
                sy: 0.9,
            },
            {
                recorte: 1,
                nx: 0.68,
                ny: 0.18,
                escala: 0.15,
                velocidad: -9,
                base: 2.1,
                sx: 0.85,
                sy: 0.85,
            },
            {
                recorte: 2,
                nx: 0.86,
                ny: 0.34,
                escala: 0.14,
                velocidad: 11,
                base: 3.4,
                sx: 0.9,
                sy: 0.9,
            },
            {
                recorte: 0,
                nx: 0.62,
                ny: 0.3,
                escala: 0.13,
                velocidad: -6,
                base: 1.2,
                sx: 0.8,
                sy: 0.8,
            },
            {
                recorte: 1,
                nx: 0.18,
                ny: 0.45,
                escala: 0.14,
                velocidad: 8,
                base: 4.1,
                sx: 0.9,
                sy: 0.9,
            },
            {
                recorte: 2,
                nx: 0.42,
                ny: 0.85,
                escala: 0.15,
                velocidad: -10,
                base: 0.4,
                sx: 0.85,
                sy: 0.85,
            },
            {
                recorte: 0,
                nx: 0.78,
                ny: 0.78,
                escala: 0.17,
                velocidad: 12,
                base: 2.8,
                sx: 0.9,
                sy: 0.9,
            },
            {
                recorte: 1,
                nx: 0.36,
                ny: 0.12,
                escala: 0.12,
                velocidad: -7,
                base: 5.2,
                sx: 0.85,
                sy: 0.85,
            },
        ];

        for (const reloj of config) {
            const recorte = recortesManecillas[reloj.recorte];
            if (!recorte) continue;

            const cx = vista.offsetX + reloj.nx * vista.anchoDibujo;
            const cy = vista.offsetY + reloj.ny * vista.altoDibujo;
            const angulo = reloj.base + faseManecillas * reloj.velocidad * ojosProgreso;

            ctx.save();
            ctx.globalAlpha = Math.min(1, relojesFundido);
            ctx.translate(cx, cy);
            ctx.rotate(angulo);
            ctx.scale(vista.fit * reloj.escala * reloj.sx, vista.fit * reloj.escala * reloj.sy);
            ctx.drawImage(recorte.lienzo, -recorte.hubX, -recorte.hubY);
            ctx.restore();
        }
    }

    // Ojos de La persistencia: el video de párpados se superpone a la obra
    // con un filtro SVG que convierte el verde en transparencia (sin leer
    // píxeles, así funciona también abriendo el archivo localmente).
    function crearFiltroOjos() {
        if (document.getElementById("filtro-ojos")) return;
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("id", "filtro-ojos");
        svg.setAttribute("width", "0");
        svg.setAttribute("height", "0");
        svg.style.position = "absolute";

        const defs = document.createElementNS(ns, "defs");
        const filtro = document.createElementNS(ns, "filter");
        filtro.setAttribute("id", "quita-verde-ojos");
        // La región se limita al propio video: sin esto el filtro pinta un
        // marco negro alrededor.
        filtro.setAttribute("x", "0");
        filtro.setAttribute("y", "0");
        filtro.setAttribute("width", "100%");
        filtro.setAttribute("height", "100%");
        filtro.setAttribute("color-interpolation-filters", "sRGB");

        // Alfa = 1.3R - 2.4G + 1.3B + 1: cualquier verde (aunque no sea puro)
        // se vuelve transparente; los párpados oscuros conservan su opacidad.
        const matriz = document.createElementNS(ns, "feColorMatrix");
        matriz.setAttribute("type", "matrix");
        matriz.setAttribute("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  1.3 -2.4 1.3 0 1");

        // Umbral final: los restos semitransparentes de verde desaparecen.
        const transfer = document.createElementNS(ns, "feComponentTransfer");
        const alfa = document.createElementNS(ns, "feFuncA");
        alfa.setAttribute("type", "table");
        alfa.setAttribute("tableValues", "0 0 0.2 1");

        // Los párpados quedan casi negros, sin verdor residual.
        const oscurecer = document.createElementNS(ns, "feColorMatrix");
        oscurecer.setAttribute("type", "matrix");
        oscurecer.setAttribute(
            "values",
            "0.25 0 0 0 0  0 0.25 0 0 0  0 0 0.25 0 0  0 0 0 1 0"
        );

        transfer.appendChild(alfa);
        filtro.appendChild(matriz);
        filtro.appendChild(transfer);
        filtro.appendChild(oscurecer);
        defs.appendChild(filtro);
        svg.appendChild(defs);
        document.body.appendChild(svg);
    }

    function prepararVideoOjos(src) {
        if (videoOjos && videoOjos.dataset.src === src) return;
        detenerVideoOjos();
        if (!contenedor) return;

        crearFiltroOjos();

        const video = document.createElement("video");
        video.src = src;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.dataset.src = src;
        video.style.position = "absolute";
        video.style.pointerEvents = "none";
        video.style.zIndex = "3";
        video.style.opacity = "0";
        video.style.objectFit = "cover";
        video.style.filter = "url(#quita-verde-ojos)";
        contenedor.appendChild(video);

        video.addEventListener("loadeddata", function () {
            ojosListo = true;
            // Se calienta el decodificador para poder buscar frames sin
            // depender de un gesto del usuario.
            const promesa = video.play();
            if (promesa && promesa.then) {
                promesa.then(function () {
                    video.pause();
                }).catch(function () {});
            }
        });
        video.addEventListener("error", function () {
            console.error("No se pudo cargar el video de ojos:", src);
        });

        videoOjos = video;
        ojosProgreso = 0;
    }

    function detenerVideoOjos() {
        if (videoOjos) {
            try {
                videoOjos.pause();
            } catch (error) {
                // sin problema: el video ya estaba detenido
            }
            if (videoOjos.parentNode) videoOjos.parentNode.removeChild(videoOjos);
            videoOjos = null;
        }
        ojosListo = false;
        ojosProgreso = 0;
    }

    function actualizarOjos(p, dt) {
        if (!obraActual || obraActual.pazEfecto !== "ojos") {
            if (ojosProgreso !== 0) ojosProgreso = 0;
            if (videoOjos) videoOjos.style.display = "none";
            return;
        }

        // Los relojes limpios aparecen y desaparecen progresivos; la vuelta
        // completa ronda los 6 segundos.
        relojesFundido += (objetivoOjos - relojesFundido) * Math.min(1, dt * 0.8);
        if (Math.abs(objetivoOjos - relojesFundido) < 0.002) {
            relojesFundido = objetivoOjos;
        }

        if (!videoOjos) return;

        // Cierra con el gesto y se abre en unos 6 segundos al soltarlo.
        const suavidad = objetivoOjos > ojosProgreso ? 1.8 : 0.6;
        ojosProgreso += (objetivoOjos - ojosProgreso) * Math.min(1, dt * suavidad);
        if (Math.abs(objetivoOjos - ojosProgreso) < 0.002) {
            ojosProgreso = objetivoOjos;
        }

        if (!ojosListo) return;

        if (videoOjos.duration) {
            const t = ojosProgreso * Math.max(0, videoOjos.duration - 0.04);
            if (Math.abs(videoOjos.currentTime - t) > 0.02) {
                try {
                    videoOjos.currentTime = t;
                } catch (error) {
                    // el navegador todavía no permite buscar: se reintenta
                }
            }
        }

        if (ojosProgreso <= 0.01) {
            videoOjos.style.display = "none";
            return;
        }

        // El video se ajusta exactamente al rectángulo de la pintura.
        const vista = vistaPintura(p);
        videoOjos.style.left = vista.offsetX + "px";
        videoOjos.style.top = vista.offsetY + "px";
        videoOjos.style.width = vista.anchoDibujo + "px";
        videoOjos.style.height = vista.altoDibujo + "px";

        videoOjos.style.display = "block";
        videoOjos.style.opacity = String(Math.min(1, ojosProgreso * 3));
    }

    // Nubes amarillas que rodean al personaje mientras se hace zoom.

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

        // Derretir (La persistencia de la memoria): la pinza ablanda los
        // relojes. Cada zona estira su contenido hacia abajo con una caída
        // viscosa: el reloj se descuelga como si se escurriera.
        if (derretir > 0.001) {
            for (const zona of zonasActivas) {
                if (zona.efecto !== "derretir") continue;

                const cx = zona.x * dimensiones.ancho;
                const cy = zona.y * dimensiones.alto;
                const radio = zona.radio * Math.min(dimensiones.ancho, dimensiones.alto);
                const dx = x - cx;
                const dy = y - cy;
                const caida = Math.exp(-(dx * dx + dy * dy) / (radio * radio));
                const fuerza = typeof zona.fuerza === "number" ? zona.fuerza : 1;
                const peso = caida * fuerza * derretir;

                if (peso <= 0.001) continue;

                // La mitad inferior cae más: el reloj se descolga hacia
                // abajo mientras el resto se estira. La caída llega más
                // abajo que el propio reloj, como un goteo que se alarga.
                const bajo = Math.max(0, Math.min(1, (dy / radio) * 0.5 + 0.5));
                y = cy + dy * (1 + peso * 0.32) + peso * radio * (0.45 + 1.5 * bajo);

                // Tambaleo: el reloj derretido se mece y gotea hacia los
                // costados, con una segunda onda que le da vida propia.
                const tambaleo =
                    Math.sin((dy / radio) * 2.6 + faseDerretir) +
                    0.5 * Math.sin((dy / radio) * 5.1 - faseDerretir * 1.7);
                x += tambaleo * peso * radio * 0.16;
                y += Math.sin(faseDerretir * 1.3) * peso * radio * 0.09;
            }
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
        // negro (80%) para que el aura resalte; al derretir los relojes el
        // fondo baja apenas un 15%, como si la escena se ensombreciera.
        const oscurecer =
            iluminacion * OSCURECER_MAX + profundidad * 0.8 + derretir * 0.15;
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
        derretir = 0;
        objetivoDerretir = 0;
        faseDerretir = 0;
        ojosProgreso = 0;
        objetivoOjos = 0;
        recortesManecillas = null;
        recortesRelojes = null;
        faseManecillas = 0;
        relojesFundido = 0;
        sueno = 0;
        objetivoSueno = 0;
        suenoLado = 0.5;
        objetivoSuenoLado = 0.5;
        faseSueno = 0;
        estrellasSueno.length = 0;
        estrellasSuenoAcum = 0;
        chorreos.length = 0;
        chorreosAcum = 0;
        disolucion = 0;
        objetivoDisolucion = 0;
        faseDisolucion = 0;
        empujeDisolucion = 0;
        cuadradosDisolucion.length = 0;
        cuadradosDisolucionAcum = 0;

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

        // Video de ojos del gesto de paz (La persistencia de la memoria).
        if (obra.pazEfecto === "ojos" && obra.ojos) {
            prepararVideoOjos(obra.ojos);
        } else {
            detenerVideoOjos();
        }

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

                // Manecillas sueltas para girar sobre los relojes.
                if (obra.manecillas) {
                    sketchRef.loadImage(
                        obra.manecillas,
                        function (imgManecillas) {
                            if (id !== solicitudId) return;
                            recortesManecillas = crearRecortesManecillas(imgManecillas);
                        },
                        function () {
                            console.error("No se pudieron cargar las manecillas:", obra.manecillas);
                        }
                    );
                }

                // Relojes limpios que reemplazan a los pintados con la paz.
                if (obra.relojes) {
                    sketchRef.loadImage(
                        obra.relojes,
                        function (imgRelojes) {
                            if (id !== solicitudId) return;
                            recortesRelojes = crearRecortesRelojes(imgRelojes);
                        },
                        function () {
                            console.error("No se pudieron cargar los relojes:", obra.relojes);
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
            } else if (
                obraActual &&
                ((Array.isArray(obraActual.cuerpos) && obraActual.cuerpos.length > 0) ||
                    (Array.isArray(obraActual.luces) && obraActual.luces.length > 0))
            ) {
                // La pinza manda sobre los cuerpos celestes: cerrada enciende
                // el resplandor, abierta lo apaga. Las obras sin cuerpos no
                // oscurecen la escena al hacer pinza.
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

        // Derretir: la pinza ablanda los relojes y, al abrirla, recuperan su
        // forma original. Sin pinza cerrada el objetivo es volver.
        if (obraActual && obraActual.pinzaEfecto === "derretir") {
            const d = estado.pinzaDistancia;
            objetivoDerretir =
                estado.pinzaCerrada && typeof d === "number"
                    ? Math.max(0, Math.min(1, 1 - (d - 0.06) / 0.26))
                    : 0;
        }

        // Paz: el gesto cierra los ojos (video de párpados) y al soltarlo
        // la mirada se abre poco a poco.
        objetivoOjos = obraActual && obraActual.pazEfecto === "ojos" && estado.paz ? 1 : 0;

        // Sueño (palma): la escena se vuelve onírica mientras la palma esté
        // presente; la posición horizontal elige la paleta.
        if (obraActual && obraActual.palmEfecto === "sueno") {
            objetivoSueno = estado.palmaManos > 0 ? 1 : 0;
            if (estado.palmaManos > 0 && typeof estado.palmaX === "number") {
                objetivoSuenoLado = Math.max(0, Math.min(1, estado.palmaX));
            }
        }

        // Índice: la obra se descompone en dimensiones mientras el gesto
        // está presente; el movimiento de la mano agita los fragmentos.
        objetivoDisolucion =
            obraActual && obraActual.indiceEfecto === "disolver" && estado.molino ? 1 : 0;

        if (
            estado.molino &&
            obraActual &&
            Array.isArray(obraActual.zonas) &&
            obraActual.zonas.some((zona) => zona.efecto === "remolino")
        ) {
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
        detenerVideoOjos();
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
        derretir = 0;
        objetivoDerretir = 0;
        faseDerretir = 0;
        ojosProgreso = 0;
        objetivoOjos = 0;
        recortesManecillas = null;
        recortesRelojes = null;
        faseManecillas = 0;
        relojesFundido = 0;
        sueno = 0;
        objetivoSueno = 0;
        suenoLado = 0.5;
        objetivoSuenoLado = 0.5;
        faseSueno = 0;
        estrellasSueno.length = 0;
        estrellasSuenoAcum = 0;
        chorreos.length = 0;
        chorreosAcum = 0;
        disolucion = 0;
        objetivoDisolucion = 0;
        faseDisolucion = 0;
        empujeDisolucion = 0;
        cuadradosDisolucion.length = 0;
        cuadradosDisolucionAcum = 0;
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
