// Detección de manos con p5.js + ml5.js HandPose (API de ml5 1.x).
// Carga el modelo, activa la cámara y dibuja a pantalla completa
// los 21 keypoints y el esqueleto de hasta cuatro manos.

const MAX_HANDS = 4;
// "lite" reduce el coste de inferencia manteniendo los 21 keypoints.
// Cambiar a "full" da algo más de precisión a cambio de velocidad.
const MODEL_TYPE = "lite";
const KEYPOINT_COLOR = [0, 255, 179];
const BONE_COLOR = [255, 255, 255, 170];
// Peso de la posición nueva frente a la anterior al suavizar.
const SMOOTHING = 0.55;
// Distancia máxima para asociar una mano con la del frame anterior.
const MATCH_RATIO = 0.3;
// Movimiento que se considera real y no vibración: se aplica sin suavizar.
const SNAP_RATIO = 0.02;

let video;
let handPose;
let connections = [];
let hands = [];
let modelReady = false;
let view = null;
let lineWeight = 2;
let pointSize = 8;

// Estado del bucle de detección: una sola inferencia activa a la vez.
let detecting = false;
let loopRunning = false;

function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  video = createCapture({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      facingMode: "user",
    },
    audio: false,
  });
  video.hide();

  handPose = ml5.handPose(
    {
      maxHands: MAX_HANDS,
      modelType: MODEL_TYPE,
      // La imagen se refleja al dibujar, así que el modelo también debe
      // analizarla reflejada para que los keypoints coincidan.
      flipHorizontal: true,
    },
    (model, error) => {
      if (error) {
        console.error("No se pudo cargar el modelo HandPose:", error);
        return;
      }
      handPose = model;
      connections = model.getConnections();
      modelReady = true;
      startDetection();
    }
  );

  // No tiene sentido inferir mientras la pestaña está oculta.
  document.addEventListener("visibilitychange", () => {
    if (!modelReady) return;
    detecting = !document.hidden;
    if (detecting) {
      detectLoop();
    } else {
      hands = [];
    }
  });
}

function startDetection() {
  detecting = !document.hidden;
  if (detecting) detectLoop();
}

// Ejecuta una predicción, espera su resultado y recién entonces lanza la
// siguiente: nunca hay dos inferencias en paralelo ni resultados en cola.
async function detectLoop() {
  if (loopRunning) return;
  loopRunning = true;

  while (detecting) {
    try {
      updateHands(await handPose.detect(video.elt));
    } catch (error) {
      console.error("Error en la detección de manos:", error);
      detecting = false;
    }
  }

  loopRunning = false;
}

// Asocia cada detección con la mano del frame anterior y suaviza sus puntos.
// La asociación es uno a uno, así que una mano nunca arrastra a otra.
function updateHands(results) {
  const previous = hands;

  if (results.length === 0) {
    hands = [];
    return;
  }

  const frameSize = max(video.width, video.height);
  const matchDistance = frameSize * MATCH_RATIO;
  const snapDistance = frameSize * SNAP_RATIO;
  const used = new Array(previous.length).fill(false);
  const next = [];

  for (const hand of results) {
    const keypoints = hand.keypoints;
    const anchorX = (keypoints[0].x + keypoints[9].x) / 2;
    const anchorY = (keypoints[0].y + keypoints[9].y) / 2;

    let matchIndex = -1;
    let bestDistance = matchDistance;

    for (let i = 0; i < previous.length; i++) {
      if (used[i]) continue;
      const dx = anchorX - previous[i].anchorX;
      const dy = anchorY - previous[i].anchorY;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        matchIndex = i;
      }
    }

    let smoothHand;

    if (matchIndex >= 0) {
      used[matchIndex] = true;
      smoothHand = previous[matchIndex];

      for (let i = 0; i < keypoints.length; i++) {
        const point = smoothHand.keypoints[i];
        const dx = keypoints[i].x - point.x;
        const dy = keypoints[i].y - point.y;
        const alpha = dx * dx + dy * dy > snapDistance * snapDistance ? 1 : SMOOTHING;
        point.x += dx * alpha;
        point.y += dy * alpha;
      }

      smoothHand.anchorX = (smoothHand.keypoints[0].x + smoothHand.keypoints[9].x) / 2;
      smoothHand.anchorY = (smoothHand.keypoints[0].y + smoothHand.keypoints[9].y) / 2;
    } else {
      smoothHand = {
        anchorX,
        anchorY,
        keypoints: keypoints.map((point) => ({ x: point.x, y: point.y })),
      };
    }

    next.push(smoothHand);
  }

  hands = next;
}

function draw() {
  if (!video || !video.width) return;

  if (!view || view.videoWidth !== video.width || view.videoHeight !== video.height) {
    updateView();
  }

  drawVideo();

  if (modelReady && hands.length > 0) drawHands();
}

// La vista solo cambia con el tamaño de la ventana o del video.
function updateView() {
  const scale = max(width / video.width, height / video.height);
  view = {
    videoWidth: video.width,
    videoHeight: video.height,
    scale,
    offsetX: (width - video.width * scale) / 2,
    offsetY: (height - video.height * scale) / 2,
    drawWidth: video.width * scale,
    drawHeight: video.height * scale,
  };

  lineWeight = max(2, min(width, height) * 0.003);
  pointSize = max(4, min(width, height) * 0.007) * 2;
}

function drawVideo() {
  push();
  translate(width, 0);
  scale(-1, 1);
  image(video, view.offsetX, view.offsetY, view.drawWidth, view.drawHeight);
  pop();
}

function drawHands() {
  const { offsetX, offsetY, scale } = view;

  stroke(BONE_COLOR[0], BONE_COLOR[1], BONE_COLOR[2], BONE_COLOR[3]);
  strokeWeight(lineWeight);
  noFill();

  // Un solo trazo por mano en lugar de una llamada por conexión.
  for (const hand of hands) {
    beginShape(LINES);
    for (const [startIndex, endIndex] of connections) {
      const start = hand.keypoints[startIndex];
      const end = hand.keypoints[endIndex];
      vertex(offsetX + start.x * scale, offsetY + start.y * scale);
      vertex(offsetX + end.x * scale, offsetY + end.y * scale);
    }
    endShape();
  }

  noStroke();
  fill(KEYPOINT_COLOR[0], KEYPOINT_COLOR[1], KEYPOINT_COLOR[2]);

  for (const hand of hands) {
    for (const keypoint of hand.keypoints) {
      circle(offsetX + keypoint.x * scale, offsetY + keypoint.y * scale, pointSize);
    }
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  if (video && video.width) updateView();
}
