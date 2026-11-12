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

const CatalogoObras = [
    {
        id: "noche-estrellada",
        titulo: "La noche estrellada",
        autor: "Vincent van Gogh",
        anio: 1889,
        tema: "noche",
        archivo: "obras/noche-estrellada.jpg",
        zonas: [
            {
                nombre: "remolino grande",
                x: 0.42,
                y: 0.22,
                radio: 0.13,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino izquierdo",
                x: 0.16,
                y: 0.16,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino derecho",
                x: 0.70,
                y: 0.10,
                radio: 0.08,
                efecto: "remolino",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "remolino abajo",
                x: 0.45,
                y: 0.62,
                radio: 0.09,
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
