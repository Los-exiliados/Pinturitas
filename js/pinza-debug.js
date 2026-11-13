// DEBUG TEMPORAL — Etapa 2: pinza.
//
// Muestra en un recuadro fijo (independiente de la pintura y del canvas de
// cámara) el estado de la pinza de cada mano detectada:
//   - distancia punta del pulgar ↔ punta del índice (relativa al tamaño de
//     la mano),
//   - estado: ABIERTA / CERRADA,
//   - si la lectura está estabilizada.
//
// Para retirarlo: borrar este archivo y su etiqueta <script> en index.html.

(function () {
  "use strict";

  let nodo = null;

  function construir() {
    nodo = document.createElement("div");
    nodo.id = "debug-pinza";
    nodo.setAttribute("aria-hidden", "true");
    nodo.style.cssText = [
      "position: fixed",
      "top: 12px",
      "left: 12px",
      "z-index: 9999",
      "padding: 10px 14px",
      "background: rgba(5, 7, 12, 0.82)",
      "border: 1px solid rgba(242, 233, 216, 0.35)",
      "border-radius: 6px",
      "color: #f2e9d8",
      "font: 12px/1.6 ui-monospace, Consolas, monospace",
      "white-space: pre",
      "pointer-events: none",
    ].join(";");
    document.body.append(nodo);
  }

  function etiqueta(estado) {
    if (estado === "cerrada") return "CERRADA";
    if (estado === "abierta") return "ABIERTA";
    return "—";
  }

  function refrescar() {
    if (typeof Gestures === "undefined" || typeof Gestures.pinzas !== "function") return;
    if (!nodo) construir();

    const pinzas = Gestures.pinzas();

    if (pinzas.length === 0) {
      nodo.textContent = "PINZA (debug)\nsin manos";
      return;
    }

    const lineas = pinzas.map(function (p) {
      return (
        "mano " + p.handIndex +
        " · " + p.distancia.toFixed(2) +
        " · " + etiqueta(p.estado) +
        (p.estable ? " · estable" : "")
      );
    });

    nodo.textContent = "PINZA (debug)\n" + lineas.join("\n");
  }

  function ciclo() {
    refrescar();
    window.requestAnimationFrame(ciclo);
  }

  construir();
  window.requestAnimationFrame(ciclo);
})();
