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

    // Pinza, medida como distancia entre puntas / tamaño de mano.
    PINCH_ENTER: 0.3,
    PINCH_EXIT: 0.45,
    // La pinza debe ocurrir lejos de la palma, si no es un puño.
    PINCH_REACH: 0.55,
    PINCH_INDEX_REACH: 1.15,

    // Tiempos de estabilidad para las posturas.
    STABLE_MS: 120,
    RELEASE_MS: 200,

    // Transición abrir <-> cerrar.
    TRANSITION_MIN_GAP_MS: 300,
    TRANSITION_HOLD_MS: 350,

    // Deslizamiento horizontal.
    SWIPE_WINDOW_MS: 650,
    SWIPE_MIN_TIME_MS: 120,
    SWIPE_STEP_MS: 30,
    SWIPE_MIN_FRAME: 0.18, // fracción del lado mayor del frame (sin frame disponible)
    SWIPE_MIN_HANDS: 1.6, // alternativa en tamaños de mano
    SWIPE_AXIS_RATIO: 0.45, // |dy| máximo respecto de |dx|
    SWIPE_FORWARD_RATIO: 0.7, // pasos en el sentido final / pasos totales
    SWIPE_COOLDOWN_MS: 900,
    SWIPE_HOLD_MS: 350,
    // Tras un deslizamiento hay que volver al reposo para habilitar otro:
    // un movimiento continuo no debe dispararse una y otra vez.
    SWIPE_REARM_WINDOW_MS: 250,
    SWIPE_REARM_MAX: 0.04, // desplazamiento máximo en reposo, fracción del frame

    // Ciclo de vida del seguimiento.
    MISS_END_MS: 250, // sin ver la mano: se cierra el gesto activo
    TRACK_TTL_MS: 1000, // sin ver la mano: se descarta el estado
    REBIND_HAND_SIZE: 0.6, // reasociación por ancla, en tamaños de mano
  });

  // --- Geometría ----------------------------------------------------------

  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
  // Devuelve uno de: "pinch" | "fist" | "point" | "peace" | "open_palm" | null.
  // El orden importa: una pinza también puede parecer un puño, así que se
  // evalúa antes y se exige que ocurra lejos de la palma.

  function classifyPosture(keypoints, state, size) {
    const fingers = state.fingers;

    let extendedCount = 0;
    for (const finger of LONG_FINGERS) {
      if (fingers[finger.key] === "extended") extendedCount += 1;
    }

    const palm = palmCenter(keypoints);
    const thumbTip = keypoints[LM.THUMB_TIP];
    const indexTip = keypoints[LM.INDEX_TIP];

    const pinchRatio = dist(thumbTip, indexTip) / size;
    const pinchReach = dist(midpoint(thumbTip, indexTip), palm) / size;
    const indexMcpDistance = dist(keypoints[LM.INDEX_MCP], keypoints[LM.WRIST]);
    const indexReach = dist(indexTip, keypoints[LM.WRIST]) / Math.max(indexMcpDistance, 1e-6);
    const thumbReach = dist(thumbTip, palm) / size;

    // Pinza: puntas juntas, lejos de la palma y con el índice fuera del puño.
    const pinchLimit = state.posture === "pinch" ? TUNING.PINCH_EXIT : TUNING.PINCH_ENTER;
    if (
      pinchRatio <= pinchLimit &&
      pinchReach >= TUNING.PINCH_REACH &&
      indexReach >= TUNING.PINCH_INDEX_REACH
    ) {
      return "pinch";
    }

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
      openness: null,
      lastTransitionAt: -Infinity,
      lastSwipeAt: -Infinity,
      swipeArmed: true,
      track: [],
      active: null,
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

  function startTransient(state, gesture, direction, now, kind, holdMs) {
    endActive(state, now);
    startActive(state, gesture, direction, now, kind, holdMs);
  }

  // --- Deslizamiento horizontal -------------------------------------------
  // Se normaliza por el lado mayor del frame (o por el tamaño de la mano si
  // el video todavía no está disponible). La ventana corta evita que un
  // cambio de profundidad se lea como desplazamiento.

  function detectSwipe(history) {
    if (history.length < 4) return null;

    const first = history[0];
    const last = history[history.length - 1];
    const dt = last.t - first.t;
    if (dt < TUNING.SWIPE_MIN_TIME_MS) return null;

    const dx = last.x - first.x;
    const dy = last.y - first.y;
    if (Math.abs(dx) < last.min) return null;
    if (Math.abs(dy) > Math.abs(dx) * TUNING.SWIPE_AXIS_RATIO) return null;

    // La trayectoria tiene que ir mayormente en un solo sentido.
    const sign = dx > 0 ? 1 : -1;
    let forward = 0;
    let total = 0;
    for (let i = 1; i < history.length; i += 1) {
      const step = history[i].x - history[i - 1].x;
      if (Math.abs(step) < 1e-9) continue;
      total += 1;
      if (step * sign > 0) forward += 1;
    }
    if (total === 0 || forward / total < TUNING.SWIPE_FORWARD_RATIO) return null;

    return {
      direction: sign > 0 ? "right" : "left",
      distance: Math.abs(dx),
      duration: dt,
    };
  }

  function recordTrack(state, hand, now, unit, minDistance) {
    const last = state.track[state.track.length - 1];
    if (last && now - last.t < TUNING.SWIPE_STEP_MS) return;

    state.track.push({
      x: hand.anchorX / unit,
      y: hand.anchorY / unit,
      t: now,
      min: minDistance,
    });

    while (state.track.length > 0 && now - state.track[0].t > TUNING.SWIPE_WINDOW_MS) {
      state.track.shift();
    }
  }

  // ¿La mano está quieta el tiempo suficiente como para habilitar otro
  // deslizamiento? Evita que un movimiento continuo dispare en bucle.
  function isStill(history, now) {
    let start = history.length;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (now - history[i].t <= TUNING.SWIPE_REARM_WINDOW_MS) start = i;
      else break;
    }

    const recent = history.slice(start);
    if (recent.length < 3) return false;

    const first = recent[0];
    const last = recent[recent.length - 1];
    return Math.hypot(last.x - first.x, last.y - first.y) <= TUNING.SWIPE_REARM_MAX;
  }

  // --- Paso de reconocimiento por mano ------------------------------------

  function step(state, hand, now, unit, size) {
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

    // Transición abrir <-> cerrar: se dispara por cambio de estado, no por
    // posición. Mantener la postura no vuelve a disparar nada.
    if (state.posture === "open_palm" || state.posture === "fist") {
      const side = state.posture === "open_palm" ? "open" : "closed";
      if (
        state.openness !== null &&
        state.openness !== side &&
        now - state.lastTransitionAt >= TUNING.TRANSITION_MIN_GAP_MS
      ) {
        const gesture = side === "closed" ? "close_hand" : "open_hand";
        startTransient(state, gesture, null, now, "transition", TUNING.TRANSITION_HOLD_MS);
        state.lastTransitionAt = now;
      }
      state.openness = side;
    }

    // Deslizamiento: solo con la palma abierta y en movimiento.
    if (state.posture === "open_palm") {
      const unitDistance = unit > 0 ? unit : size;
      const minDistance = unit > 0 ? TUNING.SWIPE_MIN_FRAME : TUNING.SWIPE_MIN_HANDS;
      recordTrack(state, hand, now, unitDistance, minDistance);

      if (!state.swipeArmed && isStill(state.track, now)) {
        state.swipeArmed = true;
      }

      if (state.swipeArmed && now - state.lastSwipeAt >= TUNING.SWIPE_COOLDOWN_MS) {
        const swipe = detectSwipe(state.track);
        if (swipe) {
          state.lastSwipeAt = now;
          state.swipeArmed = false;
          state.track = [];
          startTransient(
            state,
            swipe.direction === "right" ? "swipe_right" : "swipe_left",
            swipe.direction,
            now,
            "swipe",
            TUNING.SWIPE_HOLD_MS
          );
        }
      }
    } else if (state.track.length > 0) {
      state.track = [];
      // Si la postura desapareció hace rato, se vuelve a habilitar el gesto.
      if (!state.swipeArmed && now - state.lastSwipeAt >= TUNING.SWIPE_COOLDOWN_MS) {
        state.swipeArmed = true;
      }
    }

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

      step(state, hand, time, unit, size);
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
      state.track = [];
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
    GESTURES: Object.freeze([
      "fist",
      "open_palm",
      "point",
      "peace",
      "pinch",
      "close_hand",
      "open_hand",
      "swipe_left",
      "swipe_right",
    ]),
    LM,
    tuning: TUNING,
  };

  global.Gestures = api;

  // En el navegador el reconocimiento se autoinicia; en otros entornos se
  // puede manejar a mano con Gestures.update(lista, timestamp).
  start();
})(typeof window !== "undefined" ? window : globalThis);
