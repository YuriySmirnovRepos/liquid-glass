// src/main.js
import "./style.css";
import { LiquidGlassRenderer } from "./gl/renderer.js";

const canvas = document.querySelector("#liquid-canvas");
const statusElement = document.querySelector("#status");
const fpsElement = document.querySelector("#fps");
const testButton = document.querySelector("#test-button");
const glassCard = document.querySelector(".glass-card");

// Живёт на уровне модуля: matchMedia() в каждом кадре — лишняя работа.
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

/*
 * Live-регион: сюда пишутся только значимые события (готовность,
 * потеря/восстановление контекста, ошибки), но не телеметрия.
 */
function setStatus(message) {
  statusElement.textContent = message;
}

function reportFatal(message, error) {
  console.error(message, error);
  setStatus(message);
  document.body.classList.add("webgl-unavailable");
}

const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "high-performance",
});

if (!gl) {
  reportFatal("WebGL2 недоступен");
  throw new Error("WebGL2 is not available");
}

let renderer = null;

try {
  renderer = new LiquidGlassRenderer(gl);
} catch (error) {
  reportFatal(`Не удалось инициализировать WebGL: ${error.message}`, error);
}

const state = {
  dpr: Math.min(window.devicePixelRatio || 1, 1.5),
  width: 0,
  height: 0,
  pointer: {
    x: 0.5,
    y: 0.5,
    targetX: 0.5,
    targetY: 0.5,
    velocityX: 0.0,
    velocityY: 0.0,
    targetVelocityX: 0.0,
    targetVelocityY: 0.0,
    lastEventTime: performance.now(),
  },
  refraction: 0.04,
  glassEnabled: 1.0,
  hidden: document.hidden,
  lastFrameTime: performance.now(),
  sceneTime: 0,
  fpsFrames: 0,
  fpsTime: 0,
};

function resizeCanvas() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = Math.max(1, Math.round(window.innerWidth * state.dpr));
  const height = Math.max(1, Math.round(window.innerHeight * state.dpr));

  if (canvas.width === width && canvas.height === height) return;

  canvas.width = width;
  canvas.height = height;
  state.width = width;
  state.height = height;

  renderer.resize(width, height);
}

function getGlassRectInCanvasPixels() {
  const rect = glassCard.getBoundingClientRect();
  return {
    x: rect.left * state.dpr,
    y: (window.innerHeight - rect.bottom) * state.dpr,
    width: rect.width * state.dpr,
    height: rect.height * state.dpr,
  };
}

function getGlassRadiusInCanvasPixels() {
  const styles = getComputedStyle(glassCard);
  return Number.parseFloat(styles.borderTopLeftRadius) * state.dpr;
}

function damp(current, target, lambda, deltaTime) {
  const factor = 1.0 - Math.exp(-lambda * deltaTime);
  return current + (target - current) * factor;
}

function updatePointer(deltaTime) {
  if (reduceMotion.matches) {
    state.pointer.x = state.pointer.targetX;
    state.pointer.y = state.pointer.targetY;
    state.pointer.velocityX = 0.0;
    state.pointer.velocityY = 0.0;
    state.pointer.targetVelocityX = 0.0;
    state.pointer.targetVelocityY = 0.0;
    return;
  }

  state.pointer.x = damp(
    state.pointer.x,
    state.pointer.targetX,
    12.0,
    deltaTime
  );
  state.pointer.y = damp(
    state.pointer.y,
    state.pointer.targetY,
    12.0,
    deltaTime
  );
  state.pointer.velocityX = damp(
    state.pointer.velocityX,
    state.pointer.targetVelocityX,
    16.0,
    deltaTime
  );
  state.pointer.velocityY = damp(
    state.pointer.velocityY,
    state.pointer.targetVelocityY,
    16.0,
    deltaTime
  );
  state.pointer.targetVelocityX *= Math.exp(-4.5 * deltaTime);
  state.pointer.targetVelocityY *= Math.exp(-4.5 * deltaTime);
}

function updateFpsIndicator(deltaTime) {
  state.fpsFrames += 1;
  state.fpsTime += deltaTime;
  if (state.fpsTime < 0.5) return;

  const fps = state.fpsFrames / state.fpsTime;
  fpsElement.textContent = `${fps.toFixed(0)} FPS`;

  state.fpsFrames = 0;
  state.fpsTime = 0;
}

function render(now) {
  const deltaTime = Math.min((now - state.lastFrameTime) / 1000, 0.05);
  state.lastFrameTime = now;

  resizeCanvas();

  if (!state.hidden) {
    updatePointer(deltaTime);

    if (!reduceMotion.matches) {
      state.sceneTime += deltaTime;
    }

    const rect = getGlassRectInCanvasPixels();
    const radius = getGlassRadiusInCanvasPixels();

    renderer.renderFrame(state.sceneTime, {
      width: state.width,
      height: state.height,
      pointer: state.pointer,
      rect,
      radius,
      refraction: state.refraction,
      glassEnabled: state.glassEnabled,
    });

    updateFpsIndicator(deltaTime);
  }

  requestAnimationFrame(render);
}

window.addEventListener(
  "pointermove",
  (event) => {
    const nextX = event.clientX / window.innerWidth;
    const nextY = 1.0 - event.clientY / window.innerHeight;

    const timeDelta = Math.max(
      (event.timeStamp - state.pointer.lastEventTime) / 1000,
      1 / 240
    );
    const velocityX = event.movementX / window.innerWidth / timeDelta;
    const velocityY = -event.movementY / window.innerHeight / timeDelta;

    state.pointer.targetVelocityX = velocityX;
    state.pointer.targetVelocityY = velocityY;
    state.pointer.targetX = nextX;
    state.pointer.targetY = nextY;
    state.pointer.lastEventTime = event.timeStamp;
  },
  { passive: true }
);

window.addEventListener("resize", resizeCanvas, { passive: true });

document.addEventListener("visibilitychange", () => {
  state.hidden = document.hidden;
  state.lastFrameTime = performance.now();
});

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  state.hidden = true;
  setStatus("Контекст WebGL потерян, ожидается восстановление");
});

canvas.addEventListener("webglcontextrestored", () => {
  window.location.reload();
});

function syncRefractionButton() {
  const enabled = state.glassEnabled > 0.5;
  testButton.textContent = enabled
    ? "Выключить рефракцию"
    : "Включить рефракцию";
  testButton.setAttribute("aria-pressed", String(enabled));
}

testButton.addEventListener("click", () => {
  state.glassEnabled = state.glassEnabled > 0.5 ? 0.0 : 1.0;
  syncRefractionButton();
});

syncRefractionButton();

if (renderer) {
  resizeCanvas();
  setStatus("Liquid Glass готов");
  requestAnimationFrame(render);
}
