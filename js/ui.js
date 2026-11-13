// Interfaz de Pinceladas de Vida: bienvenida, galería y navegación.
//
// La navegación y la construcción de la galería son responsabilidad de este
// archivo. Se consumen las interfaces que publican otros módulos: el
// catálogo `CatalogoObras` (js/obras.js), la lógica de experiencia
// `Gamelogic` (js/gamelogic.js) y el global `Gestures` (js/gestures.js)
// para los gestos. No se modifica ni se reimplementa ninguno de ellos.

// --- Obras --------------------------------------------------------------

// La colección vive en js/obras.js (misma estructura de siempre, ahora con
// rutas de imagen y, más adelante, zonas interactivas). La galería sigue
// consumiendo el mismo contrato, sin duplicar los datos.
const OBRAS = (typeof CatalogoObras !== "undefined" && Array.isArray(CatalogoObras))
    ? CatalogoObras
    : [];

// --- Configuración del gesto --------------------------------------------

const PUÑO = {
    // Gesto real que publica js/gestures.js para el puño cerrado.
    gesto: "fist",
    // Tiempo que hay que mantener el puño antes de entrar.
    cargaMs: 900,
    // Espera obligatoria antes de aceptar otro puño.
    enfriamientoMs: 2200,
};

const TEXTO_SIN_GESTOS = "Usá el botón para entrar";
const ESTADO_INICIAL = "Elegí una obra para comenzar.";

// --- Estado -------------------------------------------------------------

let pantallaActual = "inicio";
let transicionando = false;

const estadoPuño = {
    armado: true,
    temporizador: null,
    enfriadoHasta: 0,
};

const nodos = {
    pantallas: Array.from(document.querySelectorAll(".pantalla")),
    collage: document.getElementById("obrasFlotantes"),
    piezas: document.getElementById("contenedorObras"),
    estado: document.getElementById("estadoObra"),
    carga: document.getElementById("cargaPuño"),
    cargaTexto: document.querySelector("#cargaPuño .carga-texto"),
    anillo: document.querySelector("#cargaPuño .anillo circle"),
    transicion: document.getElementById("transicion"),
    pista: document.querySelector(".pista"),
    particulas: document.getElementById("particulas"),
    escena: document.querySelector(".escena--inicio"),
    avisoSalida: document.getElementById("avisoSalida"),
    avisoTitulo: document.getElementById("avisoSalidaTitulo"),
    avisoDestino: document.getElementById("avisoSalidaDestino"),
    avisoProgreso: document.querySelector("#avisoSalida .aviso-salida__progreso"),
    salidaChips: Array.from(document.querySelectorAll(".pose--salida")),
};

// --- Utilidades ---------------------------------------------------------

function esperar(ms) {
    return new Promise((resolver) => window.setTimeout(resolver, ms));
}

function movimientoReducido() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// --- Navegación ---------------------------------------------------------

function mostrarPantalla(id) {
    for (const pantalla of nodos.pantallas) {
        const activa = pantalla.id === id;
        pantalla.classList.toggle("activa", activa);
        pantalla.setAttribute("aria-hidden", String(!activa));
    }

    pantallaActual = id;
    window.scrollTo(0, 0);
}

async function transicionHacia(destino) {
    if (transicionando || destino === pantallaActual) return;

    transicionando = true;

    if (nodos.transicion) {
        nodos.transicion.classList.add("activa");
        await esperar(movimientoReducido() ? 0 : 320);
    }

    mostrarPantalla(destino);

    if (nodos.transicion) {
        nodos.transicion.classList.remove("activa");
        await esperar(movimientoReducido() ? 0 : 340);
    }

    transicionando = false;
}

// --- Gestos -------------------------------------------------------------
//
// ENTRADA: puño cerrado en la bienvenida.
// REGRESO: pulgar arriba en la galería.
//
// js/gestures.js clasifica el puño mirando sólo los cuatro dedos largos, así
// que un pulgar arriba también entra como "fist" y no hay un gesto propio.
// Acá se refina ese puño con el pulgar usando los 21 keypoints que
// handpose.js ya publica en el global `hands` (el mismo contrato que consume
// gestures.js). No se modifica ni se reimplementa ninguno de los dos módulos:
// es un puente de interfaz, aislado en este bloque. Si gestures.js agrega un
// gesto "thumb_up", este bloque se borra y se usa ese dato.

const PULGAR = {
    // Distancia mínima punta-palma en tamaños de mano. gestures.js usa 0.95
    // para el pulgar abierto; acá se relaja un poco para no perder el gesto.
    alcance: 0.85,
    // Cuánto tiene que apuntar hacia arriba el eje muñeca → punta del pulgar.
    verticalidad: 0.5,
    // Tiempo que hay que sostener el pulgar arriba antes de volver.
    sostenidoMs: 700,
    intervaloMs: 50,
};

