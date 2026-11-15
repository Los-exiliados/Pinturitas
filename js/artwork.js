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

    // Índice en Composición VIII: los círculos de la obra crecen y cambian
    // de color mientras el gesto está activo.
    let kandinskyProgreso = 0;
    let objetivoKandinsky = 0;
    let kandinskyFase = 0;
    let kandinskyExtrasAcum = 0;
    const circulosKandinsky = [];

    // Palma en Composición VIII: al aparecer la palma la obra explota en
    // triángulos y círculos que salen volando, con fuegos artificiales y
    // colores que rotan (de noche).
    let explosion = 0;
    let objetivoExplosion = 0;
    let destelloExplosion = 0;
    let faseExplosion = 0;
    let piezasExplosion = null;
    const fuegosExplosion = [];
    let fuegosExplosionAcum = 0;

    // Paz en Composición VIII: cada movimiento amplio dispara una onda
    // cromática que atraviesa la pantalla y mezcla los colores.
    let cromaFase = 0;
    let cromaCooldown = 0;
    let cromaOscuridad = 0;
    const ondasCromaticas = [];
    const particulasCroma = [];
    const circulosCroma = [];
    let circulosCromaAcum = 0;

    // Pinza en Composición VIII: la obra llueve desde los cuatro bordes
    // (arriba cuadrados, abajo triángulos, izquierda rectángulos, derecha
    // círculos) y todo colisiona en el centro.
    const piezasPinza = [];
    let piezasPinzaAcum = 0;
    let pinzaEstabaCerrada = false;
    const destellosPinza = [];
    let pinzaFase = 0;

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
    const gotasOla = [];
    const salpicadurasOla = [];
    const tormentaOla = {
        nivel: 0, // 0 = calma, 1 = tormenta plena
        activa: false,
        acumulador: 0, // salpicaduras pendientes de emitir
        fase: 0, // reloj propio del oleaje de tormenta
        destello: 0, // fogonazo del último rayo
        proximoRayo: 0,
    };
    const rayosOla = [];

    // Corriente (efecto por obra; hoy sólo La gran ola): una mano en paz
    // abre un canal de agua horizontal. El mar corre a lo largo del canal,
    // con espuma viajando y los botes arrastrados por el mismo campo que
    // mueve el agua.
    let corrienteConfig = null;
    const corrienteOla = {
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
    const corrienteEspumaOla = [];

    // Barcas: cada una tiene su propio campo local sobre la malla (bob,
    // inclinación y deriva). Así no se mueven todas rígidas con el agua.
    let barcasActivas = [];
    let faseBarcas = 0;

    // Noche (efecto por obra; hoy sólo La gran ola): la pinza cerrada la
    // hace caer. El cuadro se vuelve azul profundo, aparecen estrellas en el
    // cielo y el mar se agita. Al abrir la pinza, amanece.
    let nocheConfig = null;
    const nocheOla = { nivel: 0, activa: false, fase: 0 };
    let estrellasOla = [];
    let astroConfig = null;

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

                    // Efectos de La gran ola: oleaje, tormenta del mar,
                    // corriente, barcas y noche (solo si la obra los declara).
                    pasoOleaje(dt);
                    pasoTormenta(dt);
                    pasoCorriente(dt);
                    pasoBarcas(dt);
                    pasoNoche(dt);

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
                    // Las obras con gestos propios sólo mueven el viento si
                    // lo declaran; las obras históricas mantienen `viento`.
                    const vientoActivo = obraActual && obraActual.gestos
                        ? efectosActivos.viento
                        : vientoDeObra;
                    const velocidadViento =
                        vientoActivo &&
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
                    actualizarTormentaOla(dt, revertir);
                    actualizarCorriente(dt);

                    actualizarEstrellasSueno(dt);
                    actualizarChorreos(dt);
                    actualizarCuadrados(dt);
                    actualizarKandinsky(dt);
                    actualizarExplosion(dt);
                    actualizarCroma(dt);
                    actualizarPinzaLluvia(dt);

                    dibujarTormenta(p);
                    dibujarAtmosfera(p);
                    dibujarDespeje(p);
                    dibujarLocura(p);
                    dibujarChorreos(p);
                    dibujarDisolucion(p);
                    dibujarKandinsky(p);
                    dibujarExplosion(p);
                    dibujarCroma(p);
                    dibujarPinzaLluvia(p);
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
                    dibujarNocheOla(p);
                    dibujarAstro(p);
                    dibujarTormentaOla(p);
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
        // El gesto de la paz hace algo distinto según la obra: meteoritos
        // (La noche estrellada), tormenta (El caminante) o una corriente
        // (obras con gestos propios). Obras sin configuración: inactivo.
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

    // Índice en Composición VIII: los círculos de la obra crecen, juegan con
    // sus tamaños y alternan colores mientras el gesto está activo.
    function actualizarKandinsky(dt) {
        kandinskyProgreso +=
            (objetivoKandinsky - kandinskyProgreso) *
            Math.min(1, dt * (objetivoKandinsky > kandinskyProgreso ? 2 : 0.7));
        if (Math.abs(objetivoKandinsky - kandinskyProgreso) < 0.002) {
            kandinskyProgreso = objetivoKandinsky;
        }
        kandinskyFase += dt * (0.8 + 0.6 * kandinskyProgreso);

        // Círculos extra: aparecen de a poco mientras dura el gesto.
        if (obraActual && obraActual.indiceEfecto === "ondas" && kandinskyProgreso > 0.02) {
            if (circulosKandinsky.length < 30) {
                kandinskyExtrasAcum += 6 * kandinskyProgreso * dt;
                while (kandinskyExtrasAcum >= 1) {
                    kandinskyExtrasAcum -= 1;
                    const tipoAzar = Math.random();
                    circulosKandinsky.push({
                        x: 0.06 + Math.random() * 0.88,
                        y: 0.06 + Math.random() * 0.88,
                        radio: 0.015 + Math.random() * 0.035,
                        fase: Math.random() * Math.PI * 2,
                        color: Math.floor(Math.random() * 5),
                        tipo: tipoAzar < 0.5 ? "circulo" : tipoAzar < 0.75 ? "cuadrado" : "triangulo",
                    });
                }
            }
        }
    }

    function dibujarKandinsky(p) {
        if (kandinskyProgreso <= 0.01) return;
        if (!zonasActivas.length) return;
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ladoMenor = Math.min(vista.anchoDibujo, vista.altoDibujo);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Fondo atenuado: los círculos resaltan contra la obra oscurecida.
        ctx.fillStyle = `rgba(8, 10, 16, ${(0.48 * kandinskyProgreso).toFixed(3)})`;
        ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);

        // Cada círculo de la obra se enciende en neón: la luz también
        // ilumina el círculo negro grande, que así se integra al efecto.
        let indice = 0;
        for (const zona of zonasActivas) {
            if (zona.efecto !== "crecer") continue;

            const centro = aVista(zona.x, zona.y, p, vista);
            const radio = Math.max(4, zona.radio * ladoMenor);
            const hue = (kandinskyFase * 45 + indice * 47) % 360;
            const alpha = 0.5 * kandinskyProgreso;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";

            // Aro neón con resplandor.
            ctx.shadowColor = `hsla(${hue}, 100%, 65%, ${alpha.toFixed(3)})`;
            ctx.shadowBlur = radio * 0.9;
            ctx.strokeStyle = `hsla(${hue}, 100%, 72%, ${alpha.toFixed(3)})`;
            ctx.lineWidth = Math.max(1.5, radio * 0.06);
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio * 0.92, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Luz interior: levanta incluso las zonas negras.
            const grad = ctx.createRadialGradient(
                centro.x,
                centro.y,
                radio * 0.15,
                centro.x,
                centro.y,
                radio
            );
            grad.addColorStop(0, `hsla(${hue}, 100%, 70%, ${(alpha * 0.55).toFixed(3)})`);
            grad.addColorStop(1, `hsla(${(hue + 30) % 360}, 100%, 60%, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, radio, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            indice += 1;
        }

        // Círculos extra: aparecen de a poco, también en neón.
        const paleta = [
            [255, 70, 70],
            [255, 222, 90],
            [80, 150, 255],
            [255, 250, 230],
            [190, 120, 255],
        ];
        for (const circulo of circulosKandinsky) {
            const centro = aVista(circulo.x, circulo.y, p, vista);
            const pulso =
                1 +
                kandinskyProgreso *
                    (0.3 + 0.25 * Math.sin(kandinskyFase * 1.4 + circulo.fase));
            const radio = Math.max(2, circulo.radio * ladoMenor * pulso);
            const color = paleta[circulo.color] || paleta[0];
            const alpha = 0.7 * kandinskyProgreso;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.shadowColor = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
            ctx.shadowBlur = radio * 1.4;
            ctx.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha.toFixed(3)})`;
            ctx.lineWidth = Math.max(1.2, ladoMenor * 0.0025);
            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${(
                alpha * 0.18
            ).toFixed(3)})`;

            ctx.translate(centro.x, centro.y);
            ctx.rotate(kandinskyFase * 0.7 + circulo.fase);
            ctx.beginPath();

            if (circulo.tipo === "cuadrado") {
                const lado = radio * 1.6;
                ctx.rect(-lado / 2, -lado / 2, lado, lado);
            } else if (circulo.tipo === "triangulo") {
                const lado = radio * 1.9;
                ctx.moveTo(0, -lado * 0.6);
                ctx.lineTo(lado * 0.55, lado * 0.4);
                ctx.lineTo(-lado * 0.55, lado * 0.4);
                ctx.closePath();
            } else {
                ctx.arc(0, 0, radio, 0, Math.PI * 2);
            }

            ctx.stroke();
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
    }

    // Explosión geométrica: un movimiento rápido de la palma rompe la obra
    // en cientos de piezas que salen volando y luego se rearman.
    function crearPiezasExplosion() {
        const piezas = [];
        const cols = 18;
        const filas = 12;
        for (let fy = 0; fy < filas; fy += 1) {
            for (let fx = 0; fx < cols; fx += 1) {
                const nx = (fx + 0.5) / cols;
                const ny = (fy + 0.5) / filas;
                const dx = nx - 0.5;
                const dy = ny - 0.5;
                const norma = Math.hypot(dx, dy) || 1;
                const velocidad = 0.5 + Math.random() * 0.9;
                piezas.push({
                    sx: (fx * dimensiones.ancho) / cols,
                    sy: (fy * dimensiones.alto) / filas,
                    sw: dimensiones.ancho / cols,
                    sh: dimensiones.alto / filas,
                    nx,
                    ny,
                    dx: (dx / norma) * velocidad + (Math.random() - 0.5) * 0.25,
                    dy: (dy / norma) * velocidad - 0.25 + Math.random() * 0.2,
                    rot: (Math.random() - 0.5) * 4,
                    fase: Math.random() * Math.PI * 2,
                    forma: Math.random() < 0.5 ? "tri" : "cir",
                });
            }
        }
        return piezas;
    }

    function actualizarExplosion(dt) {
        const estado = ultimaEntrada;
        const explosionPrevia = explosion;

        if (obraActual && obraActual.palmEfecto === "explotar") {
            // Al aparecer la palma, la obra explota y se hace de noche.
            objetivoExplosion = estado && estado.palmaManos > 0 ? 1 : 0;
            if (explosionPrevia < 0.05 && objetivoExplosion === 1) {
                destelloExplosion = 1;
            }
        } else {
            objetivoExplosion = 0;
        }

        explosion +=
            (objetivoExplosion - explosion) *
            Math.min(1, dt * (objetivoExplosion > explosion ? 4 : 0.7));
        if (Math.abs(objetivoExplosion - explosion) < 0.002) {
            explosion = objetivoExplosion;
        }

        faseExplosion += dt * (1.2 + explosion * 1.6);
        destelloExplosion = Math.max(0, destelloExplosion - dt * 1.6);

        // Fuegos artificiales: chispas de colores que rotan con el tiempo.
        if (explosion > 0.15) {
            fuegosExplosionAcum += 3.5 * dt * explosion;
            while (fuegosExplosionAcum >= 1) {
                fuegosExplosionAcum -= 1;
                const cx = 0.12 + Math.random() * 0.76;
                const cy = 0.12 + Math.random() * 0.76;
                const hueBase = (faseExplosion * 70 + Math.random() * 60) % 360;
                for (let i = 0; i < 16; i += 1) {
                    const ang = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
                    const vel = 0.05 + Math.random() * 0.07;
                    fuegosExplosion.push({
                        x: cx,
                        y: cy,
                        vx: Math.cos(ang) * vel,
                        vy: Math.sin(ang) * vel,
                        vida: 1,
                        hue: (hueBase + Math.random() * 30) % 360,
                    });
                }
            }
            if (fuegosExplosion.length > 320) {
                fuegosExplosion.splice(0, fuegosExplosion.length - 320);
            }
        }

        for (let i = fuegosExplosion.length - 1; i >= 0; i -= 1) {
            const fuego = fuegosExplosion[i];
            fuego.x += fuego.vx * dt;
            fuego.y += fuego.vy * dt;
            fuego.vy += 0.05 * dt; // gravedad suave
            fuego.vida -= dt * 0.9;
            if (fuego.vida <= 0) fuegosExplosion.splice(i, 1);
        }
    }

    function dibujarExplosion(p) {
        if (explosion <= 0.01 && destelloExplosion <= 0.01) return;
        if (!imagen || !dimensiones) return;
        if (!piezasExplosion) piezasExplosion = crearPiezasExplosion();

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;
        const d = Math.pow(Math.min(1, explosion), 1.2);
        const ladoMenor = Math.min(ancho, alto);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, ancho, alto);
        ctx.clip();

        // Piezas: mezcla de triángulos y círculos que salen volando.
        for (const pieza of piezasExplosion) {
            const cx = vista.offsetX + pieza.nx * ancho + pieza.dx * d * ancho * 0.32;
            const cy = vista.offsetY + pieza.ny * alto + pieza.dy * d * alto * 0.32;
            const rot = pieza.rot * d;
            const escala = vista.fit * (1 + d * 0.1);

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(rot);

            if (pieza.forma === "tri") {
                const w = pieza.sw * escala;
                const h = pieza.sh * escala;
                ctx.beginPath();
                ctx.moveTo(0, -w * 0.5);
                ctx.lineTo(w * 0.5, h * 0.42);
                ctx.lineTo(-w * 0.5, h * 0.42);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(
                    imagen.canvas,
                    pieza.sx,
                    pieza.sy,
                    pieza.sw,
                    pieza.sh,
                    -w / 2,
                    -h * 0.2,
                    w,
                    h
                );
            } else {
                const radio = Math.max(2, Math.min(pieza.sw, pieza.sh) * escala * 0.5);
                ctx.beginPath();
                ctx.arc(0, 0, radio, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(
                    imagen.canvas,
                    pieza.sx,
                    pieza.sy,
                    pieza.sw,
                    pieza.sh,
                    -radio,
                    -radio,
                    radio * 2,
                    radio * 2
                );
            }

            ctx.restore();
        }

        // Colores rotando sobre las piezas.
        const hue = (faseExplosion * 55) % 360;
        const brillo = ctx.createLinearGradient(
            vista.offsetX,
            vista.offsetY,
            vista.offsetX + ancho,
            vista.offsetY + alto
        );
        brillo.addColorStop(0, `hsla(${hue}, 85%, 55%, ${(0.32 * d).toFixed(3)})`);
        brillo.addColorStop(1, `hsla(${(hue + 120) % 360}, 85%, 55%, ${(0.32 * d).toFixed(3)})`);
        ctx.globalCompositeOperation = "color";
        ctx.fillStyle = brillo;
        ctx.fillRect(vista.offsetX, vista.offsetY, ancho, alto);
        ctx.globalCompositeOperation = "source-over";

        // Fuegos artificiales.
        for (const fuego of fuegosExplosion) {
            const px = vista.offsetX + fuego.x * ancho;
            const py = vista.offsetY + fuego.y * alto;
            const alpha = Math.max(0, fuego.vida) * d;
            ctx.fillStyle = `hsla(${fuego.hue}, 100%, 68%, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1, ladoMenor * 0.0022), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `hsla(${fuego.hue}, 100%, 68%, ${(alpha * 0.45).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px - fuego.vx * ancho * 0.06, py - fuego.vy * alto * 0.06);
            ctx.stroke();
        }

        // Noche: toda la escena se tiñe de azul profundo.
        if (d > 0.01) {
            ctx.fillStyle = `rgba(8, 12, 40, ${(0.45 * d).toFixed(3)})`;
            ctx.fillRect(vista.offsetX, vista.offsetY, ancho, alto);
        }

        // Destello blanco al explotar.
        if (destelloExplosion > 0.01) {
            ctx.fillStyle = `rgba(255, 250, 240, ${(0.55 * destelloExplosion).toFixed(3)})`;
            ctx.fillRect(vista.offsetX, vista.offsetY, ancho, alto);
        }

        ctx.restore();
    }

    // Paz en Composición VIII: cada movimiento amplio dispara una onda
    // cromática que cruza la pantalla y mezcla los colores.
    function actualizarCroma(dt) {
        cromaFase += dt;
        cromaCooldown = Math.max(0, cromaCooldown - dt);

        // El fondo se vuelve completamente negro mientras hay ondas activas.
        const objetivoOscuridad = ondasCromaticas.length > 0 ? 1 : 0;
        cromaOscuridad +=
            (objetivoOscuridad - cromaOscuridad) *
            Math.min(1, dt * (objetivoOscuridad > cromaOscuridad ? 8 : 1.2));
        if (Math.abs(objetivoOscuridad - cromaOscuridad) < 0.002) {
            cromaOscuridad = objetivoOscuridad;
        }

        const estado = ultimaEntrada;
        if (
            obraActual &&
            obraActual.pazEfecto === "croma" &&
            estado &&
            estado.paz &&
            cromaCooldown <= 0
        ) {
            const vel = estado.pazVelocidad || 0;
            const amplio = vel > 0.012;
            // La onda nace del centro de la obra y sale hacia afuera.
            ondasCromaticas.push({
                x: 0.5,
                y: 0.5,
                progreso: 0,
                hue: Math.random() * 360,
                fuerza: amplio ? Math.min(1, vel * 12) : 0.55,
                proxima: 0,
            });
            // El gesto sostenido mantiene el efecto vivo: emite ondas de
            // forma continua y los movimientos amplios aceleran la cadencia.
            cromaCooldown = amplio ? 0.35 : 0.8;
        }

        for (let i = ondasCromaticas.length - 1; i >= 0; i -= 1) {
            const onda = ondasCromaticas[i];
            onda.progreso += dt * 1.1;

            // Las ondas expulsan círculos, líneas fragmentadas y figuras.
            while (onda.proxima <= onda.progreso && onda.proxima < 1) {
                onda.proxima += 0.08;
                for (let j = 0; j < 6; j += 1) {
                    const ang = Math.random() * Math.PI * 2;
                    const tipoAzar = Math.random();
                    particulasCroma.push({
                        x: 0.5 + Math.cos(ang) * onda.progreso * 0.5,
                        y: 0.5 + Math.sin(ang) * onda.progreso * 0.5,
                        vx: Math.cos(ang) * (0.12 + Math.random() * 0.12),
                        vy: Math.sin(ang) * (0.12 + Math.random() * 0.12),
                        tipo:
                            tipoAzar < 0.45
                                ? "circulo"
                                : tipoAzar < 0.7
                                    ? "linea"
                                    : "figura",
                        rot: Math.random() * Math.PI,
                        giro: (Math.random() - 0.5) * 2.4,
                        tam: 0.012 + Math.random() * 0.022,
                        color: Math.floor(Math.random() * 5),
                        fase: Math.random() * Math.PI * 2,
                        vida: 1,
                    });
                }
            }

            if (onda.progreso >= 1) ondasCromaticas.splice(i, 1);
        }
        if (ondasCromaticas.length > 12) {
            ondasCromaticas.splice(0, ondasCromaticas.length - 12);
        }

        for (let i = particulasCroma.length - 1; i >= 0; i -= 1) {
            const particula = particulasCroma[i];
            particula.x += particula.vx * dt;
            particula.y += particula.vy * dt;
            particula.rot += particula.giro * dt;
            particula.vida -= dt * 0.5;
            if (particula.vida <= 0) particulasCroma.splice(i, 1);
        }
        if (particulasCroma.length > 520) {
            particulasCroma.splice(0, particulasCroma.length - 520);
        }

        // Círculos random por toda la pintura mientras hay ondas activas:
        // aparecen, giran, alternan su tamaño y cambian de color.
        const actividadOndas = Math.min(1, ondasCromaticas.length * 0.45);
        if (actividadOndas > 0.05) {
            circulosCromaAcum += 14 * dt * actividadOndas;
            while (circulosCromaAcum >= 1) {
                circulosCromaAcum -= 1;
                circulosCroma.push({
                    x: Math.random(),
                    y: Math.random(),
                    radio: 0.02 + Math.random() * 0.09,
                    vida: 0,
                    duracion: 1.4 + Math.random() * 1.8,
                    hue: Math.random() * 360,
                    rot: Math.random() * Math.PI,
                    giro: (Math.random() - 0.5) * 3,
                    pulso: 1 + Math.random() * 2.5,
                    fase: Math.random() * Math.PI * 2,
                    trazo: Math.random() < 0.5,
                });
            }
            if (circulosCroma.length > 160) {
                circulosCroma.splice(0, circulosCroma.length - 160);
            }
        }

        for (let i = circulosCroma.length - 1; i >= 0; i -= 1) {
            const circulo = circulosCroma[i];
            circulo.vida += dt / circulo.duracion;
            circulo.rot += circulo.giro * dt;
            if (circulo.vida >= 1) circulosCroma.splice(i, 1);
        }
    }

    function dibujarCroma(p) {
        if (
            ondasCromaticas.length === 0 &&
            particulasCroma.length === 0 &&
            circulosCroma.length === 0 &&
            cromaOscuridad < 0.01
        ) {
            return;
        }
        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ladoMenor = Math.min(vista.anchoDibujo, vista.altoDibujo);
        const maxDiag = Math.hypot(vista.anchoDibujo, vista.altoDibujo);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Las ondas apagan la obra por completo: fondo negro.
        if (cromaOscuridad > 0.01) {
            ctx.fillStyle = `rgba(0, 0, 0, ${cromaOscuridad.toFixed(3)})`;
            ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        }

        for (const onda of ondasCromaticas) {
            const centro = aVista(onda.x, onda.y, p, vista);
            const radio = onda.progreso * maxDiag * 0.85;
            const grosor = ladoMenor * 0.16;
            const alpha = Math.sin(Math.PI * onda.progreso) * 0.6 * onda.fuerza;
            const hue = (onda.hue + onda.progreso * 140 + cromaFase * 30) % 360;

            // Dos anillos de tono desfasado: los colores se separan y se
            // mezclan al atravesar la superficie.
            for (const desfase of [0, 120]) {
                const grad = ctx.createRadialGradient(
                    centro.x,
                    centro.y,
                    Math.max(0, radio - grosor),
                    centro.x,
                    centro.y,
                    radio + grosor
                );
                grad.addColorStop(0, "hsla(0, 0%, 0%, 0)");
                grad.addColorStop(
                    0.5,
                    `hsla(${(hue + desfase) % 360}, 95%, 60%, ${alpha.toFixed(3)})`
                );
                grad.addColorStop(1, "hsla(0, 0%, 0%, 0)");

                ctx.globalCompositeOperation = "color";
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(centro.x, centro.y, radio + grosor, 0, Math.PI * 2);
                ctx.fill();

                ctx.globalCompositeOperation = "screen";
                ctx.fill();
            }
        }

        // Figuras expulsadas por las ondas: círculos, líneas y geometría que
        // cambian de tamaño, giran y mutan de color mientras se alejan.
        for (const particula of particulasCroma) {
            const centro = aVista(particula.x, particula.y, p, vista);
            const fase = particula.fase || 0;
            const pulso = 0.7 + 0.5 * Math.sin(cromaFase * 3.4 + fase);
            const tam = Math.max(2, particula.tam * ladoMenor * pulso);
            const giroColor = (cromaFase * 70 + particula.color * 55 + fase * 40) % 360;
            const alpha = Math.max(0, particula.vida);

            ctx.save();
            ctx.translate(centro.x, centro.y);
            ctx.rotate(particula.rot);
            ctx.strokeStyle = `hsla(${giroColor.toFixed(1)}, 95%, 62%, ${alpha.toFixed(3)})`;
            ctx.fillStyle = `hsla(${((giroColor + 40) % 360).toFixed(1)}, 95%, 55%, ${(
                alpha * 0.3
            ).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, ladoMenor * 0.002);
            ctx.beginPath();

            if (particula.tipo === "circulo") {
                ctx.arc(0, 0, tam * 0.6, 0, Math.PI * 2);
            } else if (particula.tipo === "linea") {
                ctx.moveTo(-tam, 0);
                ctx.lineTo(tam, 0);
            } else {
                const lado = tam * 1.1;
                ctx.moveTo(0, -lado * 0.6);
                ctx.lineTo(lado * 0.55, lado * 0.4);
                ctx.lineTo(-lado * 0.55, lado * 0.4);
                ctx.closePath();
            }

            ctx.stroke();
            if (particula.tipo !== "linea") {
                ctx.fill();
            }
            ctx.restore();
        }

        // Círculos random repartidos por toda la pintura: aparecen, giran,
        // alternan su tamaño y cambian de color.
        for (const circulo of circulosCroma) {
            const px = vista.offsetX + circulo.x * vista.anchoDibujo;
            const py = vista.offsetY + circulo.y * vista.altoDibujo;
            const aparicion = Math.sin(Math.PI * Math.min(1, circulo.vida));
            const pulso =
                1 + 0.45 * Math.sin(cromaFase * 4 * circulo.pulso + circulo.fase);
            const radio = Math.max(2, circulo.radio * ladoMenor * pulso * aparicion);
            const hueCirculo = (circulo.hue + cromaFase * 60) % 360;
            const alpha = Math.min(1, circulo.vida * 3) * (1 - circulo.vida);

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(circulo.rot);
            ctx.strokeStyle = `hsla(${hueCirculo.toFixed(1)}, 95%, 62%, ${Math.max(
                0,
                alpha
            ).toFixed(3)})`;
            ctx.lineWidth = Math.max(1, ladoMenor * 0.003);
            ctx.beginPath();
            ctx.arc(0, 0, radio, 0, Math.PI * 2);
            if (!circulo.trazo) {
                ctx.fillStyle = `hsla(${hueCirculo.toFixed(1)}, 90%, 55%, ${Math.max(
                    0,
                    alpha * 0.35
                ).toFixed(3)})`;
                ctx.fill();
            }
            ctx.stroke();
            ctx.restore();
        }

        ctx.globalCompositeOperation = "source-over";
        ctx.restore();
    }

    // Pinza en Composición VIII: la obra llueve desde los cuatro bordes y
    // todo colisiona en el centro. Arriba cuadrados, abajo triángulos,
    // izquierda rectángulos, derecha círculos.
    function soltarPiezaPinza(lado) {
        const base = dimensiones.ancho * (0.03 + Math.random() * 0.05);
        let sw = base;
        let sh = base;
        if (lado === "izquierda") {
            sw = base * 1.7;
            sh = base * 0.75;
        } else if (lado === "abajo") {
            sh = base * 1.2;
        }

        const sx = Math.random() * Math.max(1, dimensiones.ancho - sw);
        const sy = Math.random() * Math.max(1, dimensiones.alto - sh);
        const rapidez = 0.5 + Math.random() * 0.25;
        const jitter = (Math.random() - 0.5) * 0.05;
        const pieza = {
            sx,
            sy,
            sw,
            sh,
            lado,
            x: 0.5,
            y: 0.5,
            vx: 0,
            vy: 0,
            rot: (Math.random() - 0.5) * 1.2,
            giro: (Math.random() - 0.5) * 1.6,
            fase: Math.random() * Math.PI * 2,
        };

        // Nacen en el borde de su lado, dentro de una franja central, para
        // que la lluvia caiga hacia el centro y todas colisionen.
        if (lado === "arriba") {
            pieza.x = 0.3 + Math.random() * 0.4;
            pieza.y = -0.12;
        } else if (lado === "abajo") {
            pieza.x = 0.3 + Math.random() * 0.4;
            pieza.y = 1.12;
        } else if (lado === "izquierda") {
            pieza.x = -0.12;
            pieza.y = 0.3 + Math.random() * 0.4;
        } else {
            pieza.x = 1.12;
            pieza.y = 0.3 + Math.random() * 0.4;
        }

        // Velocidad apuntando al centro: todas terminan en la colisión.
        const dx = 0.5 - pieza.x;
        const dy = 0.5 - pieza.y;
        const norma = Math.hypot(dx, dy) || 1;
        pieza.vx = (dx / norma) * rapidez + jitter;
        pieza.vy = (dy / norma) * rapidez + jitter;

        piezasPinza.push(pieza);
    }

    function explosionarPiezasPinza() {
        // Al abrir la pinza por completo, todos los pedazos salen despedidos
        // en todas las direcciones antes de que la obra vuelva a su forma.
        for (const pieza of piezasPinza) {
            const dx = pieza.x - 0.5;
            const dy = pieza.y - 0.5;
            const norma = Math.hypot(dx, dy) || 1;
            const rapidez = 0.8 + Math.random() * 0.9;
            pieza.modo = "explosion";
            pieza.vx = (dx / norma) * rapidez + (Math.random() - 0.5) * 0.35;
            pieza.vy = (dy / norma) * rapidez + (Math.random() - 0.5) * 0.35;
            pieza.giro = (Math.random() - 0.5) * 7;
            pieza.vida = 1;
        }

        // Y estallan también pedazos nuevos desde el centro.
        for (let i = 0; i < 26; i += 1) {
            const azar = Math.random();
            soltarPiezaPinza(
                azar < 0.25
                    ? "arriba"
                    : azar < 0.5
                        ? "abajo"
                        : azar < 0.75
                            ? "izquierda"
                            : "derecha"
            );
            const nueva = piezasPinza[piezasPinza.length - 1];
            nueva.x = 0.5;
            nueva.y = 0.5;
            const ang = Math.random() * Math.PI * 2;
            const rapidez = 0.7 + Math.random() * 1;
            nueva.modo = "explosion";
            nueva.vx = Math.cos(ang) * rapidez;
            nueva.vy = Math.sin(ang) * rapidez;
            nueva.giro = (Math.random() - 0.5) * 8;
            nueva.vida = 1;
        }
    }

    function actualizarPinzaLluvia(dt) {
        pinzaFase += dt;
        const estado = ultimaEntrada;
        const esLluvia = obraActual && obraActual.pinzaEfecto === "lluvia";
        const activa = esLluvia && imagen && dimensiones && estado && estado.pinzaCerrada;

        // Mientras la pinza está cerrada, la obra llueve desde los bordes.
        if (activa) {
            pinzaEstabaCerrada = true;
            piezasPinzaAcum += 52 * dt;
            while (piezasPinzaAcum >= 1) {
                piezasPinzaAcum -= 1;
                const azar = Math.random();
                soltarPiezaPinza(
                    azar < 0.25
                        ? "arriba"
                        : azar < 0.5
                            ? "abajo"
                            : azar < 0.75
                                ? "izquierda"
                                : "derecha"
                );
            }
        } else {
            // Al abrir la pinza por completo (estado "abierta"), antes de
            // volver a la obra original, todo lo que está en escena
            // explota y los pedazos se van por todos lados.
            const abierta =
                esLluvia && estado && estado.pinzaAbierta && !estado.pinzaCerrada;
            if (pinzaEstabaCerrada && abierta && imagen && dimensiones) {
                explosionarPiezasPinza();
            }
            pinzaEstabaCerrada = false;
            piezasPinzaAcum = 0;
        }
        if (piezasPinza.length > 260) {
            piezasPinza.splice(0, piezasPinza.length - 260);
        }

        for (let i = piezasPinza.length - 1; i >= 0; i -= 1) {
            const pieza = piezasPinza[i];

            // Pedazos despedidos por la explosión: vuelan lejos y se apagan.
            if (pieza.modo === "explosion") {
                pieza.x += pieza.vx * dt;
                pieza.y += pieza.vy * dt;
                pieza.rot += pieza.giro * dt;
                pieza.vida -= dt * 0.55;
                if (
                    pieza.vida <= 0 ||
                    pieza.x < -0.3 ||
                    pieza.x > 1.3 ||
                    pieza.y < -0.3 ||
                    pieza.y > 1.3
                ) {
                    piezasPinza.splice(i, 1);
                }
                continue;
            }

            pieza.x += pieza.vx * dt;
            pieza.y += pieza.vy * dt;
            pieza.rot += pieza.giro * dt;

            // Al llegar al centro, colisiona y estalla.
            if (Math.hypot(pieza.x - 0.5, pieza.y - 0.5) < 0.06) {
                piezasPinza.splice(i, 1);
                for (let j = 0; j < 9; j += 1) {
                    const ang = Math.random() * Math.PI * 2;
                    const vel = 0.18 + Math.random() * 0.34;
                    destellosPinza.push({
                        x: 0.5,
                        y: 0.5,
                        vx: Math.cos(ang) * vel,
                        vy: Math.sin(ang) * vel,
                        vida: 1,
                        hue: Math.random() * 360,
                    });
                }
            }
        }
        if (destellosPinza.length > 420) {
            destellosPinza.splice(0, destellosPinza.length - 420);
        }

        for (let i = destellosPinza.length - 1; i >= 0; i -= 1) {
            const destello = destellosPinza[i];
            destello.x += destello.vx * dt;
            destello.y += destello.vy * dt;
            destello.vida -= dt * 1.4;
            if (destello.vida <= 0) destellosPinza.splice(i, 1);
        }
    }

    function dibujarPinzaLluvia(p) {
        if (piezasPinza.length === 0 && destellosPinza.length === 0) {
            return;
        }
        if (!imagen || !dimensiones) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;
        const ladoMenor = Math.min(ancho, alto);
        const centroX = vista.offsetX + ancho / 2;
        const centroY = vista.offsetY + alto / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, ancho, alto);
        ctx.clip();

        // Piezas de la obra que caen desde cada borde hacia el centro.
        for (const pieza of piezasPinza) {
            const px = vista.offsetX + pieza.x * ancho;
            const py = vista.offsetY + pieza.y * alto;
            const w = pieza.sw * vista.fit;
            const h = pieza.sh * vista.fit;

            ctx.save();
            if (pieza.modo === "explosion") {
                ctx.globalAlpha = Math.max(0, Math.min(1, pieza.vida));
            }
            ctx.translate(px, py);
            ctx.rotate(pieza.rot);
            ctx.beginPath();

            if (pieza.lado === "abajo") {
                ctx.moveTo(0, -h * 0.55);
                ctx.lineTo(w * 0.5, h * 0.45);
                ctx.lineTo(-w * 0.5, h * 0.45);
                ctx.closePath();
                ctx.clip();
                ctx.drawImage(
                    imagen.canvas,
                    pieza.sx,
                    pieza.sy,
                    pieza.sw,
                    pieza.sh,
                    -w / 2,
                    -h * 0.4,
                    w,
                    h
                );
            } else if (pieza.lado === "derecha") {
                const radio = Math.max(2, Math.min(w, h) * 0.5);
                ctx.arc(0, 0, radio, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(
                    imagen.canvas,
                    pieza.sx,
                    pieza.sy,
                    pieza.sw,
                    pieza.sh,
                    -radio,
                    -radio,
                    radio * 2,
                    radio * 2
                );
            } else {
                ctx.rect(-w / 2, -h / 2, w, h);
                ctx.clip();
                ctx.drawImage(
                    imagen.canvas,
                    pieza.sx,
                    pieza.sy,
                    pieza.sw,
                    pieza.sh,
                    -w / 2,
                    -h / 2,
                    w,
                    h
                );
            }

            ctx.restore();
        }

        // Destellos de la colisión.
        for (const destello of destellosPinza) {
            const px = vista.offsetX + destello.x * ancho;
            const py = vista.offsetY + destello.y * alto;
            const alpha = Math.max(0, destello.vida);
            ctx.fillStyle = `hsla(${(destello.hue + pinzaFase * 90) % 360}, 100%, 68%, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(px, py, Math.max(1, ladoMenor * 0.0035), 0, Math.PI * 2);
            ctx.fill();
        }

        // Núcleo del impacto: crece con la cantidad de choques.
        if (destellosPinza.length > 20) {
            const intensidad = Math.min(1, destellosPinza.length / 180);
            const radioNucleo = ladoMenor * 0.22 * intensidad + 1;
            const nucleo = ctx.createRadialGradient(
                centroX,
                centroY,
                0,
                centroX,
                centroY,
                radioNucleo
            );
            nucleo.addColorStop(0, `rgba(255, 250, 235, ${(0.5 * intensidad).toFixed(3)})`);
            nucleo.addColorStop(1, "rgba(255, 250, 235, 0)");
            ctx.fillStyle = nucleo;
            ctx.beginPath();
            ctx.arc(centroX, centroY, radioNucleo, 0, Math.PI * 2);
            ctx.fill();
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
    function crearRayoOla() {
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

    function actualizarTormentaOla(dt, revertir) {
        if (!tormentaConfig) return;

        const nivel = revertir ? 0 : tormentaOla.nivel;

        // Lluvia: parque fijo dibujado con alfa = nivel, así entra y sale
        // con un fundido sin que aparezcan o desaparezcan gotasOla de golpe.
        const maxGotas = tormentaConfig.gotasOla || 150;
        if (nivel > 0.01) {
            while (gotasOla.length < maxGotas) gotasOla.push(crearGota());
        } else if (gotasOla.length > 0) {
            gotasOla.length = 0;
        }

        for (const gota of gotasOla) {
            gota.x += gota.vx * dt;
            gota.y += gota.vy * dt;
            if (gota.y > 1.08 || gota.x > 1.12) reiniciarGota(gota);
        }

        // Salpicaduras: sólo con la tormentaOla viva. Vuelan en abanico desde
        // la cresta, caen y se apagan.
        if (nivel > 0.02 && emisoresEspuma.length > 0) {
            tormentaOla.acumulador += (tormentaConfig.salpicadurasOla || 36) * nivel * dt;
            while (tormentaOla.acumulador >= 1) {
                tormentaOla.acumulador -= 1;
                salpicadurasOla.push(crearSalpicadura());
            }
        }

        for (let i = salpicadurasOla.length - 1; i >= 0; i -= 1) {
            const salpicadura = salpicadurasOla[i];
            salpicadura.vy += 0.9 * dt; // la gravedad las devuelve al mar
            salpicadura.x += salpicadura.vx * dt;
            salpicadura.y += salpicadura.vy * dt;
            salpicadura.vida -= dt;
            if (salpicadura.vida <= 0) salpicadurasOla.splice(i, 1);
        }

        // Rayos: caen al azar mientras la tormentaOla está alta. Cada uno vive
        // unas décimas y deja un destello breve en toda la escena.
        const ahoraMs = performance.now();
        if (nivel > 0.3 && ahoraMs >= tormentaOla.proximoRayo) {
            rayosOla.push(crearRayoOla());
            tormentaOla.destello = 1;

            const espera = ((tormentaConfig.rayosOla || 1.6) * 1000) / Math.max(0.4, nivel);
            tormentaOla.proximoRayo = ahoraMs + espera * (0.6 + Math.random() * 0.8);
        }

        for (let i = rayosOla.length - 1; i >= 0; i -= 1) {
            rayosOla[i].vida -= dt;
            if (rayosOla[i].vida <= 0) rayosOla.splice(i, 1);
        }

        tormentaOla.destello *= Math.exp(-dt * 7);
    }

    function dibujarTormentaOla(p) {
        if (tormentaOla.nivel <= 0.001 || !dimensiones) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const nivel = tormentaOla.nivel;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Cielo de tormentaOla: más oscuro arriba que abajo. Va debajo de la
        // lluvia y de las salpicadurasOla para que las partículas queden
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

        if (gotasOla.length > 0) {
            ctx.strokeStyle = `rgba(205, 228, 250, ${0.42 * nivel})`;
            ctx.lineWidth = Math.max(1, vista.anchoDibujo * 0.0009);
            ctx.lineCap = "round";
            ctx.beginPath();

            for (const gota of gotasOla) {
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
        // antes de las salpicadurasOla para que la espuma quede al frente.
        for (const rayo of rayosOla) {
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

        for (const salpicadura of salpicadurasOla) {
            const alpha = Math.max(0, salpicadura.vida / salpicadura.vidaMax) * 0.85 * nivel;
            if (alpha <= 0.01) continue;

            const centro = aVista(salpicadura.x, salpicadura.y, p, vista);
            ctx.fillStyle = `rgba(228, 244, 255, ${alpha})`;
            ctx.beginPath();
            ctx.arc(centro.x, centro.y, Math.max(1, salpicadura.tamaño * escala), 0, Math.PI * 2);
            ctx.fill();
        }

        // Fogonazo: ilumina toda la escena un instante, por encima de todo.
        if (tormentaOla.destello > 0.01) {
            ctx.fillStyle = `rgba(198, 220, 255, ${0.13 * tormentaOla.destello * nivel})`;
            ctx.fillRect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        }

        ctx.restore();
    }

    // --- Corriente: canal entre las dos manos -------------------------------

    function pasoCorriente(dt) {
        if (!corrienteConfig) return;

        const objetivo = corrienteOla.activa ? 1 : 0;
        const ritmo = corrienteOla.activa
            ? corrienteConfig.entrada || 3
            : corrienteConfig.salida || 1.2;
        corrienteOla.nivel += (objetivo - corrienteOla.nivel) * Math.min(1, dt * ritmo);
        if (objetivo === 0 && corrienteOla.nivel < 0.003) corrienteOla.nivel = 0;

        // Los dos puntos se siguen con filtro: el modelo tiembla y el canal
        // no debe vibrar.
        const suavidad = Math.min(1, dt * 7);
        corrienteOla.ax += (corrienteOla.objetivoAx - corrienteOla.ax) * suavidad;
        corrienteOla.ay += (corrienteOla.objetivoAy - corrienteOla.ay) * suavidad;
        corrienteOla.bx += (corrienteOla.objetivoBx - corrienteOla.bx) * suavidad;
        corrienteOla.by += (corrienteOla.objetivoBy - corrienteOla.by) * suavidad;

        corrienteOla.fase += dt * (2 + 3 * corrienteOla.nivel);
    }

    // Geometría del canal en un punto: dirección del flujo y caída por
    // distancia al segmento. Devuelve null si no hay corriente.
    function campoCorriente(px, py) {
        if (!corrienteConfig || corrienteOla.nivel <= 0.001 || !dimensiones) {
            return null;
        }

        const ax = corrienteOla.ax * dimensiones.ancho;
        const ay = corrienteOla.ay * dimensiones.alto;
        const bx = corrienteOla.bx * dimensiones.ancho;
        const by = corrienteOla.by * dimensiones.alto;
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

    // Cuánto llega la corrienteOla a un punto: 0 = nada, 1 = centro del canal.
    function caidaCorriente(px, py) {
        const campo = campoCorriente(px, py);
        return campo ? corrienteOla.nivel * campo.caida : 0;
    }

    // Cada barco recibe su propia actividad según lo que tenga alrededor:
    // mar despierto, tormentaOla o la corrienteOla pasando por encima.
    function pasoBarcas(dt) {
        if (barcasActivas.length === 0 || !dimensiones) return;

        const actividad = Math.max(
            oleaje.ambiente * 0.55,
            tormentaOla.nivel,
            corrienteOla.nivel,
            nocheOla.nivel * 0.8
        );
        faseBarcas += dt * (0.8 + 1.6 * actividad);

        for (const barca of barcasActivas) {
            const agua = caidaCorriente(
                barca.x * dimensiones.ancho,
                barca.y * dimensiones.alto
            );
            barca.actividad = Math.max(
                oleaje.ambiente * 0.55,
                tormentaOla.nivel,
                agua,
                nocheOla.nivel * 0.8
            );
        }
    }

    // La pinza cerrada hace caer la nocheOla; al abrirla amanece.
    function pasoNoche(dt) {
        if (!nocheConfig) return;

        if (nocheOla.activa) {
            nocheOla.nivel += dt * (nocheConfig.entrada || 0.9);
        } else {
            nocheOla.nivel -= dt * (nocheConfig.salida || 1.3);
        }

        nocheOla.nivel = Math.max(0, Math.min(1, nocheOla.nivel));

        // Reloj de la agitación y del titileo de las estrellasOla.
        nocheOla.fase += dt * (1.2 + 2.0 * nocheOla.nivel);

        // Las estrellasOla se reparten cuando el cielo ya está disponible.
        if (nocheOla.nivel > 0.01 && estrellasOla.length === 0) {
            estrellasOla = crearEstrellas();
        }
    }

    // Estrellas del cielo nocturno: se reparten donde la máscara es 0
    // (cielo, no agua) y fuera del cartucho. Se generan una vez por obra.
    function crearEstrellas() {
        if (!mascaraPesos || !dimensiones) return [];

        const total = nocheConfig ? nocheConfig.estrellasOla || 70 : 0;
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

    function dibujarNocheOla(p) {
        if (!nocheConfig || nocheOla.nivel <= 0.001 || estrellasOla.length === 0) {
            return;
        }

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const escala = Math.max(1, vista.anchoDibujo / 1600);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        for (const estrella of estrellasOla) {
            const titileo =
                0.55 +
                0.45 *
                    Math.sin(nocheOla.fase * (1.2 + estrella.brillo) + estrella.fase);
            const alpha = nocheOla.nivel * estrella.brillo * titileo;
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

    // Sol de día y luna de nocheOla en el mismo punto del cielo. El astro sólo
    // existe mientras la pinza está activa: en reposo la pintura queda
    // original, sin sol agregado. Con la pinza, el sol se pone y la luna
    // sube; al abrir, el sol vuelve a asomar un instante y se va.
    function dibujarAstro(p) {
        if (!astroConfig || !dimensiones || nocheOla.nivel <= 0.001) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const centro = aVista(astroConfig.x, astroConfig.y, p, vista);
        const radio = Math.max(4, (astroConfig.radio || 0.034) * vista.anchoDibujo);
        const nivel = nocheOla.nivel;

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        // Sol: sólo durante la transición (puesta o salida). En nocheOla plena
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
        const ax = corrienteOla.ax;
        const ay = corrienteOla.ay;
        const dx = corrienteOla.bx - ax;
        const dy = corrienteOla.by - ay;
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

        if (corrienteOla.nivel > 0.02) {
            corrienteOla.acumulador +=
                (corrienteConfig.espuma || 34) * corrienteOla.nivel * dt;
            while (corrienteOla.acumulador >= 1) {
                corrienteOla.acumulador -= 1;
                const particula = crearEspumaCorriente();
                if (particula) corrienteEspumaOla.push(particula);
            }
        } else {
            corrienteOla.acumulador = 0;
        }

        for (let i = corrienteEspumaOla.length - 1; i >= 0; i -= 1) {
            const particula = corrienteEspumaOla[i];
            particula.x += particula.vx * dt;
            particula.y += particula.vy * dt;
            particula.vida -= dt;
            if (particula.vida <= 0) corrienteEspumaOla.splice(i, 1);
        }
    }

    function dibujarCorriente(p) {
        if (corrienteOla.nivel <= 0.001 || corrienteEspumaOla.length === 0) return;

        const vista = vistaPintura(p);
        const ctx = p.drawingContext;
        const escala = Math.max(1, vista.anchoDibujo / 1600);

        ctx.save();
        ctx.beginPath();
        ctx.rect(vista.offsetX, vista.offsetY, vista.anchoDibujo, vista.altoDibujo);
        ctx.clip();

        ctx.lineCap = "round";

        for (const particula of corrienteEspumaOla) {
            const alpha =
                Math.max(0, particula.vida / particula.vidaMax) *
                0.7 *
                corrienteOla.nivel;
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

        // Índice (Composición VIII): los círculos de la obra crecen y juegan
        // con sus tamaños mientras el gesto está activo.
        if (kandinskyProgreso > 0.002) {
            for (const zona of zonasActivas) {
                if (zona.efecto !== "crecer") continue;

                const cx = zona.x * dimensiones.ancho;
                const cy = zona.y * dimensiones.alto;
                const radio = zona.radio * Math.min(dimensiones.ancho, dimensiones.alto);
                const dx = x - cx;
                const dy = y - cy;
                const caida = Math.exp(-(dx * dx + dy * dy) / (radio * radio));
                const faseZona = cx * 0.012 + cy * 0.017;
                const pulso =
                    1 +
                    kandinskyProgreso *
                        caida *
                        (0.35 + 0.3 * Math.sin(kandinskyFase * 1.6 + faseZona));
                x = cx + dx * pulso;
                y = cy + dy * pulso;
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
        if (tormentaConfig && tormentaOla.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            if (peso > 0) {
                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const reloj = tormentaOla.fase;
                const nivel = tormentaOla.nivel;

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
        if (corrienteConfig && corrienteOla.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            const campo = peso > 0 ? campoCorriente(px, py) : null;

            if (campo && campo.caida > 0.002) {
                const flujo =
                    0.6 + 0.4 * Math.sin(px * 0.008 - corrienteOla.fase * 2.2);
                const empuje =
                    corrienteOla.nivel *
                    peso *
                    campo.caida *
                    flujo *
                    (corrienteConfig.amplitud || 52);

                x += campo.ux * empuje;
                y += campo.uy * empuje;

                // El agua no sólo se corre: se revuelve. Chapoteo vertical
                // y un vaivén lateral dentro del canal.
                const revuelo = corrienteOla.nivel * peso * campo.caida;
                y +=
                    Math.sin(px * 0.012 + corrienteOla.fase * 2.4) *
                    Math.cos(py * 0.015 - corrienteOla.fase * 1.7) *
                    revuelo *
                    (corrienteConfig.agitacion || 18);
                x +=
                    Math.sin(py * 0.02 + corrienteOla.fase * 1.9) *
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
        if (nocheConfig && nocheOla.nivel > 0.001 && mascaraPesos) {
            const peso = pesoMascara(px, py);
            if (peso > 0) {
                const u = px / dimensiones.ancho;
                const v = py / dimensiones.alto;
                const reloj = nocheOla.fase;
                const nivel = nocheOla.nivel;

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
    // abierto). Excluye suavemente los cuerpos celestes (luna y estrellasOla) y
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
                // todo: la luna y las estrellasOla también respiran con ella.
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
    // suelta. Todo lo demás (tinte, lluvia, salpicadurasOla) se cuelga de acá.
    function pasoTormenta(dt) {
        if (!tormentaConfig) return;

        const objetivo = tormentaOla.activa ? 1 : 0;
        const ritmo = tormentaOla.activa
            ? tormentaConfig.entrada || 2.2
            : tormentaConfig.salida || 0.8;

        tormentaOla.nivel += (objetivo - tormentaOla.nivel) * Math.min(1, dt * ritmo);
        if (objetivo === 0 && tormentaOla.nivel < 0.003) tormentaOla.nivel = 0;

        // Reloj propio del chapoteo: mucho más rápido que el del oleaje.
        tormentaOla.fase += dt * (1.6 + 2.2 * tormentaOla.nivel);
    }

    // Oscurecimiento de la pintura: la pinza y la tormentaOla comparten el
    // tinte para que el agua y el cielo se apaguen de verdad, con textura,
    // en vez de recibir un velo plano por encima.
    function tintePintura() {
        const oscuridadPinza = iluminacion * OSCURECER_MAX;
        const oscuridadTormenta =
            tormentaOla.nivel * (tormentaConfig ? tormentaConfig.oscuridad || 0.3 : 0);
        const oscuridadNoche =
            nocheOla.nivel * (nocheConfig ? nocheConfig.oscuridad || 0.55 : 0);
        const oscuridad = Math.min(
            0.84,
            oscuridadPinza + oscuridadTormenta + oscuridadNoche
        );
        const brillo = 255 * (1 - oscuridad);

        const frialdadTormenta =
            tormentaOla.nivel * (tormentaConfig ? tormentaConfig.frialdad || 0.4 : 0);
        const frialdadNoche =
            nocheOla.nivel * (nocheConfig ? nocheConfig.frialdad || 0.85 : 0);

        // La nocheOla no sólo oscurece: baja el rojo mucho más que el azul, que
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

        // Pasada base: la pintura original con el tinte de la escena
        // (tormenta / noche). El zoom de la pinza la oscurece casi a negro
        // para que el aura resalte; al derretir los relojes baja apenas un
        // 15%, como si la escena se ensombreciera.
        const factorExtra = 1 - (profundidad * 0.8 + derretir * 0.15);
        p.tint(tinte.r * factorExtra, tinte.g * factorExtra, tinte.b * factorExtra);
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
        kandinskyProgreso = 0;
        objetivoKandinsky = 0;
        kandinskyFase = 0;
        kandinskyExtrasAcum = 0;
        circulosKandinsky.length = 0;
        explosion = 0;
        objetivoExplosion = 0;
        destelloExplosion = 0;
        faseExplosion = 0;
        piezasExplosion = null;
        fuegosExplosion.length = 0;
        fuegosExplosionAcum = 0;
        cromaFase = 0;
        cromaCooldown = 0;
        cromaOscuridad = 0;
        ondasCromaticas.length = 0;
        particulasCroma.length = 0;
        circulosCroma.length = 0;
        circulosCromaAcum = 0;
        piezasPinza.length = 0;
        piezasPinzaAcum = 0;
        destellosPinza.length = 0;
        pinzaEstabaCerrada = false;
        pinzaFase = 0;

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

        // Mar de La gran ola: tormenta, corriente y noche en cero.
        tormentaOla.nivel = 0;
        tormentaOla.activa = false;
        tormentaOla.acumulador = 0;
        tormentaOla.fase = 0;
        tormentaOla.destello = 0;
        tormentaOla.proximoRayo = 0;
        gotasOla.length = 0;
        salpicadurasOla.length = 0;
        rayosOla.length = 0;

        corrienteOla.nivel = 0;
        corrienteOla.activa = false;
        corrienteOla.ax = 0.5;
        corrienteOla.ay = 0.5;
        corrienteOla.bx = 0.5;
        corrienteOla.by = 0.5;
        corrienteOla.objetivoAx = 0.5;
        corrienteOla.objetivoAy = 0.5;
        corrienteOla.objetivoBx = 0.5;
        corrienteOla.objetivoBy = 0.5;
        corrienteOla.fase = 0;
        corrienteOla.acumulador = 0;
        corrienteEspumaOla.length = 0;

        nocheOla.nivel = 0;
        nocheOla.activa = false;
        nocheOla.fase = 0;
        estrellasOla = [];

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
                // Resplandor de los cuerpos celestes: se hornea solo cuando
                // la obra lo usa (cuerpos/luces) o cuando lo declara en sus
                // gestos; las demás obras no lo necesitan.
                const hayResplandor =
                    !obra.gestos ||
                    efectosActivos.resplandor ||
                    (Array.isArray(cuerposActivos) && cuerposActivos.length > 0) ||
                    (Array.isArray(lucesActivas) && lucesActivas.length > 0);
                imagenResplandor = hayResplandor
                    ? crearVersionResplandor(
                          cuerposActivos.length > 0 ? cuerposActivos : lucesActivas
                      )
                    : null;

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

        // Índice en Composición VIII: ondas geométricas al mover la mano.
        objetivoKandinsky =
            obraActual && obraActual.indiceEfecto === "ondas" && estado.molino ? 1 : 0;

        if (
            estado.molino &&
            obraActual &&
            Array.isArray(obraActual.zonas) &&
            obraActual.zonas.some((zona) => zona.efecto === "remolino")
        ) {
            // Obras con gestos propios: la pinza enciende el resplandor solo
            // si la obra lo declara.
            if (obraActual && obraActual.gestos && efectosActivos.resplandor) {
                objetivoIluminacion = estado.pinzaCerrada ? 1 : 0;
            }
        }

        if (efectosActivos.molino && estado.molino) {
            molinoHasta = performance.now() + 900;
        }

        // Tormenta: el índice extendido la sostiene; al bajarlo escampa.
        if (tormentaConfig) {
            tormentaOla.activa = !!estado.point;
        }

        // Corriente: una mano en paz abre el canal; se apaga al bajarla.
        if (corrienteConfig) {
            corrienteOla.activa = !!estado.corriente;
            if (corrienteOla.activa) {
                corrienteOla.objetivoAx = estado.corriente.ax;
                corrienteOla.objetivoAy = estado.corriente.ay;
                corrienteOla.objetivoBx = estado.corriente.bx;
                corrienteOla.objetivoBy = estado.corriente.by;
            }
        }

        // Noche: la pinza cerrada la hace caer; al abrirla amanece.
        if (nocheConfig) {
            nocheOla.activa = !!estado.pinzaCerrada;
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
        kandinskyProgreso = 0;
        objetivoKandinsky = 0;
        kandinskyFase = 0;
        kandinskyExtrasAcum = 0;
        circulosKandinsky.length = 0;
        explosion = 0;
        objetivoExplosion = 0;
        destelloExplosion = 0;
        faseExplosion = 0;
        piezasExplosion = null;
        fuegosExplosion.length = 0;
        fuegosExplosionAcum = 0;
        cromaFase = 0;
        cromaCooldown = 0;
        cromaOscuridad = 0;
        ondasCromaticas.length = 0;
        particulasCroma.length = 0;
        circulosCroma.length = 0;
        circulosCromaAcum = 0;
        piezasPinza.length = 0;
        piezasPinzaAcum = 0;
        destellosPinza.length = 0;
        pinzaEstabaCerrada = false;
        pinzaFase = 0;

        // Mar de La gran ola: configuración y pizarras limpias.
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
        tormentaOla.nivel = 0;
        tormentaOla.activa = false;
        tormentaOla.acumulador = 0;
        tormentaOla.fase = 0;
        tormentaOla.destello = 0;
        tormentaOla.proximoRayo = 0;
        gotasOla.length = 0;
        salpicadurasOla.length = 0;
        rayosOla.length = 0;
        corrienteOla.nivel = 0;
        corrienteOla.activa = false;
        corrienteOla.acumulador = 0;
        corrienteOla.fase = 0;
        corrienteEspumaOla.length = 0;
        nocheConfig = null;
        nocheOla.nivel = 0;
        nocheOla.activa = false;
        nocheOla.fase = 0;
        estrellasOla = [];
        astroConfig = null;
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
