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
// - `efecto` es "remolino", "empujar" o "estrella"; `fuerza` su intensidad.
// - `act` arranca en 0 y es el motor quien la suaviza en runtime.
//
// Los cuerpos celestes iluminables se definen en el campo `cuerpos`:
//   { nombre, x, y, radio }
// - `x` e `y` están en PÍXELES de la imagen original (no normalizados).
// - `radio` delimita la zona visual del resplandor, también en píxeles.
// - No son zonas de selección: la pinza controla todos los cuerpos a la vez.
//
// Las obras con interacciones propias declaran el módulo que las atiende en
// el campo `efectos`, más sus anclajes en píxeles de la imagen original:
//   efectos: "monet"
//   sol: { x, y, radio }
// Las obras sin `efectos` no ejecutan ningún código de interacción propio.

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
        zonas: [],
    },
    {
        id: "impresion-sol-naciente",
        titulo: "Impresión, sol naciente",
        autor: "Claude Monet",
        anio: 1872,
        tema: "impresion",
        archivo: "obras/impresion-sol-naciente.jpg",
        efectos: "monet",
        // Coordenadas medidas sobre la imagen original (1600 × 1242).
        sol: { x: 974, y: 384, radio: 28 },
        // Línea del horizonte: separa el cielo del agua.
        horizonte: 620,
        // Barcos: región que se anima, en píxeles de la imagen.
        barcos: [
            { x: 216, y: 670, ancho: 130, alto: 52, fase: 0.0 },
            { x: 388, y: 747, ancho: 172, alto: 62, fase: 1.9 },
            { x: 688, y: 805, ancho: 165, alto: 145, fase: 3.4 },
        ],
        // Qué hace cada gesto en esta obra. El pie de la experiencia muestra
        // estas descripciones; las obras sin `poses` conservan las suyas.
        poses: {
            indice: {
                desc: "El atardecer",
                titulo: "Índice extendido: el sol se pone detrás del horizonte y la escena anochece",
            },
            paz: {
                desc: "El cielo se mueve",
                titulo: "Dos dedos: las nubes y las corrientes de aire recorren el cielo",
            },
            pinza: {
                desc: "Tormenta eléctrica",
                titulo: "Pinza: diluvio, relámpagos y un mar agitado",
            },
            palma: {
                desc: "El mar cobra vida",
                titulo: "Palma abierta: olas continuas, el reflejo se quiebra y los barcos flotan",
            },
        },
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
