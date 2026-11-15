"use strict";
// Estructura del pie: el chip de salida no vive dentro de #posesGestos y el
// contenedor generado no aporta caja al flex.  Ejecutar: node --test pruebas/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RAIZ = path.join(__dirname, "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const VACIOS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
function parsear(html) {
  const raiz = { tag: "#raiz", attrs: {}, hijos: [], padre: null };
  const pila = [raiz];
  const re = /<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const tag = m[1].toLowerCase();
      let i = -1;
      for (let k = pila.length - 1; k >= 1; k--) if (pila[k].tag === tag) { i = k; break; }
      if (i > 0) pila.length = i;
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      const ar = /([^\s=/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ""))) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? "";
      const nodo = { tag, attrs, hijos: [], padre: pila[pila.length - 1] };
      pila[pila.length - 1].hijos.push(nodo);
      if (!VACIOS.has(tag) && !/\/\s*$/.test(m[3] || "")) pila.push(nodo);
    }
  }
  return raiz;
}
const clases = n => (n.attrs.class || "").split(/\s+/).filter(Boolean);
const todos = (n, acc = []) => { for (const h of n.hijos) { acc.push(h); todos(h, acc); } return acc; };

test("T7 #posesGestos es el contenedor generado dentro de .poses", () => {
  const raiz = parsear(leer("index.html"));
  const experiencia = todos(raiz).find(n => n.attrs.id === "experiencia");
  assert.ok(experiencia, "#experiencia existe");
  const sub = todos(experiencia);
  const gestos = sub.find(n => n.attrs.id === "posesGestos");
  assert.ok(gestos, "#posesGestos existe");
  assert.ok(clases(gestos.padre).includes("poses"), "#posesGestos cuelga de .poses");
});

test("T8 el chip de salida del pie no está dentro de #posesGestos", () => {
  const raiz = parsear(leer("index.html"));
  const experiencia = todos(raiz).find(n => n.attrs.id === "experiencia");
  const sub = todos(experiencia);
  const chips = sub.filter(n => clases(n).includes("pose--salida"));
  assert.equal(chips.length, 1, "un chip de salida en el pie");
  let c = chips[0].padre, dentro = false;
  while (c) { if (c.attrs.id === "posesGestos") dentro = true; c = c.padre; }
  assert.equal(dentro, false, "reemplazar #posesGestos no borra el chip");
});

test("T9 .poses-gestos no aporta caja al flex del pie", () => {
  assert.match(leer("estilos.css"), /\.poses-gestos\s*\{[^}]*display:\s*contents/);
});
