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
            vientoManos: 0,
            vientoVelocidad: 0,
            palma: false,
            palmaX: 0,
            point: false,
            corriente: null,
            // Posición del índice (punta del dedo) en el encuadre normalizado
            // de la ventana. La consumen las interacciones propias de cada
            // obra; las obras sin interacciones propias la ignoran.
            indice: null,
            // Apertura de la pinza (pulgar↔índice, en tamaños de mano). Es
            // continua, para modular intensidad; null si no hay medición.
            pinzaDistancia: null,
        };

        if (typeof hands === "undefined" || !Array.isArray(hands)) return estado;
        if (typeof video === "undefined" || !video || !video.width) return estado;
        if (typeof Gestures === "undefined" || typeof Gestures.snapshots !== "function") return estado;

        const unidad = Math.max(video.width, video.height);
        const snapshots = Gestures.snapshots();
        const usados = new Array(snapshots.length).fill(false);
        const palmasAbiertas = new Set();
        const puntosPaz = [];
        let palmaCuenta = 0;

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
                } else if (posture === null && manoAbierta(mano)) {
                    posture = "open_palm";
                }
            }

            estado.manos += 1;

            if (posture === "point") {
                estado.molino = true;
                estado.point = true;
            }
            if (posture === "peace") {
                estado.paz = true;

                // Centro de la V (índice + medio) en coordenadas del cuadro:
                // con una mano en paz, la corriente se abre ahí.
                const kp = mano.keypoints;
                puntosPaz.push({
                    x: (kp[8].x + kp[12].x) / 2 / video.width,
                    y: (kp[8].y + kp[12].y) / 2 / video.height,
                });
            }

            // Posición del índice para las interacciones propias de la obra.
            // Es un dato derivado de la postura que ya clasifica gestures.js:
            // no agrega gestos ni cambia umbrales.
            // La pinza no debe disparar la interacción del índice: si la mano
            // está pinzando, no se publica su posición aunque el índice esté
            // extendido.
            const pinzando = !!(snapshot && snapshot.pinzaCerrada);
            if (posture === "point" && !pinzando && !estado.indice) {
                const indice = indiceEnVentana(mano, video.width, video.height);
                if (indice) {
                    indice.handId = snapshot ? snapshot.handId : null;
                    estado.indice = indice;
                }
            }

            if (snapshot && snapshot.pinzaCerrada) estado.pinzaCerrada = true;
            if (snapshot && snapshot.pinzaAbierta) estado.pinzaAbierta = true;

            // La distancia entre los dedos modula las interacciones continuas.
            // Se toma la pinza más cerrada entre todas las manos.
            if (snapshot && Number.isFinite(snapshot.pinzaDistancia)) {
                if (estado.pinzaDistancia === null || snapshot.pinzaDistancia < estado.pinzaDistancia) {
                    estado.pinzaDistancia = snapshot.pinzaDistancia;
                }
            }

            // Palma: el reconocedor exige el pulgar desplegado y con el
            // modelo lite a veces no llega. Para el oleaje se acepta la mano
            // abierta completa; el viento sigue usando sólo la clasificación
            // estricta para no cambiar el comportamiento de otras obras.
            if (posture === "open_palm" || palmaExtendida(mano)) {
                const ids = [0, 5, 9, 13, 17];
                let suma = 0;
                for (const indice of ids) suma += mano.keypoints[indice].x;
                const xPalma = suma / ids.length;

                estado.palma = true;
                estado.palmaX += xPalma / unidad;
                palmaCuenta += 1;

                if (posture === "open_palm") {
                    palmasAbiertas.add(mano);

                    const previa = palmasAnteriores.get(mano);
                    if (previa !== undefined) {
                        estado.vientoVelocidad += (xPalma - previa) / unidad;
                        estado.vientoManos += 1;
                    }
                    palmasAnteriores.set(mano, xPalma);
                }
            }
        }

        // Las manos que dejaron de estar en palma abierta se olvidan: al
        // reabrir no hay salto de posición.
        for (const mano of Array.from(palmasAnteriores.keys())) {
            if (!palmasAbiertas.has(mano)) palmasAnteriores.delete(mano);
        }

        if (estado.vientoManos > 0) {
            estado.vientoVelocidad /= estado.vientoManos;
        }

        if (palmaCuenta > 0) {
            estado.palmaX /= palmaCuenta;
        }

        // Una mano en paz abre la corriente: el canal se centra en la mano y
        // corre de izquierda a derecha. Se acota a la franja del mar para
        // que no caiga en el cielo si la mano va alta.
        if (puntosPaz.length >= 1) {
            puntosPaz.sort((a, b) => a.x - b.x);
            const x = Math.max(0.05, Math.min(0.95, puntosPaz[0].x));
            // La franja de las barcas: la corriente siempre pasa por ahí.
            const y = Math.max(0.74, Math.min(0.86, puntosPaz[0].y));
            const medio = 0.4;

            estado.corriente = {
                ax: Math.max(0, x - medio),
                ay: y,
                bx: Math.min(1, x + medio),
                by: y,
            };
        }

        return estado;
    }

    // Proyección de la punta del índice al encuadre normalizado de la
    // ventana: el mismo "cover" con el que handpose.js dibuja la cámara. El
    // recuadro del pie muestra ese canvas completo, así que 0..1 coincide con
    // lo que ve el usuario. Los keypoints ya vienen espejados por handpose.js:
    // acá no se invierte nada.
    function indiceEnVentana(mano, videoAncho, videoAlto) {
        if (!videoAncho || !videoAlto) return null;

        const punta = mano.keypoints[8];
        if (!punta) return null;

        const ancho = window.innerWidth || videoAncho;
        const alto = window.innerHeight || videoAlto;
        const escala = Math.max(ancho / videoAncho, alto / videoAlto);
        const offsetX = (ancho - videoAncho * escala) / 2;
        const offsetY = (alto - videoAlto * escala) / 2;

        return {
            x: (offsetX + punta.x * escala) / ancho,
            y: (offsetY + punta.y * escala) / alto,
        };
    }

    // Respaldo del índice extendido (puente de interfaz, no un segundo
    // reconocedor): con el modelo lite el ángulo del índice a veces no
    // supera los umbrales estrictos de gestures.js. Solo actúa cuando no
    // hay clasificación y exige que el índice sea el ÚNICO dedo extendido.
    function indiceExtendido(mano) {
        const r = dedosLargos(mano);
        return r[0] >= 1.55 && r[1] < 1.55 && r[2] < 1.55 && r[3] < 1.55;
    }

    // Respaldo de la paz: índice y medio extendidos, los otros flexionados.
    function pazExtendida(mano) {
        const r = dedosLargos(mano);
        return r[0] >= 1.5 && r[1] >= 1.5 && r[2] < 1.5 && r[3] < 1.5;
    }

    // Respaldo de la palma: los cuatro dedos largos extendidos. El pulgar
    // no participa, igual que en el puño: lo que importa es la mano abierta.
    function palmaExtendida(mano) {
        const r = dedosLargos(mano);
        return r[0] >= 1.5 && r[1] >= 1.5 && r[2] >= 1.5 && r[3] >= 1.5;
    }

    // Proporción de extensión de cada dedo largo (índice, medio, anular,
    // meñique): punta→base dividido nudillo→base, en tamaños de mano. Es
    // scale-free y es el mismo criterio para los tres respaldos.
    function dedosLargos(mano) {
        const keypoints = mano.keypoints;
        const dedos = [
            { mcp: 5, pip: 6, tip: 8 },
            { mcp: 9, pip: 10, tip: 12 },
            { mcp: 13, pip: 14, tip: 16 },
            { mcp: 17, pip: 18, tip: 20 },
        ];
        const proporcion = [0, 0, 0, 0];

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
            proporcion[i] = largo / base;
        }

        return proporcion;
    }

    // Respaldo de la palma abierta: tres o cuatro dedos largos extendidos y el
    // pulgar desplegado. Sólo actúa cuando gestures.js no clasificó nada.
    function manoAbierta(mano) {
        const kp = mano.keypoints;
        const muneca = kp[0];
        const tamano = Math.max(distancia(muneca, kp[9]), 1e-6);
        const dedos = [
            { pip: 6, tip: 8 },
            { pip: 10, tip: 12 },
            { pip: 14, tip: 16 },
            { pip: 18, tip: 20 },
        ];

        let extendidos = 0;
        for (const dedo of dedos) {
            const aPip = distancia(kp[dedo.pip], muneca);
            if (aPip <= 1e-6) continue;
            if (distancia(kp[dedo.tip], muneca) / aPip >= 1.2) extendidos += 1;
        }
        if (extendidos < 3) return false;
        if (extendidos === 4) return true;

        const ids = [0, 5, 9, 13, 17];
        let x = 0;
        let y = 0;
        for (const id of ids) {
            x += kp[id].x;
            y += kp[id].y;
        }
        const palma = { x: x / ids.length, y: y / ids.length };
        return distancia(kp[4], palma) / tamano >= 0.8;
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

        // La obra manda: lo que no declara no se anuncia ni se ejecuta. Una
        // obra sin `gestos` conserva los textos históricos completos.
        const gestos = obraActiva && obraActiva.gestos ? obraActiva.gestos : null;
        const legado = !gestos;
        const efecto = (nombre) => (gestos && gestos[nombre] ? gestos[nombre].efecto : null);

        const molino = legado || efecto("point") === "molino";
        const tormenta = efecto("point") === "tormenta";
        const meteoros = legado || efecto("peace") === "meteoros";
        const corriente = efecto("peace") === "corriente";
        const noche = efecto("pinza") === "noche";
        const resplandor = legado || efecto("pinza") === "resplandor";
        const oleaje = efecto("palma") === "oleaje";

        let texto;
        if (estado.manos === 0) {
            const estadoArtwork =
                typeof Artwork !== "undefined" && typeof Artwork.estadoMolino === "function"
                    ? Artwork.estadoMolino()
                    : null;
            texto =
                estadoArtwork && estadoArtwork.desenrollando
                    ? "Sin manos · volviendo a la forma original"
                    : "Sin manos en cámara";
        } else if (oleaje && estado.palma) {
            texto = "Palma abierta · el mar acompaña el movimiento";
        } else if (tormenta && estado.point) {
            texto = "Índice · tormenta sobre la obra";
        } else if (corriente && estado.corriente) {
            texto = "Paz · corriente sobre el mar";
        } else if (noche && estado.pinzaCerrada) {
            texto = "Pinza · cae la noche";
        } else if (molino && estado.molino) {
            texto = "Índice · molino girando";
        } else if (meteoros && estado.paz) {
            texto = "Paz · lluvia de meteoritos";
        } else if (resplandor && estado.pinzaCerrada) {
            texto = "Pinza cerrada · encendiendo los cuerpos celestes";
        } else if (oleaje || tormenta || corriente || noche) {
            const pistas = [];
            if (oleaje) pistas.push("palma = mover el mar");
            if (tormenta) pistas.push("índice = desatar la tormenta");
            if (corriente) pistas.push("dos dedos = abrir una corriente");
            if (noche) pistas.push("pinza = caer la noche");
            texto = pistas.join(" · ");
        } else if (
            molino &&
            typeof Artwork !== "undefined" &&
            typeof Artwork.estadoMolino === "function"
        ) {
            const estadoArtwork = Artwork.estadoMolino();
            if (estadoArtwork.girando) {
                texto = "Molino · girando por inercia";
            } else if (estadoArtwork.desenrollando) {
                texto = "Molino · volviendo a la forma original";
            } else {
                texto = "Índice extendido = girar el remolino";
            }
        } else if (molino) {
            texto = "Índice extendido = girar el remolino";
        } else {
            texto = "Manos en cámara";
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
        mostrarPoses(obra);
    }

    // --- Descripciones de los gestos ---------------------------------------
    // Cada obra puede declarar en `poses` qué hace cada gesto. Se guardan los
    // textos originales para restaurarlos en las obras que no declaran nada.

    const posesOriginales = [];

    function capturarPoses() {
        for (const nodo of document.querySelectorAll("#experiencia .pose[data-pose]")) {
            const desc = nodo.querySelector(".pose-desc");
            posesOriginales.push({
                nodo,
                clave: nodo.dataset.pose,
                desc: desc ? desc.textContent : null,
                titulo: nodo.getAttribute("title"),
            });
        }
    }

    function mostrarPoses(obra) {
        for (const original of posesOriginales) {
            const dato = obra && obra.poses ? obra.poses[original.clave] : null;
            const desc = original.nodo.querySelector(".pose-desc");

            if (dato) {
                if (desc && dato.desc) desc.textContent = dato.desc;
                if (dato.titulo) original.nodo.setAttribute("title", dato.titulo);
            } else {
                if (desc && original.desc !== null) desc.textContent = original.desc;
                if (original.titulo !== null) original.nodo.setAttribute("title", original.titulo);
            }
        }
    }

    capturarPoses();

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
