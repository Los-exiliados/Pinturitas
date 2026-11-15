// Catálogo de pinturas de Pinceladas de Vida.
//
// Fuente de datos única de la colección: títulos, autores, años, temas y
// rutas de imagen. ui.js consume este catálogo para construir la galería y
// gamelogic.js lo usa para arrancar la experiencia con la obra elegida.
//
// Cómo incorporar una pintura nueva:
//   1. Copiá la imagen dentro de `obras/`.
//   2. Completá su campo `archivo`, por ejemplo:
//          archivo: "obras/gran-ola.jpg"
//   3. Listo: la galería muestra la foto real sobre el arte provisional y
//      la obra queda disponible para la experiencia.
// Mientras `archivo` esté vacío no se pide ninguna imagen al servidor.
//
// Las zonas interactivas se definen por obra en el campo `zonas`:
//   { nombre, x, y, radio, efecto, fuerza, act: 0 }
// - `x` e `y` son coordenadas normalizadas sobre el ancho y el alto de la
//   imagen (0 a 1).
// - `radio` es la fracción del lado menor de la imagen.
// - `efecto` hoy sólo implementa "remolino"; `fuerza` su intensidad.
// - `act` arranca en 0 y es el motor quien la suaviza en runtime.
//
// Los gestos también son por obra, en el campo `gestos`. Es el único lugar
// donde se decide qué hace cada gesto en cada pintura: una obra sin `gestos`
// no reacciona a ningún gesto, y lo que declare una no se hereda a otra.
//   gestos: { palma: { efecto: "oleaje", ... } }
//
// `mascara` es la ruta de un PNG en escala de grises que delimita la región
// móvil de la obra (blanco = se mueve, negro = queda quieto). Sólo la usan
// los efectos que deforman una parte de la pintura, como el oleaje.
//
// Los emisores de espuma se definen en el campo `espuma`:
//   { x, y }
// - Coordenadas normalizadas sobre la imagen (0 a 1).
// - Son puntos EXTRA: además, el motor deriva emisores de la línea de agua
//   de la máscara, así salpican todas las crestas de la obra.
//
// Las barcas se definen en el campo `barcas`:
//   { x, y, rx, ry, fase, bob, deriva, inclina }
// - Elipse en coordenadas normalizadas; `fase` las desincroniza.
// - `bob` (px), `deriva` (px) e `inclina` (radianes) son su movimiento
//   propio cuando el agua está viva o la corriente pasa por encima.
//
// Los cuerpos celestes iluminables se definen en el campo `cuerpos`:
//   { nombre, x, y, radio }
// - `x` e `y` están en PÍXELES de la imagen original (no normalizados).
// - `radio` delimita la zona visual del resplandor, también en píxeles.
// - No son zonas de selección: la pinza controla todos los cuerpos a la vez.

