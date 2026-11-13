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
