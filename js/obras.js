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
// Los gestos globales de la palma (viento) y de la paz (meteoritos) se
// activan por obra con los campos `viento: true` y `meteoritos: true`.
// Sin esos campos, el gesto queda inactivo en esa obra: así cada pintura
// puede darle a los mismos gestos funciones distintas.
//
// Las tarjetas del pie de la experiencia se definen por obra en `poses`:
//   { icono, nombre, desc }
// El pie se arma según la obra abierta, mostrando solo las interacciones
// que esa pintura tiene activas.
//
// La pinza puede tener dos funciones según la obra: si la obra define
// `pinzaEfecto: "profundidad"`, la distancia entre los dedos controla la
// profundidad visual; si no, la pinza cerrada enciende los `cuerpos`.
//
// El aura del personaje se define en `personaje`: un PNG del mismo tamaño
// que la pintura con fondo transparente y solo el personaje visible. Al
// hacer zoom, el personaje se ilumina y se genera un halo difuminado que
// sigue su silueta.
//
// La palma puede cambiar la atmósfera de la obra con `palmEfecto:
// "atmósfera"`: la altura de la mano recorre despejado, nublado y oscuro.

const CatalogoObras = [
    {
        id: "noche-estrellada",
        titulo: "La noche estrellada",
        autor: "Vincent van Gogh",
        anio: 1889,
        tema: "noche",
        archivo: "obras/noche-estrellada.jpg",
        viento: true,
        meteoritos: true,
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
            { icono: "✋", nombre: "Palma", desc: "Viento" },
            { icono: "☝️", nombre: "Índice", desc: "Girar remolinos" },
            { icono: "✌️", nombre: "Paz", desc: "Lluvia de meteoritos" },
            { icono: "🤏", nombre: "Pinza", desc: "Iluminar la noche" },
        ],
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
        pazEfecto: "tormenta",
        pinzaEfecto: "profundidad",
        palmEfecto: "atmosfera",
        indiceEfecto: "despejar",
        luces: [],
        fondo: "obras/fondo-caminante.png",
        baseAtmosfera: "obras/nofondo-caminante.png",
        personaje: "obras/personaje-caminante.png",
        despeje: "obras/caminante-relleno.png",
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
            { icono: "☝️", nombre: "Índice", desc: "Despejar la niebla" },
            { icono: "✋", nombre: "Palma", desc: "Atardecer / Anochecer" },
            { icono: "✌️", nombre: "Paz", desc: "Tormenta" },
            { icono: "🤏", nombre: "Pinza", desc: "Profundidad" },
        ],
        zonas: [],
    },
    {
        id: "gran-ola",
        titulo: "La gran ola de Kanagawa",
        autor: "Katsushika Hokusai",
        anio: 1831,
        tema: "ola",
        archivo: "obras/la-gran-ola-de-kanagawa.jpg",
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
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
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
        ],
        zonas: [],
    },
    {
        id: "persistencia-memoria",
        titulo: "La persistencia de la memoria",
        autor: "Salvador Dalí",
        anio: 1931,
        tema: "persistencia",
        archivo: "obras/la-persistencia-de-la-memoria.jpg",
        pazEfecto: "ojos",
        ojos: "obras/ojos-efecto.mp4",
        palmEfecto: "sueno",
        indiceEfecto: "disolver",
        manecillas: "obras/persistencia-manecillas.png",
        relojes: "obras/persistencia-relojes.png",
        pinzaEfecto: "derretir",
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
            { icono: "☝️", nombre: "Índice", desc: "Multiverso" },
            { icono: "✋", nombre: "Palma", desc: "Universo onírico" },
            { icono: "✌️", nombre: "Paz", desc: "Cerrar los ojos" },
            { icono: "🤏", nombre: "Pinza", desc: "Derretir los relojes" },
        ],
        zonas: [
            {
                nombre: "reloj colgado",
                x: 0.355,
                y: 0.32,
                radio: 0.12,
                efecto: "derretir",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "reloj del mantel",
                x: 0.215,
                y: 0.66,
                radio: 0.13,
                efecto: "derretir",
                fuerza: 1.0,
                act: 0,
            },
            {
                nombre: "reloj del rostro",
                x: 0.52,
                y: 0.615,
                radio: 0.08,
                efecto: "derretir",
                fuerza: 1.0,
                act: 0,
            },
        ],
    },
    {
        id: "composicion-viii",
        titulo: "Composición VIII",
        autor: "Wassily Kandinsky",
        anio: 1923,
        tema: "composicion",
        archivo: "obras/composicion-8.jpg",
        poses: [
            { icono: "✊", nombre: "Puño", desc: "Iniciar" },
        ],
        zonas: [],
    },
];
