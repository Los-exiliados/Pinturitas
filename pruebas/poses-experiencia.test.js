"use strict";
// Regresión: ui.js es el único dueño de la leyenda del pie de la experiencia.
// Ejecutar desde la raíz: node --test pruebas/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const RAIZ = path.join(__dirname, "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function expandir(ns) {
  const salida = [];
  for (const n of ns) {
    if (n && n.tagName === "#fragment") { salida.push(...n.hijos); n.hijos = []; }
    else salida.push(n);
  }
  return salida;
}
function elemento(tag) {
  return {
    tagName: tag, className: "", title: "", textContent: "", attrs: {}, hijos: [],
    setAttribute(k, v) { this.attrs[k] = v; },
    append(...n) { this.hijos.push(...expandir(n)); },
    replaceChildren(...n) { this.hijos = expandir(n); },
  };
}
function documento(contenedor) {
  return {
    createElement: elemento,
    createDocumentFragment: () => elemento("#fragment"),
    getElementById: id => (id === "posesGestos" ? contenedor : null),
  };
}
function cargarObras() {
  const ctx = vm.createContext({});
  vm.runInContext(leer("js", "obras.js") + "\nglobalThis.catalogo = CatalogoObras;", ctx);
  return ctx.catalogo;
}
function cargarUi(doc) {
  const src = leer("js", "ui.js");
  const ini = src.indexOf("const POSES_POR_EFECTO");
  const fin = src.indexOf("// --- Configuración del gesto");
  assert.ok(ini > 0 && fin > ini, "ui.js conserva los marcadores del pie");
  const ctx = vm.createContext({ document: doc });
  vm.runInContext(src.slice(ini, fin) + "\nglobalThis.render = renderizarPosesExperiencia; globalThis.legado = POSES_LEGADO;", ctx);
  return ctx;
}
function tarjetas(cont) {
  return cont.hijos.map(t => ({
    className: t.className, title: t.title,
    icono: t.hijos[0].textContent, nombre: t.hijos[1].textContent, desc: t.hijos[2].textContent,
  }));
}
function render(ui, cont, obra) { cont.replaceChildren(); ui.render(obra); return tarjetas(cont); }

test("T1 gran-ola: 4 gestos en orden, con title no vacío", () => {
  const ola = cargarObras().find(o => o.id === "gran-ola");
  assert.equal(ola.poses, undefined, "gran-ola ya no declara poses");
  const cont = elemento("div");
  const r = render(cargarUi(documento(cont)), cont, ola);
  assert.deepEqual(r.map(t => [t.icono, t.nombre, t.desc]), [
    ["✋", "Palma", "Mover el mar"],
    ["☝️", "Índice", "Desatar la tormenta"],
    ["✌️", "Paz", "Abrir una corriente"],
    ["🤏", "Pinza", "Caer la noche"],
  ]);
  for (const t of r) { assert.equal(t.className, "pose"); assert.ok(t.title.trim(), "title no vacío: " + t.nombre); }
});

test("T2 otras obras: conservan sus tarjetas propias", () => {
  const cont = elemento("div");
  const ui = cargarUi(documento(cont));
  for (const obra of cargarObras().filter(o => o.id !== "gran-ola")) {
    const r = render(ui, cont, obra);
    assert.equal(r.length, obra.poses.length, obra.id);
    assert.deepEqual(r.map(t => [t.icono, t.nombre, t.desc, t.title]),
      Array.from(obra.poses, p => [p.icono, p.nombre, p.desc, p.nombre]), obra.id);
  }
});

test("T3 obra sin gestos ni poses: leyenda histórica", () => {
  const cont = elemento("div");
  const ui = cargarUi(documento(cont));
  const r = render(ui, cont, { id: "artificial", archivo: "x.jpg" });
  assert.deepEqual(r.map(t => [t.icono, t.nombre, t.desc]), Array.from(ui.legado, p => [p.icono, p.nombre, p.desc]));
  assert.equal(r.length, 4);
});

