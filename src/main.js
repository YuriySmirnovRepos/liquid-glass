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

const MAX_DPR = 1.5;
const MIN_DPR = 1.0;
const DPR_STEP = 0.25;

/* Адаптация dpr: окна телеметрии по 0.5 c, шесть подряд — это 3 секунды */
const SLOW_FPS = 50;
const SLOW_WINDOWS_BEFORE_DOWNGRADE = 6;

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
  dprCap: MAX_DPR,
  dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
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
  slowWindows: 0,
};

/*
 * Геометрия карточки в CSS-пикселях. Чтение layout стоит дорого,
 * поэтому кэш обновляется по ResizeObserver и resize окна,
 * а рендер-цикл только домножает значения на текущий dpr.
 */
const glassGeometry = {
  valid: false,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  radius: 0,
};

const frameRect = { x: 0, y: 0, width: 0, height: 0 };

let rafId = 0;
let renderingStopped = renderer === null;

function measureGlassGeometry() {
  const rect = glassCard.getBoundingClientRect();
  const styles = getComputedStyle(glassCard);

  glassGeometry.x = rect.left;
  glassGeometry.y = window.innerHeight - rect.bottom;
  glassGeometry.width = rect.width;
  glassGeometry.height = rect.height;
  glassGeometry.radius = Number.parseFloat(styles.borderTopLeftRadius) || 0;
  glassGeometry.valid = true;
}

function invalidateGlassGeometry() {
  glassGeometry.valid = false;
}

function isContinuous() {
  return !state.hidden && !reduceMotion.matches;
}

function requestFrame() {
  if (rafId || renderingStopped) return;
  rafId = requestAnimationFrame(render);
}

/*
 * Единственный источник изменения размера canvas — кадр рендера.
 * Ранний выход делает вызов дешёвым, поэтому отдельный resize-listener
 * для canvas не нужен.
 */
function resizeCanvas(force = false) {
  state.dpr = Math.min(window.devicePixelRatio || 1, state.dprCap);

  const width = Math.max(1, Math.round(window.innerWidth * state.dpr));
  const height = Math.max(1, Math.round(window.innerHeight * state.dpr));

  if (!force && state.width === width && state.height === height) return true;

  canvas.width = width;
  canvas.height = height;
  state.width = width;
  state.height = height;
  invalidateGlassGeometry();

  try {
    renderer.resize(width, height);
  } catch (error) {
    renderingStopped = true;
    reportFatal(`Не удалось перестроить буферы: ${error.message}`, error);
    return false;
  }
  return true;
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

/*
 * Гистерезис: понижаем dpr только после нескольких секунд стабильно
 * низкого FPS и никогда не повышаем обратно, чтобы разрешение
 * не «дёргалось» туда-сюда.
 */
function adaptPixelRatio(fps) {
  if (state.dpr <= MIN_DPR) return;

  state.slowWindows = fps < SLOW_FPS ? state.slowWindows + 1 : 0;
  if (state.slowWindows < SLOW_WINDOWS_BEFORE_DOWNGRADE) return;

  state.slowWindows = 0;
  state.dprCap = Math.max(MIN_DPR, state.dprCap - DPR_STEP);
  resizeCanvas();
}

function updateFpsIndicator(deltaTime) {
  state.fpsFrames += 1;
  state.fpsTime += deltaTime;
  if (state.fpsTime < 0.5) return;

  const fps = state.fpsFrames / state.fpsTime;
  fpsElement.textContent = `${fps.toFixed(0)} FPS`;

  state.fpsFrames = 0;
  state.fpsTime = 0;

  adaptPixelRatio(fps);
}

function syncFpsIndicatorMode() {
  if (isContinuous()) return;

  state.fpsFrames = 0;
  state.fpsTime = 0;
  state.slowWindows = 0;
  fpsElement.textContent = "кадры по запросу";
}

function render(now) {
  rafId = 0;

  // Кадр мог быть запланирован до потери контекста или до фатальной ошибки.
  if (renderingStopped) return;

  const deltaTime = Math.min((now - state.lastFrameTime) / 1000, 0.05);
  state.lastFrameTime = now;

  if (!resizeCanvas()) return;

  if (!state.hidden) {
    updatePointer(deltaTime);

    if (!reduceMotion.matches) {
      state.sceneTime += deltaTime;
    }

    if (!glassGeometry.valid) measureGlassGeometry();

    frameRect.x = glassGeometry.x * state.dpr;
    frameRect.y = glassGeometry.y * state.dpr;
    frameRect.width = glassGeometry.width * state.dpr;
    frameRect.height = glassGeometry.height * state.dpr;

    renderer.renderFrame(state.sceneTime, {
      width: state.width,
      height: state.height,
      pointer: state.pointer,
      rect: frameRect,
      radius: glassGeometry.radius * state.dpr,
      pixelScale: state.dpr,
      refraction: state.refraction,
      glassEnabled: state.glassEnabled,
    });

    if (isContinuous()) updateFpsIndicator(deltaTime);
  }

  /*
   * При prefers-reduced-motion анимации нет: следующий кадр рисуется
   * только по событию, а не крутится вхолостую.
   */
  if (isContinuous()) requestFrame();
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

    requestFrame();
  },
  { passive: true }
);

function handleLayoutChange() {
  invalidateGlassGeometry();
  requestFrame();
}

window.addEventListener("resize", handleLayoutChange, { passive: true });

new ResizeObserver(handleLayoutChange).observe(glassCard);

reduceMotion.addEventListener("change", () => {
  state.lastFrameTime = performance.now();
  syncFpsIndicatorMode();
  requestFrame();
});

document.addEventListener("visibilitychange", () => {
  state.hidden = document.hidden;
  state.lastFrameTime = performance.now();
  if (!state.hidden) requestFrame();
});

canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  renderingStopped = true;
  setStatus("Контекст WebGL потерян, ожидается восстановление");
});

canvas.addEventListener("webglcontextrestored", () => {
  try {
    if (renderer) renderer.dispose();
    renderer = new LiquidGlassRenderer(gl);
  } catch (error) {
    reportFatal(
      `Не удалось восстановить контекст WebGL: ${error.message}`,
      error
    );
    return;
  }

  renderingStopped = false;
  state.hidden = document.hidden;
  state.lastFrameTime = performance.now();
  state.fpsFrames = 0;
  state.fpsTime = 0;

  // force: размер не изменился, но render target'ы нужно создать заново.
  if (!resizeCanvas(true)) return;

  setStatus("Контекст WebGL восстановлен");
  requestFrame();
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
  requestFrame();
});

syncRefractionButton();

if (!renderingStopped && resizeCanvas(true)) {
  setStatus("Liquid Glass готов");
  syncFpsIndicatorMode();
  requestFrame();
}
