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

    if (pantallaActual === "galeria") {
        iniciarRegreso(evento);
        return;
    }

    if (pantallaActual !== "inicio") return;
    if (!estadoPuño.armado || estadoPuño.temporizador !== null) return;
    if (performance.now() < estadoPuño.enfriadoHasta) return;

    // Se desarma hasta que la mano se abra: el mismo puño no puede
    // disparar la transición dos veces.
    estadoPuño.armado = false;
    mostrarCarga("Gesto reconocido · abriendo la galería");

    estadoPuño.temporizador = window.setTimeout(() => {
        estadoPuño.temporizador = null;
        estadoPuño.enfriadoHasta = performance.now() + PUÑO.enfriamientoMs;
        ocultarCarga();
        transicionHacia("galeria");
    }, PUÑO.cargaMs);
}

// --- Regreso desde la galería: pulgar arriba -----------------------------

function iniciarRegreso(evento) {
    if (regreso.activo || regreso.listo) return;
    if (performance.now() < estadoPuño.enfriadoHasta) return;

    regreso.activo = true;
    regreso.handId = evento.handId;
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

    if (nodos.cargaTexto) nodos.cargaTexto.textContent = "Gesto reconocido · volviendo al inicio";
    pintarProgreso(1);

    // El mismo puño no puede volver a disparar nada hasta abrir la mano.
    estadoPuño.armado = false;
    estadoPuño.enfriadoHasta = performance.now() + PUÑO.enfriamientoMs;

    window.setTimeout(() => {
        detenerRegreso();
        transicionHacia("inicio").then(() => {
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

    if (nodos.estado) nodos.estado.textContent = ESTADO_INICIAL;
}

iniciar();