test("T4 sin campos vacíos; sin #posesGestos no lanza", () => {
  const cont = elemento("div");
  const ui = cargarUi(documento(cont));
  const obras = cargarObras().concat([{ id: "artificial" }]);
  for (const obra of obras) {
    for (const t of render(ui, cont, obra)) {
      for (const campo of ["icono", "nombre", "desc", "title"]) assert.ok(t[campo].trim(), `${obra.id} ${campo}`);
    }
  }
  const uiSin = cargarUi(documento(null));
  assert.doesNotThrow(() => uiSin.render(obras[0]));
});

test("T5 gamelogic ya no arma el pie ni toca #experiencia .poses", () => {
  const gl = leer("js", "gamelogic.js");
  assert.ok(!/mostrarPoses/.test(gl), "mostrarPoses eliminado");
  assert.ok(!/replaceChildren/.test(gl), "gamelogic no reemplaza hijos del pie");
  assert.ok(!/#experiencia \.poses/.test(gl), "gamelogic no busca el pie");
  assert.match(leer("js", "ui.js"), /contenedor\.replaceChildren\(\.\.\.datos\.map\(crearPose\)\)/);
});

test("T6 seleccionarObra es el único camino y renderiza el pie", () => {
  const ui = leer("js", "ui.js");
  assert.equal((ui.match(/Gamelogic\.abrir/g) || []).length, 1, "una sola llamada a Gamelogic.abrir");
  const cuerpo = ui.slice(ui.indexOf("function seleccionarObra("), ui.indexOf("function construir("));
  assert.match(cuerpo, /Gamelogic\.abrir\(obra\.id\)\)\s*\{\s*renderizarPosesExperiencia\(obra\);/);
});

test("T10 contrato de gestos sin tarjetas: cae a las tarjetas propias, nunca vacío", () => {
  const cont = elemento("div");
  const ui = cargarUi(documento(cont));
  const propia = { icono: "✊", nombre: "Puño", desc: "Iniciar" };

  const vacio = render(ui, cont, { id: "gestos-vacio", gestos: {}, poses: [propia] });
  assert.deepEqual(vacio.map(t => [t.icono, t.nombre, t.desc]), [["✊", "Puño", "Iniciar"]]);

  const typo = render(ui, cont, { id: "efecto-typo", gestos: { palma: { efecto: "no-existe" } }, poses: [propia] });
  assert.deepEqual(typo.map(t => [t.icono, t.nombre, t.desc]), [["✊", "Puño", "Iniciar"]]);

  const soloTypo = render(ui, cont, { id: "efecto-typo-sin-poses", gestos: { palma: { efecto: "no-existe" } } });
  assert.deepEqual(soloTypo.map(t => [t.icono, t.nombre, t.desc]), Array.from(ui.legado, p => [p.icono, p.nombre, p.desc]));
});

// Regresi�n: en la galer�a el me�ique elige y solo abrir la palma entra.
test("T11 galer�a: me�ique elige, palma entra, sin pique", () => {
  const ui = leer("js", "ui.js");
  assert.ok(!/picarPuntero/.test(ui), "el pique del me�ique ya no existe");
  assert.ok(!/piqueMs|framesPique|retroceso/.test(ui), "config del pique eliminada");
  assert.match(ui, /gesto: "open_palm"/, "la entrada por palma est� declarada");
  assert.match(ui, /evento\.gesture === ENTRADA_PALMA\.gesto/, "gesturestart despacha la palma");
  assert.match(ui, /seleccionarObra\(obra, tarjeta\)/, "la palma usa el �nico camino de selecci�n");
  assert.match(ui, /puntero\.elegida = tarjeta/, "el me�ique recuerda la obra elegida");
  assert.equal((ui.match(/Gamelogic\.abrir/g) || []).length, 1, "sigue habiendo una sola llamada a abrir");
});

test("T12 ayuda de la galer�a indica elegir con me�ique y entrar con palma", () => {
  const html = leer("index.html");
  const seccion = html.slice(html.indexOf('id="galeria"'), html.indexOf("id=" + '"' + "experiencia" + '"'));
  assert.match(seccion, /Elegir obra/, "el meñique elige");
  assert.match(seccion, /Entrar<\/span>/, "la palma entra");
});
