// Lógica de la experiencia de Pinceladas de Vida.
//
// Conecta la obra elegida en la galería con el motor visual (js/artwork.js)
// y con el reconocimiento de gestos existente (js/gestures.js): al abrir una
// pintura monta el lienzo, aloja la cámara en el recuadro del pie y alimenta
// al motor con el estado de las manos en cada frame.
//
// Interacciones (se suman por etapas):
//   - point (índice extendido): activa el molino de los remolinos.
//
// No se crea ningún sistema de detección nuevo: se consumen los globales
// `hands` y `Gestures`. La navegación sigue siendo de ui.js.
//
// Interfaz publicada: el global `Gamelogic` con:
//   - abrir(id): inicia la experiencia con la obra del catálogo indicada.
//     Devuelve true si la obra tiene imagen y la experiencia arrancó.
//   - salir(): cierra la experiencia y vuelve a la galería.

const Gamelogic = (function () {
    "use strict";

    // Distancia máxima (en unidades de frame) para emparejar una mano con
    // su snapshot de gesto: el mismo criterio que usa ui.js.
    const UMBRAL_EMPAREJAMIENTO = 0.12;

    let obraActiva = null;
    let bucleActivo = false;

    const nodoEstado = document.getElementById("estadoExperiencia");
    let ultimoTextoEstado = "";

    function obtenerObra(id) {
        if (typeof CatalogoObras === "undefined") return null;
        for (const obra of CatalogoObras) {
            if (obra.id === id) return obra;
        }
        return null;
    }

    function abrir(id) {
        const obra = obtenerObra(id);

        if (!obra || !obra.archivo) return false;
        if (typeof Artwork === "undefined") {
            console.error("El motor visual (Artwork) no está disponible.");
            return false;
        }
        if (typeof transicionHacia !== "function") return false;

        obraActiva = obra;

        // El audio se habilita dentro del gesto de clic (política de
        // autoplay): se crea/reanuda el contexto ahora y la música arranca
        // recién cuando la pantalla está lista.
        if (typeof Musica !== "undefined") Musica.preparar();

        // Primero se muestra la pantalla para que el contenedor tenga
        // medidas reales; recién después se monta y carga el lienzo.
        transicionHacia("experiencia").then(() => {
            if (obraActiva !== obra) return; // la selección cambió mientras tanto
            if (typeof Musica !== "undefined") Musica.iniciar();
            alojarCamara();
            mostrarDatosObra(obra);
            Artwork.montar(document.getElementById("contenedorLienzo"));
            Artwork.cargar(obra);
            arrancarBucle();
        });

        return true;
    }

    function salir() {
        obraActiva = null;
        if (typeof Musica !== "undefined") Musica.detener();
        detenerBucle();
        restaurarCamara();
        if (typeof Artwork !== "undefined") Artwork.destruir();
        if (typeof transicionHacia === "function") transicionHacia("galeria");
    }

    // --- Bucle de entrada --------------------------------------------------

    function arrancarBucle() {
        if (bucleActivo) return;
        bucleActivo = true;
        paso();
    }

    function detenerBucle() {
        bucleActivo = false;
    }

    function paso() {
        if (!bucleActivo) return;

        if (typeof Artwork !== "undefined" && typeof Artwork.actualizar === "function") {
            const estado = estadoManos();
            Artwork.actualizar(estado);
            actualizarEstado(estado);
        }

        window.requestAnimationFrame(paso);
    }

    // --- Lectura de manos y gestos ----------------------------------------

    // Devuelve el estado por frame: cuántas manos hay, sus posturas, la
    // posición de cada palma sobre la pintura (normalizada) y si alguna
    // mantiene el índice extendido.
    function estadoManos() {
        const estado = { molino: false, paz: false, manos: 0, posturas: [], palmas: [] };

        if (typeof hands === "undefined" || !Array.isArray(hands)) return estado;
        if (typeof video === "undefined" || !video || !video.width) return estado;
        if (typeof Gestures === "undefined" || typeof Gestures.snapshots !== "function") return estado;
        if (typeof Artwork === "undefined" || typeof Artwork.dimensiones !== "function") return estado;

        const dimensiones = Artwork.dimensiones();
        if (!dimensiones) return estado; // la imagen todavía no cargó

        const anchoVideo = video.width;
        const altoVideo = video.height;
        const unidad = Math.max(anchoVideo, altoVideo);
        const anchoPantalla = window.innerWidth;
        const altoPantalla = window.innerHeight;

        // Ajuste "cover" de la cámara (el mismo cálculo que handpose.js).
        const escalaVideo = Math.max(anchoPantalla / anchoVideo, altoPantalla / altoVideo);
        const offsetVideoX = (anchoPantalla - anchoVideo * escalaVideo) / 2;
        const offsetVideoY = (altoPantalla - altoVideo * escalaVideo) / 2;

        // Ajuste "contain" de la pintura (el mismo cálculo que el motor).
        const fit = Math.min(anchoPantalla / dimensiones.ancho, altoPantalla / dimensiones.alto);
        const anchoDibujo = dimensiones.ancho * fit;
        const altoDibujo = dimensiones.alto * fit;
        const offsetPinturaX = (anchoPantalla - anchoDibujo) / 2;
        const offsetPinturaY = (altoPantalla - altoDibujo) / 2;

        const convertir = function (videoX, videoY) {
            const pantallaX = offsetVideoX + videoX * escalaVideo;
            const pantallaY = offsetVideoY + videoY * escalaVideo;
            return {
                x: (pantallaX - offsetPinturaX) / anchoDibujo,
                y: (pantallaY - offsetPinturaY) / altoDibujo,
            };
        };

        const snapshots = Gestures.snapshots();
        const usados = new Array(snapshots.length).fill(false);

        for (const mano of hands) {
            if (!mano || !Array.isArray(mano.keypoints) || mano.keypoints.length < 21) continue;

            const snapshot = emparejar(mano, snapshots, usados, unidad);
            let posture = snapshot ? snapshot.posture : null;

            // Respaldos (puentes de interfaz, no un segundo reconocedor):
            // se mide directo de los keypoints cuando Gestures no clasificó
            // (o leyó "point" con la mano en otra forma):
            // - índice + medio extendidos -> peace
            // - índice único extendido -> point
            // - tres o más dedos extendidos -> open_palm
            if (posture === null || posture === "point") {
                if (pazExtendida(mano)) {
                    posture = "peace";
                } else if (posture === null && indiceExtendido(mano)) {
                    posture = "point";
                } else if (palmaAbierta(mano)) {
                    posture = "open_palm";
                }
            }

            // Centro de la palma en coordenadas normalizadas de la pintura.
            const ids = [0, 5, 9, 13, 17];
            let sumaX = 0;
            let sumaY = 0;
            for (const indice of ids) {
                sumaX += mano.keypoints[indice].x;
                sumaY += mano.keypoints[indice].y;
            }
            const palma = convertir(sumaX / ids.length, sumaY / ids.length);

            estado.manos += 1;
            estado.posturas.push(posture);
            estado.palmas.push({ x: palma.x, y: palma.y, posture });

            if (posture === "point") estado.molino = true;
            if (posture === "peace") estado.paz = true;
        }

        return estado;
    }

    // Respaldo del índice extendido (puente de interfaz, no un segundo
    // reconocedor): con el modelo lite el ángulo del índice a veces no
    // supera los umbrales estrictos de gestures.js. Solo actúa cuando no
    // hay clasificación y exige que el índice sea el ÚNICO dedo extendido.
    function indiceExtendido(mano) {
        const keypoints = mano.keypoints;
        const dedos = [
            { mcp: 5, pip: 6, tip: 8 },
            { mcp: 9, pip: 10, tip: 12 },
            { mcp: 13, pip: 14, tip: 16 },
            { mcp: 17, pip: 18, tip: 20 },
        ];

        let extendidos = 0;
        let esIndice = false;

        for (let i = 0; i < dedos.length; i += 1) {
            const dedo = dedos[i];
            const base = Math.hypot(
                keypoints[dedo.pip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.pip].y - keypoints[dedo.mcp].y
            );
            if (base < 1e-6) continue;
            const largo = Math.hypot(
                keypoints[dedo.tip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.tip].y - keypoints[dedo.mcp].y
            );
            if (largo / base >= 1.55) {
                extendidos += 1;
                if (i === 0) esIndice = true;
            }
        }

        return extendidos === 1 && esIndice;
    }

    // Respaldo de palma abierta: gestures.js la exige con los cuatro dedos
    // muy estirados; con el modelo lite eso falla a menudo. Solo actúa
    // cuando no hay una clasificación clara (nunca pisa un puño o una pinza).
    function palmaAbierta(mano) {
        const keypoints = mano.keypoints;
        const dedos = [
            { mcp: 5, pip: 6, tip: 8 },
            { mcp: 9, pip: 10, tip: 12 },
            { mcp: 13, pip: 14, tip: 16 },
            { mcp: 17, pip: 18, tip: 20 },
        ];

        let extendidos = 0;

        for (const dedo of dedos) {
            const base = Math.hypot(
                keypoints[dedo.pip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.pip].y - keypoints[dedo.mcp].y
            );
            if (base < 1e-6) continue;
            const largo = Math.hypot(
                keypoints[dedo.tip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.tip].y - keypoints[dedo.mcp].y
            );
            if (largo / base >= 1.55) extendidos += 1;
        }

        return extendidos >= 3;
    }

    // Respaldo de la paz: índice y medio extendidos, los otros flexionados.
    function pazExtendida(mano) {
        const keypoints = mano.keypoints;
        const dedos = [
            { mcp: 5, pip: 6, tip: 8, nombre: "indice" },
            { mcp: 9, pip: 10, tip: 12, nombre: "medio" },
            { mcp: 13, pip: 14, tip: 16, nombre: "anular" },
            { mcp: 17, pip: 18, tip: 20, nombre: "menique" },
        ];

        let indice = false;
        let medio = false;
        let otros = false;

        for (const dedo of dedos) {
            const base = Math.hypot(
                keypoints[dedo.pip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.pip].y - keypoints[dedo.mcp].y
            );
            if (base < 1e-6) continue;
            const largo = Math.hypot(
                keypoints[dedo.tip].x - keypoints[dedo.mcp].x,
                keypoints[dedo.tip].y - keypoints[dedo.mcp].y
            );
            const extendido = largo / base >= 1.5;
            if (dedo.nombre === "indice") indice = extendido;
            else if (dedo.nombre === "medio") medio = extendido;
            else if (extendido) otros = true;
        }

        return indice && medio && !otros;
    }

    // Empareja una mano con su snapshot por la posición del ancla (uno a
    // uno): así cada mano queda asociada a su propio gesto.
    function emparejar(mano, snapshots, usados, unidad) {
        let mejor = null;
        let menor = Infinity;
        let indiceMejor = -1;

        for (let i = 0; i < snapshots.length; i++) {
            if (usados[i]) continue;
            const dx = mano.anchorX / unidad - snapshots[i].position.x;
            const dy = mano.anchorY / unidad - snapshots[i].position.y;
            const d = Math.hypot(dx, dy);
            if (d < menor) {
                menor = d;
                mejor = snapshots[i];
                indiceMejor = i;
            }
        }

        if (indiceMejor !== -1 && menor <= UMBRAL_EMPAREJAMIENTO) {
            usados[indiceMejor] = true;
            return mejor;
        }
        return null;
    }

    // --- Estado visible ----------------------------------------------------

    function actualizarEstado(estado) {
        if (!nodoEstado) return;

        let texto;
        if (estado.manos === 0) {
            const molino =
                typeof Artwork !== "undefined" && typeof Artwork.estadoMolino === "function"
                    ? Artwork.estadoMolino()
                    : null;
            texto =
                molino && molino.desenrollando
                    ? "Sin manos · volviendo a la forma original"
                    : "Sin manos en cámara";
        } else if (estado.molino) {
            texto = "Índice · molino girando";
        } else if (estado.posturas.indexOf("open_palm") !== -1) {
            texto = "Palma · explosión";
        } else if (estado.posturas.indexOf("fist") !== -1) {
            texto = "Puño · cargando partículas";
        } else if (estado.paz) {
            texto = "Paz · lluvia de meteoritos";
        } else if (
            typeof Artwork !== "undefined" &&
            typeof Artwork.estadoMolino === "function"
        ) {
            const molino = Artwork.estadoMolino();
            if (molino.girando) {
                texto = "Molino · girando por inercia";
            } else if (molino.desenrollando) {
                texto = "Molino · volviendo a la forma original";
            } else {
                const postura = estado.posturas[0] || "sin gesto";
                texto = `${postura} · índice extendido = girar`;
            }
        } else {
            texto = "Índice extendido = girar el remolino";
        }

        if (texto !== ultimoTextoEstado) {
            ultimoTextoEstado = texto;
            nodoEstado.textContent = texto;
        }
    }

    // --- Cámara y datos de la obra ----------------------------------------

    // Rellena la cabecera de la experiencia con los datos de la obra.
    function mostrarDatosObra(obra) {
        const titulo = document.getElementById("tituloObra");
        const autor = document.getElementById("obraAutor");
        const anio = document.getElementById("obraAnio");
        if (titulo) titulo.textContent = obra.titulo;
        if (autor) autor.textContent = obra.autor;
        if (anio) anio.textContent = String(obra.anio);
    }

    // Aloja el canvas de cámara de handpose.js dentro del recuadro del pie.
    // Ojo: p5 agrega ese canvas dentro del <main> de la bienvenida (que queda
    // oculto en otras pantallas), así que se lo busca en todo el documento y
    // se lo distingue del lienzo de la pintura por la clase lienzo-pintura.
    function alojarCamara() {
        const caja = document.querySelector(".caja-camara");
        const camara = document.querySelector("canvas.p5Canvas:not(.lienzo-pintura)");
        if (caja && camara) caja.appendChild(camara);
    }

    // Devuelve el canvas de cámara al cuerpo (pantalla completa de siempre).
    function restaurarCamara() {
        const camara = document.querySelector(".caja-camara canvas.p5Canvas");
        if (camara && document.body) document.body.appendChild(camara);
    }

    function conectarControles() {
        const botonSalir = document.getElementById("btnSalir");
        if (botonSalir) botonSalir.addEventListener("click", salir);
    }

    conectarControles();

    return { abrir, salir };
})();
