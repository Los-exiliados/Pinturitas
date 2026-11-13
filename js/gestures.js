// Reconocimiento de gestos a partir de los 21 landmarks que publica handpose.js.
//
// Contrato de entrada (no se modifica): handpose.js deja en el scope global el
// arreglo `hands` con hasta cuatro elementos:
//
//   [ { anchorX, anchorY, keypoints: [ { x, y } ] x 21 }, ... ]
//
// - Las coordenadas están en píxeles del video.
// - Ya vienen espejadas porque handpose.js usa flipHorizontal: true, así que
//   "derecha" en los datos es "derecha" en lo que ve el usuario.
// - Los objetos `hand` se reutilizan entre frames cuando el seguimiento de
//   handpose.js asocia la mano con la del frame anterior. Eso nos da una
//   identidad estable por referencia, que es la base del seguimiento de acá.
//
// Este archivo no dibuja, no toca el DOM y no depende de p5: solo clasifica y
// emite eventos para que gamelogic.js los consuma más adelante.
//
// Además de los gestos de postura, calcula por mano el estado de la pinza
// (punta del pulgar ↔ punta del índice). Ese estado NO emite eventos: se lee
// desde los snapshots (campo `pinza`) o con Gestures.pinzas().

(function (global) {
  "use strict";

  // --- Landmarks (índices estándar MediaPipe / HandPose) -------------------

  const LM = {
    WRIST: 0,
    THUMB_CMC: 1,
    THUMB_MCP: 2,
    THUMB_IP: 3,
    THUMB_TIP: 4,
    INDEX_MCP: 5,
    INDEX_PIP: 6,
    INDEX_DIP: 7,
    INDEX_TIP: 8,
    MIDDLE_MCP: 9,
    MIDDLE_PIP: 10,
    MIDDLE_DIP: 11,
    MIDDLE_TIP: 12,
    RING_MCP: 13,
    RING_PIP: 14,
    RING_DIP: 15,
    RING_TIP: 16,
    PINKY_MCP: 17,
    PINKY_PIP: 18,
    PINKY_DIP: 19,
    PINKY_TIP: 20,
  };

  // Dedos largos: el ángulo en el PIP distingue extendido de flexionado.
  const LONG_FINGERS = [
    { key: "index", mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, tip: LM.INDEX_TIP },
    { key: "middle", mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, tip: LM.MIDDLE_TIP },
    { key: "ring", mcp: LM.RING_MCP, pip: LM.RING_PIP, tip: LM.RING_TIP },
    { key: "pinky", mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, tip: LM.PINKY_TIP },
  ];

  // --- Parámetros de calibración ------------------------------------------
  // Todos los umbrales son relativos: ángulos o fracciones del tamaño de la
  // mano / del frame. No hay píxeles fijos, así que funciona igual cerca o
  // lejos de la cámara.

  const TUNING = Object.freeze({
    // Clasificación de dedos con histéresis.
    EXTENDED_ANGLE: 150, // por encima de esto, dedo extendido
    CURLED_ANGLE: 105, // por debajo de esto, dedo flexionado
    // El pulgar se considera abierto si su punta se aleja de la palma.
    THUMB_OPEN_REACH: 0.95,

    // Tiempos de estabilidad para las posturas.
    STABLE_MS: 120,
    RELEASE_MS: 200,

    // Ciclo de vida del seguimiento.
    MISS_END_MS: 250, // sin ver la mano: se cierra el gesto activo
    TRACK_TTL_MS: 1000, // sin ver la mano: se descarta el estado
    REBIND_HAND_SIZE: 0.6, // reasociación por ancla, en tamaños de mano
  });

  // --- Geometría ----------------------------------------------------------

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function centroid(points) {
    let x = 0;
    let y = 0;
    for (const p of points) {
      x += p.x;
      y += p.y;
    }
    return { x: x / points.length, y: y / points.length };
  }

  // Ángulo interior en `b` del triángulo a-b-c, en grados.
  function angleAt(a, b, c) {
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const n1 = Math.hypot(v1x, v1y);
    const n2 = Math.hypot(v2x, v2y);
    if (n1 === 0 || n2 === 0) return 0;
    const cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * (180 / Math.PI);
  }

  // Tamaño de referencia de la mano: muñeca -> base del dedo medio.
  function handSize(keypoints) {
    const size = dist(keypoints[LM.WRIST], keypoints[LM.MIDDLE_MCP]);
    return size > 0 ? size : 0;
  }

  function palmCenter(keypoints) {
    return centroid([
      keypoints[LM.WRIST],
      keypoints[LM.INDEX_MCP],
      keypoints[LM.MIDDLE_MCP],
      keypoints[LM.RING_MCP],
      keypoints[LM.PINKY_MCP],
    ]);
  }

  // --- Clasificación de dedos con memoria ---------------------------------
  // La banda intermedia conserva la clasificación anterior: eso evita que un
  // dedo parpadee entre extendido y flexionado por ruido del modelo.

  function resolveBend(angle, previous) {
    if (angle >= TUNING.EXTENDED_ANGLE) return "extended";
    if (angle <= TUNING.CURLED_ANGLE) return "curled";
    if (previous === "extended" || previous === "curled") return previous;
    const middle = (TUNING.EXTENDED_ANGLE + TUNING.CURLED_ANGLE) / 2;
    return angle >= middle ? "extended" : "curled";
  }

  function updateFingers(keypoints, memory) {
    for (const finger of LONG_FINGERS) {
      const angle = angleAt(keypoints[finger.mcp], keypoints[finger.pip], keypoints[finger.tip]);
      memory[finger.key] = resolveBend(angle, memory[finger.key]);
    }
    const thumbAngle = angleAt(keypoints[LM.WRIST], keypoints[LM.THUMB_CMC], keypoints[LM.THUMB_MCP]);
    memory.thumb = resolveBend(thumbAngle, memory.thumb);
    return memory;
  }

  // --- Clasificación de postura -------------------------------------------
  // Devuelve uno de: "fist" | "point" | "peace" | "open_palm" | null.

  function classifyPosture(keypoints, state, size) {
    const fingers = state.fingers;

    let extendedCount = 0;
    for (const finger of LONG_FINGERS) {
      if (fingers[finger.key] === "extended") extendedCount += 1;
    }

    const palm = palmCenter(keypoints);
    const thumbTip = keypoints[LM.THUMB_TIP];

    const thumbReach = dist(thumbTip, palm) / size;

    // Puño: los cuatro dedos largos flexionados (el pulgar no se exige).
    if (extendedCount === 0) return "fist";

    // Índice: solo el índice extendido.
    if (extendedCount === 1 && fingers.index === "extended") return "point";

    // Paz: índice y medio extendidos, el resto flexionados.
    if (
      extendedCount === 2 &&
      fingers.index === "extended" &&
      fingers.middle === "extended"
    ) {
      return "peace";
    }

    // Palma abierta: los cuatro largos extendidos y el pulgar desplegado.
    if (extendedCount === 4 && (fingers.thumb === "extended" || thumbReach >= TUNING.THUMB_OPEN_REACH)) {
      return "open_palm";
    }

    return null;
  }

  // --- Pinza (pulgar + índice) ---------------------------------------------
  // Estado continuo por mano: la distancia entre la punta del pulgar y la
  // punta del índice, normalizada por el tamaño de la mano (funciona igual
  // cerca o lejos de la cámara). Dos umbrales con histéresis y un debounce
  // corto evitan que el estado parpadee cuando los dedos rondan el límite.
  // No emite gesturestart/gestureend: se consume por frame desde los
  // snapshots (campo `pinza`) o con Gestures.pinzas().

  const PINZA = Object.freeze({
    CERRAR: 0.3, // por debajo de esto: pinza cerrada
    ABRIR: 0.45, // por encima de esto: pinza abierta
    ESTABLE_MS: 100, // la nueva lectura debe sostenerse este tiempo
  });

  function actualizarPinza(state, keypoints, size, now) {
    const distancia = dist(keypoints[LM.THUMB_TIP], keypoints[LM.INDEX_TIP]) / size;

    // Histéresis: entre los dos umbrales se conserva el estado actual.
    let candidata = state.pinza;
    if (distancia <= PINZA.CERRAR) candidata = "cerrada";
    else if (distancia >= PINZA.ABRIR) candidata = "abierta";
    if (candidata === null) candidata = "abierta";

    if (candidata !== state.pinzaCandidata) {
      state.pinzaCandidata = candidata;
      state.pinzaCandidataDesde = now;
    }

    if (now - state.pinzaCandidataDesde >= PINZA.ESTABLE_MS && state.pinza !== state.pinzaCandidata) {
      state.pinza = state.pinzaCandidata;
      state.pinzaDesde = now;
    }

    state.pinzaDistancia = distancia;
  }

  // --- Estado por mano ----------------------------------------------------

  let nextId = 1;

  function createState(id) {
    return {
      id,
      handIndex: -1,
      lastSeen: 0,
      anchorX: 0,
      anchorY: 0,
      position: { x: 0, y: 0 },
      fingers: { thumb: null, index: null, middle: null, ring: null, pinky: null },
      candidate: null,
      candidateAt: 0,
      posture: null,
      active: null,
      pinza: null,
      pinzaCandidata: null,
      pinzaCandidataDesde: 0,
      pinzaDesde: 0,
      pinzaDistancia: null,
    };
  }

  // El estado se indexa por la referencia del objeto `hand` que publica
  // handpose.js: mientras el seguimiento lo reutilice, la identidad persiste.
  const states = new Map();

  function adoptState(hand, size, now, claimed) {
    let best = null;
    let bestDistance = Infinity;

    for (const [object, state] of states) {
      if (claimed.has(state)) continue;
      if (now - state.lastSeen > TUNING.TRACK_TTL_MS) continue;
      const d = Math.hypot(hand.anchorX - state.anchorX, hand.anchorY - state.anchorY);
      if (d < bestDistance) {
        bestDistance = d;
        best = { object, state };
      }
    }

    if (best && bestDistance <= size * TUNING.REBIND_HAND_SIZE) {
      states.delete(best.object);
      return best.state;
    }

    return createState(nextId++);
  }

  // --- Eventos ------------------------------------------------------------

  const listeners = { gesturestart: [], gestureend: [] };

  function emit(type, payload) {
    const list = listeners[type];
    if (!list) return;
    for (const fn of list.slice()) {
      try {
        fn(payload);
      } catch (error) {
        console.error("Error en un listener de gestos:", error);
      }
    }
  }

  function eventPayload(state, now) {
    const active = state.active;
    return {
      handId: state.id,
      handIndex: state.handIndex,
      gesture: active ? active.gesture : null,
      direction: active ? active.direction : null,
      kind: active ? active.kind : null,
      posture: state.posture,
      at: now,
      duration: active ? Math.max(0, now - active.startedAt) : 0,
      position: { x: state.position.x, y: state.position.y },
    };
  }

  function startActive(state, gesture, direction, now, kind, holdMs) {
    state.active = {
      gesture,
      direction: direction || null,
      kind,
      startedAt: now,
      expiresAt: holdMs ? now + holdMs : null,
    };
    emit("gesturestart", eventPayload(state, now));
  }

  function endActive(state, now) {
    if (!state.active) return;
    const payload = eventPayload(state, now);
    state.active = null;
    emit("gestureend", payload);
  }

  // --- Paso de reconocimiento por mano ------------------------------------

  function step(state, hand, now, size) {
    const keypoints = hand.keypoints;

    updateFingers(keypoints, state.fingers);
    const posture = classifyPosture(keypoints, state, size);

    // Debounce de postura: se declara estable recién después de STABLE_MS.
    if (posture !== state.candidate) {
      state.candidate = posture;
      state.candidateAt = now;
    }

    if (state.candidate !== null) {
      if (now - state.candidateAt >= TUNING.STABLE_MS && state.posture !== state.candidate) {
        state.posture = state.candidate;
      }
    } else if (state.posture !== null && now - state.candidateAt >= TUNING.RELEASE_MS) {
      state.posture = null;
    }

    actualizarPinza(state, keypoints, size, now);

    // Ciclo de vida del gesto activo.
    if (state.active) {
      if (state.active.expiresAt !== null && now >= state.active.expiresAt) {
        endActive(state, now);
      } else if (state.active.kind === "posture" && state.posture !== state.active.gesture) {
        endActive(state, now);
      }
    }

    if (!state.active && state.posture !== null) {
      startActive(state, state.posture, null, now, "posture", 0);
    }
  }

  function snapshot(state, now) {
    const active = state.active;
    return {
      handId: state.id,
      handIndex: state.handIndex,
      posture: state.posture,
      gesture: active ? active.gesture : null,
      kind: active ? active.kind : null,
      direction: active ? active.direction : null,
      since: active ? active.startedAt : null,
      duration: active ? Math.max(0, now - active.startedAt) : 0,
      position: { x: state.position.x, y: state.position.y },
      pinza: state.pinza,
      pinzaCerrada: state.pinza === "cerrada",
      pinzaAbierta: state.pinza === "abierta",
      pinzaEstable:
        state.pinza !== null &&
        now - state.pinzaDesde >= PINZA.ESTABLE_MS &&
        state.pinzaCandidata === state.pinza,
      pinzaDistancia: state.pinzaDistancia,
    };
  }

  // --- Fuentes de datos ---------------------------------------------------

  function readHands() {
    try {
      if (typeof hands !== "undefined" && Array.isArray(hands)) return hands;
    } catch (error) {
      // `hands` en zona muerta temporal: handpose.js todavía no terminó.
    }
    return [];
  }

  function frameUnit() {
    try {
      if (typeof video !== "undefined" && video && video.width > 0 && video.height > 0) {
        return Math.max(video.width, video.height);
      }
    } catch (error) {
      // Sin p5 o sin video listo: se usa el tamaño de mano como referencia.
    }
    return 0;
  }

  function clock() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }

  // --- API pública --------------------------------------------------------

  let lastSnapshots = [];

  function update(list, now) {
    const time = typeof now === "number" ? now : clock();
    const unit = frameUnit();
    const seen = new Set();
    const claimed = new Set();
    const snapshots = [];
    const input = Array.isArray(list) ? list : [];

    for (let index = 0; index < input.length; index += 1) {
      const hand = input[index];
      if (!hand || !Array.isArray(hand.keypoints) || hand.keypoints.length < 21) continue;

      const size = handSize(hand.keypoints);
      if (!size) continue;

      let state = states.get(hand);
      if (!state) {
        state = adoptState(hand, size, time, claimed);
        states.set(hand, state);
      }
      claimed.add(state);
      seen.add(hand);

      state.handIndex = index;
      state.lastSeen = time;
      state.anchorX = hand.anchorX;
      state.anchorY = hand.anchorY;
      if (unit > 0) {
        state.position.x = hand.anchorX / unit;
        state.position.y = hand.anchorY / unit;
      }

      step(state, hand, time, size);
      snapshots.push(snapshot(state, time));
    }

    for (const [object, state] of states) {
      if (seen.has(object)) continue;
      if (state.active && time - state.lastSeen > TUNING.MISS_END_MS) {
        endActive(state, time);
      }
      if (time - state.lastSeen > TUNING.TRACK_TTL_MS) {
        states.delete(object);
      }
    }

    lastSnapshots = snapshots;
    return snapshots;
  }

  function on(type, handler) {
    if (typeof handler !== "function") return;
    if (!listeners[type]) listeners[type] = [];
    if (listeners[type].indexOf(handler) === -1) listeners[type].push(handler);
  }

  function off(type, handler) {
    const list = listeners[type];
    if (!list) return;
    const index = list.indexOf(handler);
    if (index !== -1) list.splice(index, 1);
  }

  function reset() {
    for (const state of states.values()) {
      state.active = null;
    }
    states.clear();
    lastSnapshots = [];
  }

  let running = false;
  let rafId = null;

  function tick() {
    if (!running) return;
    update(readHands(), clock());
    rafId = global.requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    if (typeof global.requestAnimationFrame !== "function") return;
    running = true;
    rafId = global.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId !== null && typeof global.cancelAnimationFrame === "function") {
      global.cancelAnimationFrame(rafId);
    }
    rafId = null;
  }

  const api = {
    update,
    start,
    stop,
    reset,
    on,
    off,
    getGesture: function getGesture(handId) {
      for (const snap of lastSnapshots) {
        if (snap.handId === handId) return snap;
      }
      return null;
    },
    snapshots: function snapshots() {
      return lastSnapshots;
    },
    pinzas: function pinzas() {
      return lastSnapshots.map(function (s) {
        return {
          handId: s.handId,
          handIndex: s.handIndex,
          estado: s.pinza,
          pinzaCerrada: s.pinzaCerrada,
          pinzaAbierta: s.pinzaAbierta,
          estable: s.pinzaEstable,
          distancia: s.pinzaDistancia,
        };
      });
    },
    GESTURES: Object.freeze(["fist", "open_palm", "point", "peace"]),
    LM,
    tuning: TUNING,
    PINZA,
  };

  global.Gestures = api;

  // En el navegador el reconocimiento se autoinicia; en otros entornos se
  // puede manejar a mano con Gestures.update(lista, timestamp).
  start();
})(typeof window !== "undefined" ? window : globalThis);