const regreso = {
    activo: false,
    handId: null,
    pantalla: null,
    intervalo: null,
    desde: null,
    listo: false,
};

function distancia(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroPalma(keypoints) {
    const ids = [0, 5, 9, 13, 17];
    let x = 0;
    let y = 0;

    for (const id of ids) {
        x += keypoints[id].x;
        y += keypoints[id].y;
    }

    return { x: x / ids.length, y: y / ids.length };
}

// Pulgar arriba: la mano ya está en puño (lo dice gestures.js) y el pulgar
// se separa de la palma apuntando hacia arriba en la imagen.
function pulgarArriba(mano) {
    if (!mano || !mano.keypoints || mano.keypoints.length < 21) return false;

    const keypoints = mano.keypoints;
    const muneca = keypoints[0];
    const punta = keypoints[4];
    const tamano = distancia(muneca, keypoints[9]);

    if (tamano <= 0) return false;
    if (distancia(punta, centroPalma(keypoints)) / tamano < PULGAR.alcance) return false;

    const dx = punta.x - muneca.x;
    const dy = punta.y - muneca.y;
    const largo = Math.hypot(dx, dy);

    if (largo <= 0) return false;

    // En pantalla la Y crece hacia abajo: -dy / largo es "hacia arriba".
    return -dy / largo >= PULGAR.verticalidad;
}

// Empareja el snapshot de gestures.js con su mano dentro de `hands`.
function manoDelSnapshot(snapshot) {
    if (typeof hands === "undefined" || !Array.isArray(hands) || hands.length === 0) return null;

    const unidad = (typeof video !== "undefined" && video && video.width > 0)
        ? Math.max(video.width, video.height)
        : 0;

    if (!unidad) return hands[snapshot.handIndex] || null;

    let mejor = null;
    let menor = Infinity;

    for (const candidata of hands) {
        const dx = candidata.anchorX / unidad - snapshot.position.x;
        const dy = candidata.anchorY / unidad - snapshot.position.y;
        const distanciaAncla = Math.hypot(dx, dy);

        if (distanciaAncla < menor) {
            menor = distanciaAncla;
            mejor = candidata;
        }
    }

    return menor <= 0.12 ? mejor : null;
}

function snapshotEnPuño() {
    if (typeof Gestures === "undefined" || typeof Gestures.snapshots !== "function") return null;

    for (const snapshot of Gestures.snapshots()) {
        if (snapshot.handId !== regreso.handId) continue;
        return snapshot.posture === PUÑO.gesto ? snapshot : null;
    }

    return null;
}

function pintarProgreso(progreso) {
    if (!nodos.anillo) return;
    const largo = 289;
    nodos.anillo.style.strokeDashoffset = String(largo * (1 - progreso));
}

// --- Confirmación visual -------------------------------------------------

function mostrarCarga(texto) {
    if (!nodos.carga) return;
    if (nodos.cargaTexto) nodos.cargaTexto.textContent = texto;
    nodos.carga.classList.remove("manual");
    if (nodos.anillo) nodos.anillo.style.strokeDashoffset = "";
    nodos.carga.classList.add("activo");
}

function ocultarCarga() {
    if (!nodos.carga) return;
    nodos.carga.classList.remove("activo", "manual");
    if (nodos.anillo) nodos.anillo.style.strokeDashoffset = "";
}

function cancelarCarga() {
    if (estadoPuño.temporizador === null) return;
    window.clearTimeout(estadoPuño.temporizador);
    estadoPuño.temporizador = null;
    ocultarCarga();
}

// --- Entrada desde la bienvenida ----------------------------------------

function alIniciarGesto(evento) {
    if (!evento || evento.gesture !== PUÑO.gesto) return;

    // Toda pantalla con "volver" usa el mismo regreso: pulgar arriba.
    if (REGRESOS[pantallaActual]) {
        iniciarRegreso(evento);
        return;
    }

    if (pantallaActual !== "inicio") return;
    if (!estadoPuño.armado || estadoPuño.temporizador !== null) return;
    if (performance.now() < estadoPuño.enfriadoHasta) return;

    // Un pulgar hacia abajo también clasifica como "fist" (gestures.js no
    // mira el pulgar): en la bienvenida no debe abrir la galería.
    if (esPulgarAbajo(evento)) return;

    // Se desarma hasta que la mano se abra: el mismo puño no puede
    // disparar la transición dos veces.
    estadoPuño.armado = false;
    mostrarCarga("Gesto reconocido · abriendo la galería");

    estadoPuño.temporizador = window.setTimeout(() => {
        estadoPuño.temporizador = null;
        estadoPuño.enfriadoHasta = performance.now() + PUÑO.enfriamientoMs;
        ocultarCarga();

        // Segunda comprobación, en el instante de entrar: si la mano terminó
        // siendo un pulgar hacia abajo, no se entra y hay que abrir la mano
        // para volver a armar el gesto.
        if (detectarPulgarAbajo()) {
            estadoPuño.armado = false;
            return;
        }

        transicionHacia("galeria");
    }, PUÑO.cargaMs);
}

// --- Regreso: pulgar arriba ---------------------------------------------
//
// El pulgar sostenido vuelve a la pantalla anterior desde cualquier pantalla
// que tenga "volver". La experiencia queda afuera a propósito: ahí no hay
// ningún gesto de regreso (la salida es el botón Salir) y un pulgar arriba
// natural mientras se sostiene una postura sobre la obra no puede sacarte de
// ella. La bienvenida tampoco tiene regreso: ahí el puño sigue siendo la
// entrada a la galería.

const REGRESOS = {
    galeria: {
        destino: "inicio",
        texto: "Gesto reconocido · volviendo al inicio",
    },
    instrucciones: {
        destino: "galeria",
        texto: "Gesto reconocido · volviendo a la galería",
    },
    finalizado: {
        destino: "galeria",
        texto: "Gesto reconocido · volviendo a la galería",
    },
};

function iniciarRegreso(evento) {
    if (regreso.activo || regreso.listo) return;
    if (performance.now() < estadoPuño.enfriadoHasta) return;

    regreso.activo = true;
    regreso.handId = evento.handId;
    regreso.pantalla = pantallaActual;
    regreso.desde = null;

    // El overlay recién aparece cuando el pulgar se muestra: un puño suelto
    // mientras se elige una obra no tiene que oscurecer la galería.
    regreso.intervalo = window.setInterval(pasoDeRegreso, PULGAR.intervaloMs);
}

function pasoDeRegreso() {
    if (!regreso.activo) return;

    const snapshot = snapshotEnPuño();
    if (!snapshot) {
        detenerRegreso();
        return;
    }

    const mano = manoDelSnapshot(snapshot);
    const ahora = performance.now();

    if (!mano || !pulgarArriba(mano)) {
        regreso.desde = null;
        if (nodos.carga && nodos.carga.classList.contains("activo")) ocultarCarga();
        return;
    }

    if (regreso.desde === null) {
        regreso.desde = ahora;
        if (nodos.cargaTexto) nodos.cargaTexto.textContent = "Sostené el pulgar para volver";
        if (nodos.carga) nodos.carga.classList.add("activo", "manual");
        pintarProgreso(0);
    }

    const progreso = Math.min(1, (ahora - regreso.desde) / PULGAR.sostenidoMs);
    pintarProgreso(progreso);

    if (progreso >= 1) completarRegreso();
}

function completarRegreso() {
    if (regreso.listo) return;
    regreso.listo = true;

    const objetivo = REGRESOS[regreso.pantalla] || null;

    if (nodos.cargaTexto) {
        nodos.cargaTexto.textContent = objetivo
            ? objetivo.texto
            : "Gesto reconocido · volviendo";
    }
    pintarProgreso(1);

    // El mismo puño no puede volver a disparar nada hasta abrir la mano.
    estadoPuño.armado = false;
    estadoPuño.enfriadoHasta = performance.now() + PUÑO.enfriamientoMs;

    window.setTimeout(() => {
        detenerRegreso();
        transicionHacia((objetivo && objetivo.destino) || "inicio").then(() => {
            regreso.listo = false;
        });
    }, 420);
}

function detenerRegreso() {
    if (regreso.intervalo !== null) {
        window.clearInterval(regreso.intervalo);
        regreso.intervalo = null;
    }

    regreso.activo = false;
    regreso.handId = null;
    regreso.pantalla = null;
    regreso.desde = null;
    ocultarCarga();
}

function alTerminarGesto(evento) {
    if (!evento || evento.gesture !== PUÑO.gesto) return;

    // Si la mano se abre antes de completar, se cancela.
    detenerRegreso();
    cancelarCarga();
    estadoPuño.armado = true;
}

function conectarGestos() {
    if (typeof Gestures === "undefined" || typeof Gestures.on !== "function") {
        // Sin reconocimiento de gestos la navegación por botón sigue
        // funcionando: la experiencia nunca queda bloqueada.
        if (nodos.pista) nodos.pista.textContent = TEXTO_SIN_GESTOS;
        return;
    }

    Gestures.on("gesturestart", alIniciarGesto);
    Gestures.on("gestureend", alTerminarGesto);
}

// --- Salida global: pulgar hacia abajo ----------------------------------
//
// El pulgar hacia abajo es el gesto universal de regreso. Es el espejo del
// pulgar arriba que ya vive en este archivo: gestures.js no lo clasifica
// (un 👎 entra como "fist", porque sólo mira los cuatro dedos largos), así
// que se resuelve acá sobre los 21 keypoints reales de handpose.js, sin
// eventos inventados.
//
// Geometría: el pulgar está desplegado cuando su punta se aleja de la palma
// (alcance) y apunta hacia abajo cuando el eje muñeca→punta tiene dy
// positivo. Los umbrales son excluyentes con los del pulgar arriba
// (ui.js:170), así que una mano nunca puede ser las dos cosas.
//
// A diferencia del pulgar arriba, este gesto NO usa el overlay compartido
// #cargaPuño: tiene su propio aviso (#avisoSalida). Así los dos flujos no
// se pisan si el reconocedor los solapa.

const SALIDA = {
    // Mismo criterio que PULGAR: pulgar desplegado, no recogido en el puño.
    alcance: 0.85,
    // Cuánto tiene que apuntar hacia abajo el eje muñeca → punta del pulgar.
    verticalidad: 0.5,
    // Tiempo que hay que sostener el gesto antes de ejecutar la salida.
    sostenidoMs: 900,
    // Tolerancia a un parpadeo del modelo: no corta el gesto acumulado.
    graciaMs: 160,
    // Latido de la comprobación por frame.
    intervaloMs: 50,
    // Espera obligatoria entre una salida ejecutada y la siguiente.
    enfriamientoMs: 2200,
    // Cuánto se deja ver el aviso antes de navegar.
    avisoMs: 420,
    // Margen para liberar el bloqueo tras salir de la experiencia (su
    // transición no devuelve promesa: la maneja Gamelogic).
    liberacionMs: 1400,
};

// Único destino de regreso por pantalla. La experiencia se resuelve aparte
// con Gamelogic.salir(); "inicio" no tiene anterior y no aparece acá.
const DESTINOS_SALIDA = {
    galeria: "inicio",
    instrucciones: "galeria",
    finalizado: "galeria",
};

const salida = {
    desde: null,
    handId: null,
    ultimoValido: 0,
    listo: false,
    bloqueadoHasta: 0,
    // Tras ejecutar, la misma mano tiene que abandonar el gesto antes de
    // poder disparar otra vez: una detección = un único regreso.
    esperandoNeutral: false,
};

function pulgarAbajo(mano) {
    if (!mano || !mano.keypoints || mano.keypoints.length < 21) return false;

    const keypoints = mano.keypoints;
    const muneca = keypoints[0];
    const punta = keypoints[4];
    const tamano = distancia(muneca, keypoints[9]);

    if (tamano <= 0) return false;
    if (distancia(punta, centroPalma(keypoints)) / tamano < SALIDA.alcance) return false;

    const dx = punta.x - muneca.x;
    const dy = punta.y - muneca.y;
    const largo = Math.hypot(dx, dy);

    if (largo <= 0) return false;

    // En pantalla la Y crece hacia abajo: +dy / largo es "hacia abajo".
    return dy / largo >= SALIDA.verticalidad;
}

// Mano viva del evento: `hands` la actualiza handpose.js en cada frame. No
// se usa Gestures.snapshots() acá porque gesturestart se emite DENTRO de
// Gestures.update, antes de que los snapshots del frame queden publicados.
function manoDelEvento(evento) {
    if (typeof hands === "undefined" || !Array.isArray(hands) || hands.length === 0) return null;
    if (evento && typeof evento.handIndex === "number" && hands[evento.handIndex]) {
        return hands[evento.handIndex];
    }
    return manoDelSnapshot(evento);
}

// El evento ya garantiza que la postura es un puño, así que acá sólo hace
// falta medir hacia dónde apunta el pulgar.
function esPulgarAbajo(evento) {
    const mano = manoDelEvento(evento);
    return mano ? pulgarAbajo(mano) : false;
}

// Busca, entre los puños estables que publica gestures.js, uno que además
// tenga el pulgar apuntando hacia abajo. Devuelve su identidad para poder
// atar el rearme a la misma mano.
function detectarPulgarAbajo() {
    if (typeof Gestures === "undefined" || typeof Gestures.snapshots !== "function") return null;

    for (const snapshot of Gestures.snapshots()) {
        if (snapshot.posture !== PUÑO.gesto) continue;
        const mano = manoDelSnapshot(snapshot);
        if (!mano || !pulgarAbajo(mano)) continue;
        return { handId: snapshot.handId, mano };
    }

    return null;
}

// Qué debe hacer el gesto en la pantalla activa, o null si no hay anterior.
function accionDeSalida() {
    if (pantallaActual === "experiencia") {
        return { experiencia: true, destino: "galeria" };
    }
    const destino = DESTINOS_SALIDA[pantallaActual];
    return destino ? { experiencia: false, destino } : null;
}

function pintarProgresoSalida(progreso) {
    if (!nodos.avisoProgreso) return;
    const largo = 289;
    nodos.avisoProgreso.style.strokeDashoffset = String(largo * (1 - progreso));
}

function mostrarAvisoSalida(accion) {
    // El indicador de todos los pies se enciende con el mismo criterio, así
    // la respuesta visual es la misma en cualquier pantalla.
    for (const chip of nodos.salidaChips) chip.classList.add("activa");

    if (!nodos.avisoSalida) return;
    if (nodos.avisoTitulo) {
        nodos.avisoTitulo.textContent = accion.experiencia ? "Saliendo" : "Regresando";
    }
    if (nodos.avisoDestino) {
        nodos.avisoDestino.textContent = accion.experiencia
            ? "De la obra"
            : accion.destino === "inicio"
                ? "Al inicio"
                : "A la galería";
    }
    nodos.avisoSalida.classList.add("activo");
}

function ocultarAvisoSalida() {
    for (const chip of nodos.salidaChips) chip.classList.remove("activa");
    if (nodos.avisoSalida) nodos.avisoSalida.classList.remove("activo");
    pintarProgresoSalida(0);
}

function cancelarSalida() {
    salida.desde = null;
    salida.handId = null;
    if (nodos.avisoSalida && nodos.avisoSalida.classList.contains("activo")) {
        ocultarAvisoSalida();
    }
}

function completarSalida(accion) {
    if (salida.listo) return;
    salida.listo = true;
    salida.esperandoNeutral = true;
    salida.bloqueadoHasta = performance.now() + SALIDA.enfriamientoMs;
    pintarProgresoSalida(1);

    window.setTimeout(() => {
        ocultarAvisoSalida();
        salida.desde = null;
        salida.handId = null;

        if (accion.experiencia) {
            // Camino único y correcto para salir de la obra: destruye el
            // lienzo, devuelve la cámara, corta la música y transiciona.
            if (typeof Gamelogic !== "undefined" && typeof Gamelogic.salir === "function") {
                Gamelogic.salir();
            }
            window.setTimeout(() => {
                salida.listo = false;
            }, SALIDA.liberacionMs);
            return;
        }

        transicionHacia(accion.destino).then(() => {
            salida.listo = false;
        });
    }, SALIDA.avisoMs);
}

function pasoSalida() {
    const ahora = performance.now();
    const deteccion = detectarPulgarAbajo();

    // Rearme: hace falta que la mano abandone el gesto (postura neutral)
    // para que el mismo gesto pueda volver a dispararse.
    if (!deteccion) salida.esperandoNeutral = false;

    // Una transición en curso o una salida ya ejecutada no se repiten.
    if (transicionando || salida.listo) {
        cancelarSalida();
        return;
    }

    const accion = accionDeSalida();
    if (!accion) {
        // Bienvenida: no hay pantalla anterior. El gesto se consume en
        // silencio; el puño de entrada está protegido en alIniciarGesto.
        cancelarSalida();
        return;
    }

    if (ahora < salida.bloqueadoHasta) {
        // Cooldown: el detector sigue vivo, la acción no.
        cancelarSalida();
        return;
    }

    if (!deteccion) {
        // Si el gesto ya venía acumulando, se le da un margen corto para
        // sobrevivir a un frame perdido del modelo.
        if (salida.desde !== null && ahora - salida.ultimoValido > SALIDA.graciaMs) {
            cancelarSalida();
        }
        return;
    }

    if (salida.esperandoNeutral) {
        cancelarSalida();
        return;
    }

    salida.ultimoValido = ahora;

    if (salida.desde === null || salida.handId !== deteccion.handId) {
        salida.desde = ahora;
        salida.handId = deteccion.handId;
        mostrarAvisoSalida(accion);
        pintarProgresoSalida(0);
    }

    const progreso = Math.min(1, (ahora - salida.desde) / SALIDA.sostenidoMs);
    pintarProgresoSalida(progreso);

    if (progreso >= 1) completarSalida(accion);
}

function cicloSalida() {
    pasoSalida();
    window.requestAnimationFrame(cicloSalida);
}

function iniciarSalida() {
    window.requestAnimationFrame(cicloSalida);
}

// --- Puntero con el meñique ---------------------------------------------
//
// En la galería el meñique extendido (con índice, medio y anular recogidos)
// funciona como puntero: la punta del meñique mueve un cursor por la pantalla
// y resalta la tarjeta que queda debajo. Al recogerlo rápido sobre una tarjeta
// —como si le picaras con la punta— se elige esa obra y se abre su
// experiencia.
//
// Se apoya sólo en lo que ya publican los otros módulos: `hands` con los 21
// keypoints (handpose.js) y el encuadre `view` con el que se dibuja la cámara.
// Ninguno de esos archivos se modifica.

const PUNTERO = {
    // Cuánto tiene que sobresalir la punta del dedo respecto de su nudillo.
    extension: 1.12,
    // Ventana para que el retroceso cuente como pique y no como bajar la mano.
    piqueMs: 380,
    // Cuánto tiene que retroceder el meñique, en tamaños de mano.
    retroceso: 0.14,
    // Frames seguidos con el meñique recogido antes de confirmar el pique.
    framesPique: 2,
    // Espera entre piques para no abrir dos obras seguidas.
    enfriamientoMs: 700,
};

const puntero = {
    activo: false,
    visible: false,
    x: 0,
    y: 0,
    tarjeta: null,
    alcanzado: 0,
    recogido: 0,
    ultimoMs: 0,
    bloqueadoHasta: 0,
    nodo: null,
    estilo: null,
};

function crearCursorPuntero() {
    if (puntero.nodo) return puntero.nodo;

    if (!puntero.estilo) {
        // Mismo realce que el hover del mouse, pero para el puntero de mano.
        puntero.estilo = document.createElement("style");
        puntero.estilo.textContent =
            ".pieza.bajo-puntero .marco {" +
            "transform: translateY(-7px) scale(1.012);" +
            "border-color: rgba(242, 233, 216, 0.55);" +
            "box-shadow: 0 34px 64px rgba(0, 0, 0, 0.6);" +
            "}";
        document.head.append(puntero.estilo);
    }

    const nodo = document.createElement("div");
    nodo.setAttribute("aria-hidden", "true");
    nodo.style.cssText = [
        "position: fixed",
        "left: 0",
        "top: 0",
        "width: 30px",
        "height: 30px",
        "margin: -15px 0 0 -15px",
        "border: 1px solid rgba(198, 107, 78, 0.95)",
        "border-radius: 50%",
        "box-shadow: 0 0 18px rgba(198, 107, 78, 0.35)",
        "pointer-events: none",
        "z-index: 7",
        "display: none",
        "transition: transform 70ms linear",
    ].join(";");
    document.body.append(nodo);
    puntero.nodo = nodo;

    return nodo;
}

function medidasVideo() {
    if (typeof video === "undefined" || !video) return null;

    const elemento = video.elt || video;
    const ancho = elemento.videoWidth || elemento.width || video.width || 0;
    const alto = elemento.videoHeight || elemento.height || video.height || 0;

    if (!ancho || !alto) return null;

    return { ancho, alto };
}

// Encuadre "cover" del video sobre la ventana: el mismo que usa handpose.js
// para dibujar la cámara y los keypoints.
function encuadreCamara() {
    const medidas = medidasVideo();
    if (!medidas) return null;

    const escala = Math.max(
        window.innerWidth / medidas.ancho,
        window.innerHeight / medidas.alto
    );

    return {
        scale: escala,
        offsetX: (window.innerWidth - medidas.ancho * escala) / 2,
        offsetY: (window.innerHeight - medidas.alto * escala) / 2,
    };
}

// Misma proyección que usa handpose.js para dibujar encima de la cámara.
function puntoEnPantalla(keypoint) {
    const encuadre = encuadreCamara();
    if (!encuadre) return null;

    return {
        x: encuadre.offsetX + keypoint.x * encuadre.scale,
        y: encuadre.offsetY + keypoint.y * encuadre.scale,
    };
}

function tamanoMano(keypoints) {
    return Math.max(distancia(keypoints[0], keypoints[9]), 1e-6);
}

// Alcance del dedo en tamaños de mano: sirve para medir el retroceso del pique.
function alcanceDedo(keypoints, pip, tip) {
    return distancia(keypoints[tip], keypoints[0]) / tamanoMano(keypoints);
}

// Scale-free: el dedo está extendido si su punta queda claramente más lejos
// de la muñeca que su nudillo intermedio.
function dedoExtendido(keypoints, pip, tip) {
    return (
        distancia(keypoints[tip], keypoints[0]) >
        distancia(keypoints[pip], keypoints[0]) * PUNTERO.extension
    );
}

function posturaPuntero(keypoints) {
    if (!dedoExtendido(keypoints, 18, 20)) return false;
    if (dedoExtendido(keypoints, 6, 8)) return false;
    if (dedoExtendido(keypoints, 10, 12)) return false;
    if (dedoExtendido(keypoints, 14, 16)) return false;
    return true;
}

function tarjetaEnPunto(x, y) {
    if (!nodos.piezas) return null;

    const piezas = nodos.piezas.querySelectorAll(".pieza");

    // De atrás hacia adelante: las últimas del DOM quedan arriba.
    for (let i = piezas.length - 1; i >= 0; i -= 1) {
        const caja = piezas[i].getBoundingClientRect();
        if (x >= caja.left && x <= caja.right && y >= caja.top && y <= caja.bottom) {
            return piezas[i];
        }
    }

    return null;
}

function resaltarTarjeta(tarjeta) {
    if (puntero.tarjeta === tarjeta) return;
    if (puntero.tarjeta) puntero.tarjeta.classList.remove("bajo-puntero");
    puntero.tarjeta = tarjeta;
    if (tarjeta) tarjeta.classList.add("bajo-puntero");
}

function moverCursor(x, y) {
    const nodo = crearCursorPuntero();

    puntero.x = x;
    puntero.y = y;
    nodo.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;

    if (!puntero.visible) {
        nodo.style.display = "block";
        puntero.visible = true;
    }
}

function ocultarCursor() {
    if (puntero.nodo && puntero.visible) puntero.nodo.style.display = "none";
    puntero.visible = false;
}

function soltarPuntero() {
    resaltarTarjeta(null);
    ocultarCursor();
    puntero.activo = false;
    puntero.recogido = 0;
    puntero.alcanzado = 0;
}

function picarPuntero(ahora) {
    const tarjeta = puntero.tarjeta;

    puntero.bloqueadoHasta = ahora + PUNTERO.enfriamientoMs;
    soltarPuntero();

    if (tarjeta) tarjeta.click();
}

function pasoPuntero() {
    if (pantallaActual !== "galeria") {
        soltarPuntero();
        return;
    }

    const ahora = performance.now();
    if (transicionando || ahora < puntero.bloqueadoHasta) return;

    const mano =
        typeof hands !== "undefined" && Array.isArray(hands) && hands.length > 0
            ? hands[0]
            : null;

    if (!mano || !mano.keypoints || mano.keypoints.length < 21) {
        soltarPuntero();
        return;
    }

    const keypoints = mano.keypoints;
    const punta = puntoEnPantalla(keypoints[20]);

    if (!punta) {
        soltarPuntero();
        return;
    }

    if (!posturaPuntero(keypoints)) {
        // El meñique se recogió: si venía apuntando y lo hizo rápido sobre una
        // tarjeta, cuenta como pique.
        if (!puntero.activo) return;

        puntero.recogido += 1;

        const alcance = alcanceDedo(keypoints, 18, 20);
        const rapido = ahora - puntero.ultimoMs <= PUNTERO.piqueMs;
        const retrocede = puntero.alcanzado - alcance >= PUNTERO.retroceso;

        if (rapido && retrocede && puntero.recogido >= PUNTERO.framesPique) {
            if (puntero.tarjeta) picarPuntero(ahora);
            else soltarPuntero();
            return;
        }

        // Si tardó demasiado, fue bajar la mano y no un pique.
        if (!rapido) soltarPuntero();
        return;
    }

    puntero.activo = true;
    puntero.recogido = 0;
    puntero.ultimoMs = ahora;
    puntero.alcanzado = alcanceDedo(keypoints, 18, 20);

    moverCursor(punta.x, punta.y);
    resaltarTarjeta(tarjetaEnPunto(punta.x, punta.y));
}

function cicloPuntero() {
    pasoPuntero();
    window.requestAnimationFrame(cicloPuntero);
}

function iniciarPuntero() {
    crearCursorPuntero();
    window.requestAnimationFrame(cicloPuntero);
}

// --- Construcción de piezas ---------------------------------------------

function crearMarco(obra) {
    const marco = document.createElement("div");
    marco.className = `marco arte--${obra.tema}`;

    const grano = document.createElement("span");
    grano.className = "grano-marco";
    grano.setAttribute("aria-hidden", "true");
    marco.append(grano);

    if (obra.archivo) {
        const foto = document.createElement("img");
        foto.className = "foto";
        foto.alt = "";
        foto.hidden = true;
        foto.addEventListener("load", () => {
            foto.hidden = false;
            marco.classList.add("con-foto");
        });
        foto.src = obra.archivo;
        marco.append(foto);
    }

    return marco;
}

function crearFragmento(obra) {
    const fragmento = document.createElement("div");
    fragmento.className = "fragmento";
    fragmento.append(crearMarco(obra));
    return fragmento;
}

function crearPieza(obra) {
    const pieza = document.createElement("figure");
    pieza.className = "pieza";
    pieza.dataset.obra = obra.id;
    pieza.tabIndex = 0;
    pieza.setAttribute("role", "button");
    pieza.setAttribute("aria-label", `${obra.titulo}, de ${obra.autor}, ${obra.anio}`);

    const datos = document.createElement("figcaption");
    datos.className = "datos";

    const titulo = document.createElement("h3");
    titulo.textContent = obra.titulo;

    const autor = document.createElement("p");
    autor.className = "autor";
    autor.append(`${obra.autor} · `);

    const anio = document.createElement("span");
    anio.className = "anio";
    anio.textContent = String(obra.anio);
    autor.append(anio);

    datos.append(titulo, autor);
    pieza.append(crearMarco(obra), datos);

    pieza.addEventListener("click", () => seleccionarObra(obra, pieza));
    pieza.addEventListener("keydown", (evento) => {
        if (evento.key !== "Enter" && evento.key !== " ") return;
        evento.preventDefault();
        seleccionarObra(obra, pieza);
    });

    return pieza;
}

function seleccionarObra(obra, pieza) {
    if (nodos.piezas) {
        for (const otra of nodos.piezas.querySelectorAll(".pieza.seleccionada")) {
            if (otra !== pieza) otra.classList.remove("seleccionada");
        }
    }

    pieza.classList.add("seleccionada");

    // Si la experiencia está lista, la selección le pasa el control
    // (gamelogic.js decide si la obra tiene imagen para abrir).
    if (typeof Gamelogic !== "undefined" && Gamelogic.abrir(obra.id)) {
        return;
    }

    if (nodos.estado) {
        nodos.estado.textContent =
            `«${obra.titulo}» · ${obra.autor}. La imagen todavía no está disponible.`;
    }
}

function construir() {
    if (nodos.collage) {
        const fragmento = document.createDocumentFragment();
        for (const obra of OBRAS) fragmento.append(crearFragmento(obra));
        nodos.collage.append(fragmento);
    }

    if (nodos.piezas) {
        const fragmento = document.createDocumentFragment();
        for (const obra of OBRAS) fragmento.append(crearPieza(obra));
        nodos.piezas.append(fragmento);
    }
}

// --- Ambiente -----------------------------------------------------------

function crearParticulas() {
    if (!nodos.particulas || movimientoReducido()) return;

    const fragmento = document.createDocumentFragment();

    for (let indice = 0; indice < 18; indice += 1) {
        const particula = document.createElement("span");
        particula.className = "particula";
        particula.style.setProperty("--x", `${Math.random() * 100}%`);
        particula.style.setProperty("--y", `${Math.random() * 100}%`);
        particula.style.setProperty("--s", `${2 + Math.random() * 4}px`);
        particula.style.setProperty("--d", `${9 + Math.random() * 10}s`);
        particula.style.setProperty("--retraso", `${Math.random() * -16}s`);
        fragmento.append(particula);
    }

    nodos.particulas.append(fragmento);
}

function activarParallax() {
    if (!nodos.escena || movimientoReducido()) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    let pendiente = false;
    let x = 0;
    let y = 0;

    window.addEventListener("pointermove", (evento) => {
        x = evento.clientX / window.innerWidth - 0.5;
        y = evento.clientY / window.innerHeight - 0.5;

        if (pendiente) return;
        pendiente = true;

        window.requestAnimationFrame(() => {
            nodos.escena.style.setProperty("--px", x.toFixed(3));
            nodos.escena.style.setProperty("--py", y.toFixed(3));
            pendiente = false;
        });
    }, { passive: true });
}

// --- Botones ------------------------------------------------------------

function conectarBotones() {
    const enlaces = [
        ["btnEntrar", "galeria"],
        ["btnVolverInicio", "inicio"],
        ["btnVolverGaleria", "galeria"],
    ];

    for (const [id, destino] of enlaces) {
        const boton = document.getElementById(id);
        if (!boton) continue;
        boton.addEventListener("click", () => transicionHacia(destino));
    }
}

// --- Arranque -----------------------------------------------------------

function iniciar() {
    mostrarPantalla(pantallaActual);
    construir();
    crearParticulas();
    activarParallax();
    conectarBotones();
    conectarGestos();
    iniciarPuntero();
    iniciarSalida();

    if (nodos.estado) nodos.estado.textContent = ESTADO_INICIAL;
}

iniciar();
