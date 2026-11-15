// Lógica de la experiencia de Pinceladas de Vida.
//
// Conecta la obra elegida en la galería con el motor visual (js/artwork.js)
// y con el reconocimiento de gestos existente (js/gestures.js): al abrir una
// pintura monta el lienzo, aloja la cámara en el recuadro del pie y alimenta
// al motor con el estado de las manos en cada frame.
//
// Interacciones:
//   - point (índice extendido): activa el molino de los remolinos.
//   - peace (paz): dispara la lluvia de meteoritos.
//   - pinza: pinzaCerrada enciende el resplandor de los cuerpos celestes;
//     pinzaAbierta lo apaga. Sin manos no se informa ningún cambio.
//   - viento: la palma abierta en movimiento horizontal alimenta
//     vientoVelocidad; solo con la postura open_palm (la pinza, la paz y el
//     índice no la activan).
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

    // Posición X previa del centro de cada palma abierta (identidad por
    // referencia de la mano, la que garantiza handpose.js): con eso se mide
    // el desplazamiento horizontal entre frames para el viento.
    const palmasAnteriores = new Map();

    // Posición X previa del centro de cada mano con el índice extendido:
    // alimenta el arrastre que despeja la niebla (El caminante).
    const indicesAnteriores = new Map();

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
            mostrarPoses(obra);
            Artwork.montar(document.getElementById("contenedorLienzo"));
            Artwork.cargar(obra);
            arrancarBucle();
        });

        return true;
    }

    function salir() {
        obraActiva = null;
        palmasAnteriores.clear();
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

    // Devuelve el estado por frame: cuántas manos hay, si alguna mantiene el
    // índice extendido (molino), si alguna hace la paz (meteoritos), si
    // alguna tiene la pinza cerrada o abierta (resplandor de los cuerpos) y
    // la velocidad horizontal de las palmas abiertas (viento).
    function estadoManos() {
        const estado = {
            molino: false,
            paz: false,
            manos: 0,
            pinzaCerrada: false,
            pinzaAbierta: false,
            pinzaDistancia: null,
            pinzaManos: 0,
            vientoManos: 0,
            vientoVelocidad: 0,
            indiceManos: 0,
            indiceVelocidad: 0,
            indiceX: null,
            indiceXManos: 0,
            palmaX: null,
            palmaY: null,
            palmaManos: 0,
        };

        if (typeof hands === "undefined" || !Array.isArray(hands)) return estado;
        if (typeof video === "undefined" || !video || !video.width) return estado;
        if (typeof Gestures === "undefined" || typeof Gestures.snapshots !== "function") return estado;

        const unidad = Math.max(video.width, video.height);
        const snapshots = Gestures.snapshots();
        const usados = new Array(snapshots.length).fill(false);
        const palmasAbiertas = new Set();
        const indicesPuntos = new Set();

        for (const mano of hands) {
            if (!mano || !Array.isArray(mano.keypoints) || mano.keypoints.length < 21) continue;

            const snapshot = emparejar(mano, snapshots, usados, unidad);
            let posture = snapshot ? snapshot.posture : null;

            // Respaldos (puentes de interfaz, no un segundo reconocedor):
            // se mide directo de los keypoints cuando Gestures no clasificó
            // (o leyó "point" con la mano en otra forma):
            // - índice + medio extendidos -> peace
            // - índice único extendido -> point
            if (posture === null || posture === "point") {
                if (pazExtendida(mano)) {
                    posture = "peace";
                } else if (posture === null && indiceExtendido(mano)) {
                    posture = "point";
                }
            }

            estado.manos += 1;

            if (posture === "point") estado.molino = true;
            if (posture === "peace") estado.paz = true;

            // Índice en movimiento horizontal: arrastra la niebla. Se mide
            // el desplazamiento del centro de la mano entre frames (para la
            // ondulación) y su posición horizontal (para el avance).
            if (posture === "point") {
                indicesPuntos.add(mano);

                const ids = [0, 5, 9, 13, 17];
                let sumaX = 0;
                for (const indice of ids) {
                    sumaX += mano.keypoints[indice].x;
                }
                const xIndice = sumaX / ids.length;

                estado.indiceX = (estado.indiceX || 0) + xIndice / Math.max(1, video.width);
                estado.indiceXManos += 1;

                const previa = indicesAnteriores.get(mano);
                if (previa !== undefined) {
                    estado.indiceVelocidad += (xIndice - previa) / unidad;
                    estado.indiceManos += 1;
                }
                indicesAnteriores.set(mano, xIndice);
            }

            if (snapshot && snapshot.pinzaCerrada) estado.pinzaCerrada = true;
            if (snapshot && snapshot.pinzaAbierta) estado.pinzaAbierta = true;

            // Profundidad: la distancia de la pinza CERRADA (canal continuo
            // de gestures.js) controla el zoom en las obras que lo usan.
            if (
                snapshot &&
                snapshot.pinza === "cerrada" &&
                typeof snapshot.pinzaDistancia === "number"
            ) {
                estado.pinzaDistancia = (estado.pinzaDistancia || 0) + snapshot.pinzaDistancia;
                estado.pinzaManos += 1;
            }

            // Viento: solo con la palma abierta (la pinza, la paz y el índice
            // nunca clasifican como open_palm). Se mide el desplazamiento
            // horizontal del centro de la palma entre frames, en fracciones
            // del lado mayor del video.
            if (posture === "open_palm") {
                palmasAbiertas.add(mano);

                const ids = [0, 5, 9, 13, 17];
                let sumaX = 0;
                let sumaY = 0;
                for (const indice of ids) {
                    sumaX += mano.keypoints[indice].x;
                    sumaY += mano.keypoints[indice].y;
                }
                const xPalma = sumaX / ids.length;
                const yPalma = sumaY / ids.length;

                const previa = palmasAnteriores.get(mano);
                if (previa !== undefined) {
                    estado.vientoVelocidad += (xPalma - previa) / unidad;
                    estado.vientoManos += 1;
                }
                palmasAnteriores.set(mano, xPalma);

                // Posición promedio de las palmas abiertas: horizontal para
                // la hora del día, vertical como referencia.
                estado.palmaX =
                    (estado.palmaX || 0) + xPalma / Math.max(1, video.width);
                estado.palmaY = (estado.palmaY || 0) + yPalma / unidad;
                estado.palmaManos += 1;
            }
        }

        // Las manos que dejaron de estar en palma abierta se olvidan: al
        // reabrir no hay salto de posición.
        for (const mano of Array.from(palmasAnteriores.keys())) {
            if (!palmasAbiertas.has(mano)) palmasAnteriores.delete(mano);
        }

        // Lo mismo con las manos que dejaron de señalar con el índice.
        for (const mano of Array.from(indicesAnteriores.keys())) {
            if (!indicesPuntos.has(mano)) indicesAnteriores.delete(mano);
        }

        if (estado.vientoManos > 0) {
            estado.vientoVelocidad /= estado.vientoManos;
        }

        if (estado.indiceManos > 0) {
            estado.indiceVelocidad /= estado.indiceManos;
        }

        if (estado.indiceXManos > 0) {
            estado.indiceX /= estado.indiceXManos;
        }

        if (estado.palmaManos > 0) {
            estado.palmaY /= estado.palmaManos;
            estado.palmaX /= estado.palmaManos;
        }

        if (estado.pinzaManos > 0) {
            estado.pinzaDistancia /= estado.pinzaManos;
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

        const obra = obraActiva;

        // Nombres de cada interacción según la obra abierta.
        const nombrePaz =
            obra && obra.pazEfecto === "tormenta"
                ? "Tormenta"
                : obra && obra.pazEfecto === "ojos"
                    ? "Cerrar los ojos"
                    : obra && obra.meteoritos
                        ? "Lluvia de meteoritos"
                        : null;
        const nombrePinza =
            obra && obra.pinzaEfecto === "profundidad"
                ? "Profundidad"
                : obra && obra.pinzaEfecto === "derretir"
                    ? "Derretir los relojes"
                    : obra && Array.isArray(obra.cuerpos) && obra.cuerpos.length > 0
                        ? "Iluminar"
                        : null;
        const nombrePalma =
            obra && obra.palmEfecto === "atmosfera"
                ? "Atardecer / Anochecer"
                : obra && obra.palmEfecto === "sueno"
                    ? "Universo onírico"
                    : obra && obra.viento
                        ? "Viento"
                        : null;
        const nombreIndice =
            obra && obra.indiceEfecto === "disolver"
                ? "Multiverso"
                : obra && obra.indiceEfecto === "despejar"
                    ? "Despejar niebla"
                    : obra &&
                        Array.isArray(obra.zonas) &&
                        obra.zonas.some((zona) => zona.efecto === "remolino")
                        ? "Remolinos"
                        : null;

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
        } else if (estado.molino && nombreIndice) {
            texto = `Índice · ${nombreIndice}`;
        } else if (estado.paz && nombrePaz) {
            texto = `Paz · ${nombrePaz}`;
        } else if (estado.pinzaCerrada && nombrePinza) {
            texto = `Pinza · ${nombrePinza}`;
        } else if (estado.vientoManos > 0 && nombrePalma) {
            texto = `Palma · ${nombrePalma}`;
        } else if (estado.pinzaCerrada) {
            texto = "Pinza · sin efecto en esta obra";
        } else if (estado.paz) {
            texto = "Paz · sin efecto en esta obra";
        } else if (estado.molino) {
            texto = "Índice · sin efecto en esta obra";
        } else if (estado.vientoManos > 0) {
            texto = "Palma · sin efecto en esta obra";
        } else {
            const molino =
                typeof Artwork !== "undefined" && typeof Artwork.estadoMolino === "function"
                    ? Artwork.estadoMolino()
                    : null;
            if (molino && molino.girando) {
                texto = "Molino · girando por inercia";
            } else if (molino && molino.desenrollando) {
                texto = "Molino · volviendo a la forma original";
            } else {
                texto = "Probá un gesto";
            }
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

    // Arma el pie de poses según la obra abierta: cada pintura muestra solo
    // las interacciones que tiene activas.
    function mostrarPoses(obra) {
        const contenedor = document.querySelector("#experiencia .poses");
        if (!contenedor) return;

        const poses =
            Array.isArray(obra.poses) && obra.poses.length > 0
                ? obra.poses
                : [{ icono: "✊", nombre: "Puño", desc: "Iniciar" }];

        const fragmento = document.createDocumentFragment();

        for (const pose of poses) {
            const tarjeta = document.createElement("div");
            tarjeta.className = "pose";
            tarjeta.title = pose.nombre;

            const icono = document.createElement("span");
            icono.className = "pose-icono";
            icono.setAttribute("aria-hidden", "true");
            icono.textContent = pose.icono;

            const nombre = document.createElement("span");
            nombre.className = "pose-nombre";
            nombre.textContent = pose.nombre;

            const desc = document.createElement("span");
            desc.className = "pose-desc";
            desc.textContent = pose.desc;

            tarjeta.append(icono, nombre, desc);
            fragmento.append(tarjeta);
        }

        contenedor.replaceChildren(fragmento);
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
