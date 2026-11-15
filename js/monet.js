// Interacciones de Impresión, sol naciente (Claude Monet).
//
// Implementación nueva, independiente de las versiones anteriores. Sólo
// consume el estado que publica js/gamelogic.js (posturas y pinza) y dibuja
// en la capa de efectos 2D del motor.
//
// Coordenadas: píxeles de la imagen original (1600 x 1242).
//   Sol: (974, 384) radio 28.  Horizonte: y = 620.
//
// Interacciones:
//   1. Palma abierta: el mar cobra vida (olas, reflejo y barcos flotando).
//   2. Índice extendido: el atardecer (cielo que se apaga y sol que se hunde).
//   3. Dos dedos: el cielo se mueve (nubes y rastros de viento).
//   4. Pinza: tormenta eléctrica y diluvio.
//
// API: configurar, limpiar, actualizar, dibujar, estados.

const Monet = (function () {
    "use strict";

    const TAU = Math.PI * 2;

    // --- Datos de la obra -------------------------------------------------
    let dimensiones = { ancho: 1600, alto: 1242 };
    let horizonte = 620;
    let sol = { x: 974, y: 384, radio: 28 };
    let barcosDatos = [];
    let fuente = null;
    let paleta = null;

    // --- Estados ----------------------------------------------------------
    let mar = 0; // 0..1: mar activo (palma presente)
    let marVel = 0; // 0..1: intensidad del movimiento de la palma
    let atardecer = 0; // 0..1: índice extendido
    let cielo = 0; // 0..1: dos dedos
    let tormenta = 0; // 0..1: pinza
    let tiempo = 0;

    // --- Recursos ---------------------------------------------------------
    const flota = [];
    let capaSol = null;
    let nubesSprites = [];
    let nubesOscuras = [];
    let rayoActual = null;
    let proximoRayo = 0;
    let semillaRayos = 1337;

    const PALETA_BASE = Object.freeze({
        cielo: [168, 150, 138],
        cieloClaro: [214, 198, 186],
        mar: [108, 138, 132],
        marOscuro: [44, 82, 80],
        bruma: [150, 166, 162],
        sol: [223, 111, 89],
        reflejo: [222, 128, 62],
        barco: [36, 74, 70],
    });

    // --- Utilidades -------------------------------------------------------

    function limitar(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function suave(t) {
        const x = limitar(t, 0, 1);
        return x * x * (3 - 2 * x);
    }

    function tramo(valor, desde, hasta) {
        return suave((valor - desde) / Math.max(0.0001, hasta - desde));
    }

    function mezclar(a, b, t) {
        const k = limitar(t, 0, 1);
        return [
            Math.round(a[0] + (b[0] - a[0]) * k),
            Math.round(a[1] + (b[1] - a[1]) * k),
            Math.round(a[2] + (b[2] - a[2]) * k),
        ];
    }

    function rgba(color, alfa) {
        const a = limitar(alfa, 0, 1).toFixed(3);
        return "rgba(" + color[0] + ", " + color[1] + ", " + color[2] + ", " + a + ")";
    }

    function azar(semilla) {
        let s = semilla >>> 0;
        return function () {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    function envolver(valor, periodo) {
        return ((valor % periodo) + periodo) % periodo;
    }

    // --- Paleta -----------------------------------------------------------

    function extraerPaleta(imagen) {
        const base = imagen && (imagen.canvas || imagen.elt || imagen);
        if (!base) return null;

        const ANCHO = 160;
        const ALTO = 124;
        const lienzo = document.createElement("canvas");
        lienzo.width = ANCHO;
        lienzo.height = ALTO;
        const ctx = lienzo.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;

        try {
            ctx.drawImage(base, 0, 0, ANCHO, ALTO);
            const datos = ctx.getImageData(0, 0, ANCHO, ALTO).data;

            const punto = (u, v) => {
                const x = limitar(Math.round(u * ANCHO), 0, ANCHO - 1);
                const y = limitar(Math.round(v * ALTO), 0, ALTO - 1);
                const i = (y * ANCHO + x) * 4;
                return [datos[i], datos[i + 1], datos[i + 2]];
            };
            const promedio = (puntos) => {
                let r = 0;
                let g = 0;
                let b = 0;
                for (const [u, v] of puntos) {
                    const c = punto(u, v);
                    r += c[0];
                    g += c[1];
                    b += c[2];
                }
                const n = puntos.length || 1;
                return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
            };

            const cielo = promedio([
                [0.1, 0.06],
                [0.5, 0.08],
                [0.85, 0.1],
            ]);
            const bruma = promedio([
                [0.35, 0.34],
                [0.7, 0.38],
            ]);
            const marBase = promedio([
                [0.2, 0.72],
                [0.75, 0.8],
                [0.45, 0.9],
            ]);

            return {
                cielo,
                cieloClaro: mezclar(cielo, [255, 244, 230], 0.35),
                mar: marBase,
                marOscuro: mezclar(marBase, [16, 44, 46], 0.55),
                bruma,
                sol: PALETA_BASE.sol,
                reflejo: PALETA_BASE.reflejo,
                barco: PALETA_BASE.barco,
            };
        } catch (error) {
            return null;
        }
    }

    // --- Datos procedurales (semilla fija) --------------------------------

    const OLAS = (function () {
        const a = azar(0x51a7c3);

        const bandas = [];
        for (let i = 0; i < 3; i += 1) {
            bandas.push({
                v: 0.18 + i * 0.28,
                largo: 0.8 + a() * 0.7,
                amp: 0.018 + a() * 0.016,
                vel: 0.3 + a() * 0.25,
                fase: a() * TAU,
                grosor: 14 + a() * 14,
                alfa: 0.13 + a() * 0.07,
            });
        }

        const crestas = [];
        for (let i = 0; i < 130; i += 1) {
            crestas.push({
                v: 0.06 + a() * 0.9,
                largo: 26 + a() * 50,
                amp: 8 + a() * 18,
                vel: 0.35 + a() * 0.5,
                fase: a() * TAU,
                grosor: 1.5 + a() * 2.6,
                alfa: 0.2 + a() * 0.18,
            });
        }

        return { bandas, crestas };
    })();

    const NUBES = (function () {
        const a = azar(0x2f81d5);
        const lista = [];
        for (let i = 0; i < 24; i += 1) {
            lista.push({
                y: 0.04 + a() * 0.36,
                r: 0.09 + a() * 0.16,
                vel: 8 + a() * 34,
                dir: a() < 0.5 ? 1 : -1,
                alfa: 0.35 + a() * 0.5,
                variante: Math.floor(a() * 4),
            });
        }
        return lista;
    })();

    const RASTROS = (function () {
        const a = azar(0x7c3b91);
        const lista = [];
        for (let i = 0; i < 16; i += 1) {
            lista.push({
                y: 0.05 + a() * 0.34,
                largo: 0.16 + a() * 0.3,
                curva: 6 + a() * 18,
                vel: 30 + a() * 70,
                alfa: 0.22 + a() * 0.28,
                grosor: 1.2 + a() * 2,
                fase: a() * TAU,
            });
        }
        return lista;
    })();

    const LLUVIA = (function () {
        const a = azar(0x3d91ab);
        const lista = [];
        for (let i = 0; i < 170; i += 1) {
            const capa = i < 70 ? 0 : i < 125 ? 1 : 2;
            lista.push({
                x: a(),
                y: a(),
                vel: 0.5 + capa * 0.35 + a() * 0.5,
                largo: 10 + capa * 10 + a() * 14,
                grosor: 0.6 + capa * 0.6 + a() * 0.8,
                alfa: 0.18 + capa * 0.12 + a() * 0.1,
                capa,
            });
        }
        return lista;
    })();

    // --- Barcos -----------------------------------------------------------

    function recortar(x, y, ancho, alto, brillo, margen) {
        const lienzo = document.createElement("canvas");
        lienzo.width = Math.max(1, Math.round(ancho));
        lienzo.height = Math.max(1, Math.round(alto));
        const ctx = lienzo.getContext("2d");
        if (!ctx) return lienzo;

        if (brillo && Math.abs(brillo - 1) > 0.02) {
            ctx.filter = "brightness(" + brillo.toFixed(2) + ")";
        }
        try {
            ctx.drawImage(fuente, x, y, ancho, alto, 0, 0, lienzo.width, lienzo.height);
        } catch (error) {
            return lienzo;
        }
        ctx.filter = "none";

        if (margen === 0) {
            return lienzo;
        }

        // Borde suave: la pieza se funde con el agua, sin recorte visible.
        ctx.globalCompositeOperation = "destination-in";
        const inset = Math.max(6, margen || Math.min(lienzo.width, lienzo.height) * 0.16);
        ctx.filter = "blur(" + (inset * 0.65).toFixed(1) + "px)";
        ctx.fillStyle = "#fff";
        ctx.fillRect(inset, inset, lienzo.width - inset * 2, lienzo.height - inset * 2);
        ctx.filter = "none";
        ctx.globalCompositeOperation = "source-over";

        return lienzo;
    }

    function prepararFlota() {
        if (!fuente) return;
        for (const dato of barcosDatos) {
            // Una sola pieza: el barco con su agua y su reflejo alrededor.
            // Al desplazarla un poco, el barco flota sin duplicarse ni dejar
            // parches, porque la pieza incluye su propio entorno.
            const margenX = 34;
            const margenY = 34;
            const x = Math.max(0, dato.x - margenX);
            const y = Math.max(0, dato.y - margenY);
            const ancho = Math.min(dimensiones.ancho - x, dato.ancho + margenX * 2);
            const alto = Math.min(dimensiones.alto - y, dato.alto + margenY * 2 + dato.alto * 0.5);

            flota.push({
                x,
                y,
                ancho,
                alto,
                fase: Number.isFinite(dato.fase) ? dato.fase : 0,
                centroX: x + ancho / 2,
                centroY: y + alto / 2,
                pieza: recortar(x, y, ancho, alto, null, 0),
            });
        }
    }

    // --- Recursos de cielo y sol ------------------------------------------

    function crearNube(color, base, alfa, semilla) {
        const lienzo = document.createElement("canvas");
        lienzo.width = 180;
        lienzo.height = 110;
        const ctx = lienzo.getContext("2d");
        if (!ctx) return lienzo;

        const a = azar(semilla);
        for (let i = 0; i < 8; i += 1) {
            const x = 30 + a() * 120;
            const y = 34 + a() * 36;
            const r = 16 + a() * 28;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            g.addColorStop(0, rgba(color, alfa));
            g.addColorStop(0.6, rgba(color, alfa * 0.45));
            g.addColorStop(1, rgba(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, TAU);
            ctx.fill();
        }
        return lienzo;
    }

    function crearParcheSol() {
        const lado = 132;
        const lienzo = document.createElement("canvas");
        lienzo.width = lado;
        lienzo.height = lado;
        const ctx = lienzo.getContext("2d");
        if (!ctx) return lienzo;

        try {
            ctx.drawImage(fuente, 1030, 318, lado, lado, 0, 0, lado, lado);
        } catch (error) {
            // Sin imagen: parche neutro.
        }

        ctx.globalCompositeOperation = "destination-in";
        const g = ctx.createRadialGradient(lado / 2, lado / 2, 0, lado / 2, lado / 2, lado * 0.48);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(0.72, "rgba(0,0,0,0.96)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, lado, lado);
        ctx.globalCompositeOperation = "source-over";

        return lienzo;
    }

    function prepararRecursos() {
        if (!paleta || typeof document === "undefined") return;
        nubesSprites = [
            crearNube(paleta.cieloClaro, paleta.cielo, 0.72, 0x11),
            crearNube(paleta.cielo, paleta.cieloClaro, 0.6, 0x22),
            crearNube(mezclar(paleta.cielo, paleta.bruma, 0.4), paleta.cielo, 0.55, 0x33),
            crearNube(mezclar(paleta.cieloClaro, [255, 240, 220], 0.3), paleta.cielo, 0.5, 0x44),
        ];
        nubesOscuras = [
            crearNube(mezclar(paleta.marOscuro, [40, 44, 60], 0.4), paleta.marOscuro, 0.55, 0x55),
            crearNube(mezclar(paleta.marOscuro, [24, 28, 44], 0.6), paleta.marOscuro, 0.5, 0x66),
        ];
        capaSol = crearParcheSol();
        prepararFlota();
    }

    // --- Ola compartida ---------------------------------------------------

    // Altura de la superficie del agua en un punto: la usan las olas, el
    // reflejo y los barcos para moverse en fase.
    function alturaOla(x, y, faseExtra) {
        const v = limitar((y - horizonte) / Math.max(1, dimensiones.alto - horizonte), 0, 1);
        const fase = v * 6.4 + x * 0.0012 - tiempo * 1.15 + (faseExtra || 0);
        return Math.sin(fase) * (6 + v * 15);
    }

    // --- 1. Mar -----------------------------------------------------------

    function dibujarMar(ctx, vista, x0, y0, ancho, alto) {
        const fit = vista.fit;
        const nivel = Math.max(mar, tormenta);
        if (nivel <= 0.002) return;

        const yAgua = y0 + horizonte * fit;
        const altoAgua = Math.max(1, y0 + alto - yAgua);
        const empuje = marVel * 26 * mar;
        const velocidad = 0.55 + marVel * 0.6 + tormenta * 1.8;
        const fuerza = 0.7 + marVel * 0.35 + tormenta * 1.7;

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        ctx.lineCap = "round";

        // 1. Senos de ola: cada banda se dibuja como una sola onda continua,
        // con el trazo que aparece y desaparece a lo largo, para que no se
        // vean uniones ni puntos.
        for (const banda of OLAS.bandas) {
            for (let capa = 0; capa < 2; capa += 1) {
                const baseY = yAgua + banda.v * altoAgua + capa * 14 * fit;
                const amp = banda.amp * altoAgua * nivel * fuerza * (capa ? 0.6 : 1);
                const color = capa
                    ? mezclar(paleta.bruma, [255, 252, 244], 0.7)
                    : mezclar(paleta.marOscuro, [16, 50, 54], 0.3);
                const alfa = (capa ? banda.alfa * 1.3 : banda.alfa * 1.5) * nivel;

                const grad = ctx.createLinearGradient(x0, 0, x0 + ancho, 0);
                for (let k = 0; k <= 7; k += 1) {
                    const variacion = 0.3 + 0.7 * Math.abs(Math.sin(k * 1.7 + banda.fase));
                    grad.addColorStop(k / 7, rgba(color, alfa * variacion));
                }
                ctx.strokeStyle = grad;
                ctx.lineWidth = Math.max(2, banda.grosor * (capa ? 0.5 : 1) * fit);

                ctx.beginPath();
                for (let x = -40; x <= ancho + 40; x += 18) {
                    const fase = (x / ancho) * TAU * banda.largo + tiempo * banda.vel * velocidad + banda.fase;
                    const y = baseY + Math.sin(fase) * amp;
                    if (x <= -40) ctx.moveTo(x0 + x, y);
                    else ctx.lineTo(x0 + x, y);
                }
                ctx.stroke();
            }
        }

        // 2. Crestas: manchas de espuma muy difusas, sin bordes, que viajan
        // con la ola.
        let indiceCresta = 0;
        for (const cresta of OLAS.crestas) {
            indiceCresta += 1;
            const baseY = yAgua + cresta.v * altoAgua;
            const amp = cresta.amp * nivel * fuerza;
            const deriva = envolver(tiempo * cresta.vel * velocidad * 30 + empuje * 1.2, 46);
            const fase = cresta.fase + tiempo * cresta.vel * velocidad;
            const y = baseY + Math.sin(fase) * amp;
            const x = envolver(cresta.largo * 3 + deriva, ancho + 80) - 40;
            const giro = Math.cos(fase) * 0.09;
            const impulso = 1 + tormenta * 0.35;
            const luz = cresta.alfa * nivel * (0.7 + 0.3 * Math.sin(fase)) * 0.72 * (1 + tormenta * 0.25);
            const radio = Math.max(4, (cresta.largo * impulso * fit) / 2);
            const colorCresta = mezclar(paleta.bruma, [252, 253, 246], 0.85);

            ctx.save();
            ctx.translate(x0 + x + (cresta.largo * fit) / 2, y);
            ctx.rotate(giro);
            ctx.scale(1, 0.3);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radio);
            g.addColorStop(0, rgba(colorCresta, luz));
            g.addColorStop(0.55, rgba(colorCresta, luz * 0.5));
            g.addColorStop(1, rgba(colorCresta, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, radio, 0, TAU);
            ctx.fill();
            ctx.restore();

            // Con tormenta, algunas crestas revientan en espuma.
            if (tormenta > 0.3 && indiceCresta % 4 === 0) {
                ctx.save();
                ctx.translate(x0 + x + (cresta.largo * fit) / 2, y);
                ctx.rotate(giro);
                ctx.scale(1, 0.26);
                const radioOla = radio * 1.5;
                const go = ctx.createRadialGradient(0, 0, 0, 0, 0, radioOla);
                go.addColorStop(0, rgba([246, 251, 255], 0.2 * tormenta));
                go.addColorStop(1, rgba([246, 251, 255], 0));
                ctx.fillStyle = go;
                ctx.beginPath();
                ctx.arc(0, 0, radioOla, 0, TAU);
                ctx.fill();
                ctx.restore();
            }
        }

        // El reflejo naranja se rompe en ondas: manchas de agua difusas
        // sobre la columna, y brillos cálidos en las crestas.
        const reflejoX = 970;
        const anchoReflejo = 120;
        for (let i = 0; i < 16; i += 1) {
            const v = 0.03 + i * 0.055;
            const yImg = horizonte + v * (dimensiones.alto - horizonte);
            const y = yAgua + v * altoAgua + alturaOla(reflejoX, yImg) * fit * 0.55;
            const ond = Math.sin(tiempo * 1.1 + i * 0.7) * 16 * nivel + empuje * 0.4;
            const alfa = 0.34 * nivel * (1 - tormenta * 0.9);
            const radio = (anchoReflejo / 2) * fit;
            ctx.save();
            ctx.translate(x0 + (reflejoX + ond) * fit, y);
            ctx.scale(1, 0.09);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radio);
            g.addColorStop(0, rgba(paleta.mar, alfa));
            g.addColorStop(0.6, rgba(paleta.mar, alfa * 0.55));
            g.addColorStop(1, rgba(paleta.mar, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, radio, 0, TAU);
            ctx.fill();
            ctx.restore();
        }

        for (let i = 0; i < 10; i += 1) {
            const v = 0.05 + i * 0.09;
            const yImg = horizonte + v * (dimensiones.alto - horizonte);
            const y = yAgua + v * altoAgua + alturaOla(reflejoX, yImg) * fit * 0.5;
            const ond = Math.sin(tiempo * 1.4 + i) * 12 * nivel;
            const alfa = 0.36 * nivel * (1 - tormenta);
            const radio = 34 * fit;
            ctx.save();
            ctx.translate(x0 + (reflejoX + ond) * fit, y);
            ctx.scale(1, 0.1);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radio);
            g.addColorStop(0, rgba(paleta.reflejo, alfa));
            g.addColorStop(0.6, rgba(paleta.reflejo, alfa * 0.5));
            g.addColorStop(1, rgba(paleta.reflejo, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, radio, 0, TAU);
            ctx.fill();
            ctx.restore();
        }
    }

    // --- 2. Flota ---------------------------------------------------------

    function dibujarFlota(ctx, vista) {
        const activo = Math.max(mar, tormenta);
        if (activo <= 0.002 || flota.length === 0) return;

        const fit = vista.fit;
        const x0 = vista.offsetX;
        const y0 = vista.offsetY;

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;

        for (const barco of flota) {
            const ola = alturaOla(barco.centroX, barco.centroY, barco.fase);
            const olaFrente = alturaOla(barco.centroX + 40, barco.centroY, barco.fase);
            const amplitud = (ola * 0.55 + Math.sin(tiempo * 0.9 + barco.fase) * 1.8) * activo;
            const balanceo =
                ((olaFrente - ola) * 0.35 * activo) / Math.max(1, barco.alto) +
                Math.sin(tiempo * 0.7 + barco.fase) * 0.012 * activo +
                Math.sin(tiempo * 1.9 + barco.fase) * 0.02 * tormenta;

            const px = x0 + barco.x * fit;
            const py = y0 + barco.y * fit;
            const w = barco.ancho * fit;
            const h = barco.alto * fit;
            const tiras = 40;
            const altoTira = h / tiras;
            const altoFuente = barco.alto / tiras;
            const borde = 0.22;

            // La pieza se deforma en tiras con desplazamiento nulo en su
            // contorno: el barco cabalga la ola y el borde coincide siempre
            // con la pintura original, sin costuras ni parches.
            for (let i = 0; i < tiras; i += 1) {
                const v = (i + 0.5) / tiras;
                const peso = v < borde ? suave(v / borde) : v > 1 - borde ? suave((1 - v) / borde) : 1;
                const desplazamiento = amplitud * peso * fit;
                const giro = balanceo * (v - 0.5) * w;

                ctx.drawImage(
                    barco.pieza,
                    0,
                    i * altoFuente,
                    barco.ancho,
                    altoFuente + 0.6,
                    px + giro,
                    py + i * altoTira + desplazamiento,
                    w,
                    altoTira + 1
                );
            }
        }
    }

    // --- 3. Atardecer -----------------------------------------------------

    function dibujarAtardecer(ctx, vista, x0, y0, ancho, alto) {
        const p = atardecer;
        if (p <= 0.002) return;

        const fit = vista.fit;
        const yHorizonte = y0 + horizonte * fit;
        const calido = tramo(p, 0, 0.35);
        const oscuro = tramo(p, 0.12, 0.8);
        const noche = tramo(p, 0.55, 1);

        // 0. Primero se tapa el sol original: así el grade lo oscurece junto
        // con el resto del cielo y no queda un disco claro.
        const tapa = tramo(p, 0.01, 0.12);
        const caida = tramo(p, 0.02, 0.95);
        const ySol = sol.y + (horizonte + sol.radio * 1.35 - sol.y) * caida;

        if (tapa > 0 && capaSol) {
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = tapa;
            const lado = 132;
            ctx.drawImage(
                capaSol,
                x0 + (sol.x - lado / 2) * fit,
                y0 + (sol.y - lado / 2) * fit,
                lado * fit,
                lado * fit
            );
            ctx.globalAlpha = 1;
        }

        // 1. Primero se intensifican los cálidos del amanecer.
        if (calido > 0) {
            ctx.globalCompositeOperation = "screen";
            const g = ctx.createRadialGradient(
                x0 + sol.x * fit,
                y0 + sol.y * fit,
                0,
                x0 + sol.x * fit,
                y0 + sol.y * fit,
                ancho * 0.7
            );
            g.addColorStop(0, rgba([255, 186, 120], 0.4 * calido));
            g.addColorStop(0.5, rgba([255, 140, 80], 0.18 * calido));
            g.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = g;
            ctx.fillRect(x0, y0, ancho, yHorizonte - y0);
        }

        // 2. La luz baja: un solo degradado continuo de cielo a agua, con el
        // horizonte cálido como pivote. Sin solapes ni costuras.
        const hz = horizonte / dimensiones.alto;
        if (oscuro > 0) {
            ctx.globalCompositeOperation = "multiply";
            const g = ctx.createLinearGradient(0, y0, 0, y0 + alto);
            g.addColorStop(0, rgba([54, 22, 62], 0.78 * oscuro));
            g.addColorStop(hz * 0.55, rgba([124, 40, 68], 0.68 * oscuro));
            g.addColorStop(hz * 0.9, rgba([192, 74, 58], 0.5 * oscuro));
            g.addColorStop(hz, rgba([255, 148, 82], 0.32 * oscuro));
            g.addColorStop(hz + 0.05, rgba([196, 104, 78], 0.3 * oscuro));
            g.addColorStop(1, rgba([40, 22, 34], 0.28 * oscuro));
            ctx.fillStyle = g;
            ctx.fillRect(x0, y0, ancho, alto);

            // Bruma cálida centrada en el horizonte: funde cielo y agua sin
            // una línea dura.
            ctx.globalCompositeOperation = "screen";
            const bruma = ctx.createLinearGradient(0, y0, 0, y0 + alto);
            bruma.addColorStop(Math.max(0, hz - 0.14), "rgba(255,140,90,0)");
            bruma.addColorStop(hz, rgba([255, 152, 96], 0.16 * oscuro));
            bruma.addColorStop(Math.min(1, hz + 0.14), "rgba(255,140,90,0)");
            bruma.addColorStop(1, "rgba(255,140,90,0)");
            ctx.fillStyle = bruma;
            ctx.fillRect(x0, y0, ancho, alto);
        }

        // 3. Anochecer: el cielo vira a violeta y azul oscuro. El tinte se
        // desvanece hacia el agua para que no aparezca una línea en el horizonte.
        if (noche > 0) {
            ctx.globalCompositeOperation = "color";
            const tinte = ctx.createLinearGradient(0, y0, 0, y0 + alto);
            tinte.addColorStop(0, rgba([58, 56, 124], 0.62 * noche));
            tinte.addColorStop(hz, rgba([64, 60, 120], 0.5 * noche));
            tinte.addColorStop(Math.min(1, hz + 0.1), rgba([70, 62, 116], 0.2 * noche));
            tinte.addColorStop(1, "rgba(0,0,0,0)");
            ctx.fillStyle = tinte;
            ctx.fillRect(x0, y0, ancho, alto);

            ctx.globalCompositeOperation = "multiply";
            const atenuar = 1 - 0.3 * tormenta;
            ctx.fillStyle = rgba([18, 20, 44], 0.3 * noche * atenuar);
            ctx.fillRect(x0, y0, ancho, alto);
        }

        // Disco del sol con su resplandor, recortado por el horizonte.
        const cx = x0 + sol.x * fit;
        const cy = y0 + ySol * fit;
        const radio = Math.max(1, sol.radio * fit);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, ancho, Math.max(1, yHorizonte - y0));
        ctx.clip();

        ctx.globalCompositeOperation = "screen";
        const resplandor = ctx.createRadialGradient(cx, cy, 0, cx, cy, radio * 5.5);
        resplandor.addColorStop(0, rgba([255, 196, 130], 0.6 * (0.4 + 0.6 * tapa) * (1 - noche * 0.5)));
        resplandor.addColorStop(0.35, rgba([255, 140, 80], 0.28 * (1 - noche * 0.6)));
        resplandor.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = resplandor;
        ctx.beginPath();
        ctx.arc(cx, cy, radio * 5.5, 0, TAU);
        ctx.fill();

        ctx.globalCompositeOperation = "source-over";
        const disco = ctx.createRadialGradient(cx, cy, 0, cx, cy, radio * 1.3);
        const centro = mezclar(paleta.sol, [255, 220, 160], 0.35 + 0.3 * (1 - noche));
        disco.addColorStop(0, rgba(centro, 0.95 * tapa));
        disco.addColorStop(0.45, rgba(mezclar(paleta.sol, [235, 130, 80], 0.25), 0.85 * tapa));
        disco.addColorStop(0.78, rgba(mezclar(paleta.sol, [160, 60, 40], 0.5), 0.3 * tapa));
        disco.addColorStop(1, rgba(paleta.sol, 0));
        ctx.fillStyle = disco;
        ctx.beginPath();
        ctx.arc(cx, cy, radio * 1.3, 0, TAU);
        ctx.fill();

        ctx.restore();
        ctx.globalCompositeOperation = "source-over";

        // 5. El reflejo del sol se apaga: un oscurecimiento radial suave, sin
        // columnas ni bordes, que se funde con el agua.
        const apagar = tramo(p, 0.05, 0.85);
        if (apagar > 0) {
            ctx.globalCompositeOperation = "multiply";
            const cxRef = x0 + 970 * fit;
            const cyRef = yHorizonte + 170 * fit;
            const rad = Math.max(ancho, alto) * 0.3;
            const g = ctx.createRadialGradient(cxRef, cyRef, 0, cxRef, cyRef, rad);
            g.addColorStop(0, rgba([120, 116, 128], apagar));
            g.addColorStop(0.5, rgba([188, 178, 178], apagar * 0.55));
            g.addColorStop(1, rgba([255, 255, 255], 0));
            ctx.fillStyle = g;
            ctx.fillRect(x0, y0, ancho, alto);
        }
    }

    // --- 4. Cielo (dos dedos) --------------------------------------------

    function dibujarCielo(ctx, vista, x0, y0, ancho, alto) {
        const p = cielo;
        if (p <= 0.002 || nubesSprites.length === 0) return;

        const fit = vista.fit;
        const yHorizonte = y0 + (horizonte / dimensiones.alto) * (alto);
        const altoCielo = Math.max(1, yHorizonte - y0);

        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;

        // Nubes: sprites suaves que derivan a distintas velocidades.
        for (const nube of NUBES) {
            const sprite = nubesSprites[nube.variante % nubesSprites.length];
            const r = nube.r * ancho;
            const x = envolver(nube.r * ancho + nube.vel * nube.dir * tiempo, ancho + r * 2) - r;
            const y = y0 + nube.y * altoCielo;
            ctx.globalAlpha = nube.alfa * p;
            ctx.drawImage(sprite, x0 + x, y - r * 0.55, r * 2, r * 1.1);
        }
        ctx.globalAlpha = 1;

        // Rastros de viento: pinceladas cortas y curvas, con extremos
        // afinados; no líneas digitales rígidas.
        for (const rastro of RASTROS) {
            const largo = rastro.largo * ancho * 0.5;
            const x = envolver(rastro.vel * tiempo + rastro.fase * 60, ancho + largo) - largo;
            const y = y0 + rastro.y * altoCielo;
            const alfa = rastro.alfa * p;
            const curva = rastro.curva * fit * 3;
            const grosor = Math.max(1.5, rastro.grosor * fit * 2.6);
            ctx.fillStyle = rgba(mezclar(paleta.cieloClaro, [255, 250, 240], 0.3), alfa);
            ctx.beginPath();
            ctx.moveTo(x0 + x, y);
            ctx.bezierCurveTo(
                x0 + x + largo * 0.3,
                y - curva,
                x0 + x + largo * 0.7,
                y + curva * 0.4,
                x0 + x + largo,
                y - curva * 0.2
            );
            ctx.bezierCurveTo(
                x0 + x + largo * 0.7,
                y + curva * 0.4 + grosor,
                x0 + x + largo * 0.3,
                y - curva + grosor,
                x0 + x,
                y
            );
            ctx.closePath();
            ctx.fill();
        }
    }

    // --- 5. Tormenta ------------------------------------------------------

    function crearRayo() {
        semillaRayos = (semillaRayos * 1664525 + 1013904223) >>> 0;
        const a = azar(semillaRayos);
        const x = 160 + a() * (dimensiones.ancho - 320);
        const puntos = [];
        let px = x;
        let py = 40;
        const tramos = 8;
        const altoRayo = horizonte - 60;

        for (let i = 0; i <= tramos; i += 1) {
            puntos.push([px, py]);
            px += (a() - 0.5) * 70;
            py += altoRayo / tramos;
        }

        const ramas = [];
        for (let i = 0; i < 2; i += 1) {
            const base = puntos[3 + Math.floor(a() * 4)] || puntos[4];
            const rama = [[base[0], base[1]]];
            let bx = base[0];
            let by = base[1];
            for (let k = 0; k < 3; k += 1) {
                bx += (a() - 0.5) * 90;
                by += 30 + a() * 40;
                rama.push([bx, by]);
            }
            ramas.push(rama);
        }

        return {
            inicio: tiempo,
            duracion: 0.18 + a() * 0.3,
            puntos,
            ramas,
            destellos: 2 + Math.floor(a() * 3),
        };
    }

    function actualizarRayos() {
        if (tormenta < 0.15) {
            rayoActual = null;
            proximoRayo = 0;
            return;
        }

        if (!rayoActual) {
            if (proximoRayo === 0) {
                proximoRayo = tiempo + 0.8 + Math.random() * 1.6;
            } else if (tiempo >= proximoRayo) {
                rayoActual = crearRayo();
            }
            return;
        }

        if (tiempo >= rayoActual.inicio + rayoActual.duracion) {
            rayoActual = null;
            proximoRayo = tiempo + 1.4 + Math.random() * 3.2;
        }
    }

    function dibujarTormenta(ctx, vista, x0, y0, ancho, alto) {
        const p = tormenta;
        if (p <= 0.002) return;

        const fit = vista.fit;
        const yHorizonte = y0 + horizonte * fit;
        const altoCielo = Math.max(1, yHorizonte - y0);
        const hz = horizonte / dimensiones.alto;
        // Si el atardecer está activo, la tormenta oscurece menos: la escena
        // sigue legible cuando conviven las dos.
        const peso = p * (1 - 0.35 * atardecer);

        // Cielo plomizo y mar oscuro en un solo degradado, sin costuras.
        ctx.globalCompositeOperation = "multiply";
        const cielo = ctx.createLinearGradient(0, y0, 0, y0 + alto);
        cielo.addColorStop(0, rgba([30, 38, 58], 0.78 * peso));
        cielo.addColorStop(hz * 0.6, rgba([58, 68, 88], 0.66 * peso));
        cielo.addColorStop(hz, rgba([92, 100, 112], 0.5 * peso));
        cielo.addColorStop(Math.min(1, hz + 0.06), rgba([64, 78, 92], 0.46 * peso));
        cielo.addColorStop(1, rgba([40, 52, 66], 0.4 * peso));
        ctx.fillStyle = cielo;
        ctx.fillRect(x0, y0, ancho, alto);

        // Nubes de tormenta.
        ctx.globalCompositeOperation = "source-over";
        for (let i = 0; i < NUBES.length; i += 1) {
            const nube = NUBES[i];
            const sprite = nubesOscuras[i % nubesOscuras.length];
            const r = nube.r * ancho * 1.2;
            const x = envolver(nube.r * ancho + nube.vel * 1.8 * nube.dir * tiempo, ancho + r * 2) - r;
            const y = y0 + (nube.y * 0.8 + 0.04) * altoCielo;
            ctx.globalAlpha = 0.55 * p;
            ctx.drawImage(sprite, x0 + x, y - r * 0.5, r * 2, r);
        }
        ctx.globalAlpha = 1;

        // Nubes oscuras sobre el sol: lo dejan detrás de la tormenta.
        if (nubesOscuras.length > 0) {
            ctx.globalAlpha = 0.85 * p;
            ctx.drawImage(
                nubesOscuras[0],
                x0 + (sol.x - 380) * fit,
                y0 + (sol.y - 280) * fit,
                760 * fit,
                500 * fit
            );
            ctx.globalAlpha = 0.5 * p;
            ctx.drawImage(
                nubesOscuras[1 % nubesOscuras.length],
                x0 + (sol.x - 300) * fit,
                y0 + (sol.y - 220) * fit,
                600 * fit,
                400 * fit
            );
            ctx.globalAlpha = 1;
        }

        // El reflejo del sol se apaga bajo la tormenta: oscurecimiento radial
        // suave, sin columnas ni bordes rectos.
        ctx.globalCompositeOperation = "multiply";
        const cxRef = x0 + 970 * fit;
        const cyRef = yHorizonte + 170 * fit;
        const rad = Math.max(ancho, alto) * 0.32;
        const apagon = ctx.createRadialGradient(cxRef, cyRef, 0, cxRef, cyRef, rad);
        apagon.addColorStop(0, rgba([96, 108, 118], p));
        apagon.addColorStop(0.55, rgba([172, 174, 178], p * 0.75));
        apagon.addColorStop(1, rgba([255, 255, 255], 0));
        ctx.fillStyle = apagon;
        ctx.fillRect(x0, y0, ancho, alto);

        // Lluvia en tres capas de profundidad.
        ctx.globalCompositeOperation = "source-over";
        ctx.lineCap = "round";
        for (const gota of LLUVIA) {
            const yy = envolver(gota.y + tiempo * gota.vel, 1);
            const xx = envolver(gota.x + tiempo * 0.02, 1);
            const y = y0 + yy * alto;
            const x = x0 + xx * ancho;
            const largo = gota.largo * fit * (0.8 + p * 0.5);
            ctx.strokeStyle = rgba(mezclar(paleta.bruma, [212, 226, 244], 0.5), gota.alfa * p);
            ctx.lineWidth = Math.max(0.6, gota.grosor * fit);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - 3 * fit, y + largo);
            ctx.stroke();
        }

        // Rayo y destello ambiental.
        if (rayoActual) {
            const fase = limitar((tiempo - rayoActual.inicio) / Math.max(0.001, rayoActual.duracion), 0, 1);
            const parpadeo = Math.abs(Math.sin(fase * Math.PI * rayoActual.destellos));
            const intensidad = parpadeo * (1 - fase) * p;

            ctx.globalCompositeOperation = "screen";
            ctx.fillStyle = rgba([206, 220, 255], 0.28 * intensidad);
            ctx.fillRect(x0, y0, ancho, alto);

            ctx.save();
            ctx.globalCompositeOperation = "screen";
            ctx.strokeStyle = rgba([236, 244, 255], 0.95 * intensidad);
            ctx.lineWidth = Math.max(1.5, 2.4 * fit);
            ctx.shadowBlur = 18;
            ctx.shadowColor = "rgba(190, 215, 255, 0.9)";
            ctx.beginPath();
            ctx.moveTo(x0 + rayoActual.puntos[0][0] * fit, y0 + rayoActual.puntos[0][1] * fit);
            for (let i = 1; i < rayoActual.puntos.length; i += 1) {
                ctx.lineTo(x0 + rayoActual.puntos[i][0] * fit, y0 + rayoActual.puntos[i][1] * fit);
            }
            ctx.stroke();

            for (const rama of rayoActual.ramas) {
                ctx.beginPath();
                ctx.moveTo(x0 + rama[0][0] * fit, y0 + rama[0][1] * fit);
                for (let i = 1; i < rama.length; i += 1) {
                    ctx.lineTo(x0 + rama[i][0] * fit, y0 + rama[i][1] * fit);
                }
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.globalCompositeOperation = "source-over";
    }

    // --- Dibujo general ---------------------------------------------------

    function dibujar(p, vista) {
        if (!p || !vista || !paleta || !dimensiones) return;
        const ctx = p.drawingContext;
        if (!ctx) return;

        const x0 = vista.offsetX;
        const y0 = vista.offsetY;
        const ancho = vista.anchoDibujo;
        const alto = vista.altoDibujo;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, ancho, alto);
        ctx.clip();

        // Agua y barcos primero: el atardecer y la tormenta los iluminan.
        dibujarMar(ctx, vista, x0, y0, ancho, alto);
        dibujarFlota(ctx, vista);
        dibujarAtardecer(ctx, vista, x0, y0, ancho, alto);
        dibujarCielo(ctx, vista, x0, y0, ancho, alto);
        dibujarTormenta(ctx, vista, x0, y0, ancho, alto);

        ctx.restore();
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
    }

    // --- Actualización ----------------------------------------------------

    function actualizar(estado, dt) {
        const paso = Number.isFinite(dt) ? limitar(dt, 0, 0.05) : 1 / 60;
        tiempo += paso;

        const abierta = !!(estado && estado.vientoManos > 0);
        const objetivoMar = abierta ? 1 : 0;
        mar += (objetivoMar - mar) * Math.min(1, paso * 2.2);
        if (mar < 0.002) mar = 0;

        const velocidad =
            estado && Number.isFinite(estado.vientoVelocidad) && paso > 0
                ? Math.abs(estado.vientoVelocidad) / paso
                : 0;
        const objetivoVel = estado && estado.vientoManos > 0 ? Math.min(1, velocidad * 2.2) : 0;
        marVel += (objetivoVel - marVel) * Math.min(1, paso * 2);
        if (marVel < 0.002) marVel = 0;

        if (estado && estado.indice) {
            atardecer = limitar(atardecer + paso * 0.14, 0, 1);
        } else {
            atardecer = limitar(atardecer - paso * 0.35, 0, 1);
        }

        const objetivoCielo = estado && estado.paz ? 1 : 0;
        cielo += (objetivoCielo - cielo) * Math.min(1, paso * 2);
        if (cielo < 0.002) cielo = 0;

        let objetivoTormenta = 0;
        if (estado && Number.isFinite(estado.pinzaDistancia)) {
            objetivoTormenta = limitar((0.45 - estado.pinzaDistancia) / (0.45 - 0.28), 0, 1);
        }
        tormenta += (objetivoTormenta - tormenta) * Math.min(1, paso * 3);
        if (tormenta < 0.002) tormenta = 0;

        actualizarRayos();
    }

    // --- API --------------------------------------------------------------

    function configurar(obra, dims, imagen) {
        limpiar();
        if (!obra || !obra.sol || !dims) return;

        sol = { x: obra.sol.x, y: obra.sol.y, radio: obra.sol.radio };
        dimensiones = { ancho: dims.ancho, alto: dims.alto };
        horizonte = Number.isFinite(obra.horizonte) ? obra.horizonte : 620;
        barcosDatos = Array.isArray(obra.barcos) ? obra.barcos : [];
        fuente = imagen && (imagen.canvas || imagen.elt || imagen);
        paleta = extraerPaleta(imagen) || Object.assign({}, PALETA_BASE);

        prepararRecursos();
    }

    function limpiar() {
        mar = 0;
        marVel = 0;
        atardecer = 0;
        cielo = 0;
        tormenta = 0;
        tiempo = 0;

        flota.length = 0;
        capaSol = null;
        nubesSprites = [];
        nubesOscuras = [];
        rayoActual = null;
        proximoRayo = 0;

        fuente = null;
        paleta = null;
        barcosDatos = [];
        dimensiones = { ancho: 1600, alto: 1242 };
        horizonte = 620;
        sol = { x: 974, y: 384, radio: 28 };
    }

    function estados() {
        return {
            mar: mar,
            marVel: marVel,
            atardecer: atardecer,
            cielo: cielo,
            tormenta: tormenta,
            barcos: flota.length,
            rayo: !!rayoActual,
        };
    }

    return { configurar, limpiar, actualizar, dibujar, estados };
})();