const CatalogoObras = [
    {
        id: "noche-estrellada",
        titulo: "La noche estrellada",
        autor: "Vincent van Gogh",
        anio: 1889,
        tema: "noche",
        archivo: "obras/noche-estrellada.jpg",
        cuerpos: [
            { nombre: "luna creciente", x: 1505, y: 180, radio: 130 },
            { nombre: "estrella 1", x: 85, y: 289, radio: 58 },
            { nombre: "estrella 2", x: 724, y: 545, radio: 72 },
            { nombre: "estrella 3", x: 583, y: 181, radio: 60 },
            { nombre: "luz 1", x: 1857, y: 932, radio: 28 },
            { nombre: "luz 2", x: 1213, y: 930, radio: 28 },
            { nombre: "luz 3", x: 1393, y: 992, radio: 28 },
            { nombre: "luz 4", x: 1803, y: 1016, radio: 28 },
            { nombre: "luz 5", x: 930, y: 941, radio: 28 },
        ],
        zonas: [
            {
                nombre: "remolino 1",
                x: 0.08,
                y: 0.13,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino 2",
                x: 0.04,
                y: 0.41,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino 3",
                x: 0.46,
                y: 0.25,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino 4",
                x: 0.59,
                y: 0.47,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino 5",
                x: 0.97,
                y: 0.24,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino 6",
                x: 0.95,
                y: 0.42,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
        ],
    },
    {
        id: "caminante",
        titulo: "El caminante sobre el mar de nubes",
        autor: "Caspar David Friedrich",
        anio: 1818,
        tema: "caminante",
        archivo: "obras/el-caminante-sobre-el-mar-de-nubes.jpg",
        zonas: [],
    },
    {
        id: "gran-ola",
        titulo: "La gran ola de Kanagawa",
        autor: "Katsushika Hokusai",
        anio: 1831,
        tema: "ola",
        archivo: "obras/la-gran-ola-de-kanagawa.jpg",
        mascara: "obras/la-gran-ola-mascara.png",
        gestos: {
            // La palma abierta arrastra el mar y los barcos en horizontal.
            // El cielo, el Fuji y el cartucho quedan quietos (máscara).
            palma: {
                efecto: "oleaje",
                desplazamiento: 0.06, // tope de corrimiento, fracción del ancho
                sensibilidad: 3.2, // recorrido de la mano -> corrimiento
                rigidez: 15, // resorte del agua (1/s²): más bajo, más peso
                amortiguacion: 7.8, // casi crítico: llega sin rebotar
                profundidad: 0.35, // el agua de abajo acompaña más
                desvio: 0.16, // cuánto se diferencian las franjas de agua
                vaiven: 16, // ondulación vertical con el mar en movimiento
                reposo: 7, // ondulación vertical con la palma delante
                avivar: 3.5, // velocidad con que la palma despierta el mar
                dormir: 1.2, // velocidad con que se duerme al irse la palma
                retorno: 2.2, // segundos para acomodarse sin palma
            },
            // Índice extendido: la obra entera entra en tormenta, el cielo
            // se oscurece, cae lluvia y la espuma salpica.
            point: {
                efecto: "tormenta",
                oscuridad: 0.30, // tinte frío sobre la pintura
                frialdad: 0.40, // cuánto vira al azul
                gotas: 150, // gotas de lluvia simultáneas
                salpicaduras: 36, // salpicaduras por segundo desde la espuma
                agitacion: 30, // chapoteo vertical del mar, en px de imagen
                rayos: 1.6, // segundos medios entre rayos a tormenta plena
                entrada: 2.2, // velocidad con que se desata la tormenta
                salida: 0.8, // velocidad con que escampa
            },
            // Dos dedos (una mano): corriente que atraviesa el mar.
            peace: {
                efecto: "corriente",
                amplitud: 52, // px de arrastre a lo largo del canal
                ancho: 0.12, // ancho mínimo del canal, fracción del ancho
                avance: 0.14, // cuánto crece el ancho con el largo del canal
                agitacion: 18, // px de chapoteo dentro del canal
                espuma: 34, // partículas por segundo viajando
                entrada: 3.0, // velocidad con que se abre la corriente
                salida: 1.2, // velocidad con que se cierra
            },
            // Pinza: cae la noche. El cuadro se vuelve azul profundo,
            // aparecen estrellas y el mar se agita. Al abrir, vuelve el día.
            pinza: {
                efecto: "noche",
                oscuridad: 0.55, // tinte nocturno sobre la pintura
                frialdad: 0.85, // cuánto vira al azul
                agitacion: 26, // chapoteo vertical del mar, en px de imagen
                estrellas: 70, // estrellas en el cielo
                entrada: 0.9, // velocidad con que cae la noche (1/s)
                salida: 1.3, // velocidad con que amanece (1/s)
            },
        },
        // Cuerpo celeste que aparece con la pinza: el sol se pone en la
        // transición y la luna queda en la noche plena. En reposo no hay
        // astro: la pintura queda original.
        astro: { x: 0.82, y: 0.16, radio: 0.034 },
        // Cresta de la ola: de acá salen las salpicaduras.
        espuma: [
            { x: 0.14, y: 0.37 },
            { x: 0.18, y: 0.30 },
            { x: 0.22, y: 0.22 },
            { x: 0.27, y: 0.15 },
            { x: 0.32, y: 0.11 },
            { x: 0.37, y: 0.10 },
            { x: 0.42, y: 0.11 },
            { x: 0.47, y: 0.14 },
            { x: 0.51, y: 0.19 },
            { x: 0.55, y: 0.25 },
            { x: 0.59, y: 0.30 },
            // Ola inferior izquierda.
            { x: 0.03, y: 0.80 },
            { x: 0.07, y: 0.82 },
            { x: 0.11, y: 0.85 },
        ],
        // Barcas: cada una se mueve por su cuenta (vaivén, inclinación y
        // deriva) cuando el agua está viva o la corriente pasa por encima.
        // Las elipses coinciden con las que la máscara fuerza como agua.
        barcas: [
            { x: 0.205, y: 0.675, rx: 0.110, ry: 0.058, fase: 0.0, bob: 7, deriva: 4, inclina: 0.030 },
            { x: 0.666, y: 0.742, rx: 0.115, ry: 0.032, fase: 1.7, bob: 6, deriva: 5, inclina: 0.026 },
            { x: 0.865, y: 0.745, rx: 0.085, ry: 0.045, fase: 3.1, bob: 7, deriva: 4, inclina: 0.032 },
            { x: 0.600, y: 0.848, rx: 0.205, ry: 0.055, fase: 4.6, bob: 8, deriva: 6, inclina: 0.022 },
        ],
        zonas: [],
    },
    {
        id: "impresion-sol-naciente",
        titulo: "Impresión, sol naciente",
        autor: "Claude Monet",
        anio: 1872,
        tema: "impresion",
        archivo: "obras/impresion-sol-naciente.jpg",
        zonas: [],
    },
    {
        id: "persistencia-memoria",
        titulo: "La persistencia de la memoria",
        autor: "Salvador Dalí",
        anio: 1931,
        tema: "persistencia",
        archivo: "obras/la-persistencia-de-la-memoria.jpg",
        zonas: [],
    },
    {
        id: "composicion-viii",
        titulo: "Composición VIII",
        autor: "Wassily Kandinsky",
        anio: 1923,
        tema: "composicion",
        archivo: "obras/composicion-8.jpg",
        zonas: [],
    },
];
