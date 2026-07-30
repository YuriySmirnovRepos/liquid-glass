#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uBackground;
uniform sampler2D uBlurredBackground;

uniform vec2 uResolution;
uniform vec2 uPointer;
uniform vec2 uPointerVelocity;

uniform vec4 uRect;
uniform float uRadius;

/* device-пикселей на один CSS-пиксель */
uniform float uPixelScale;

uniform float uRefraction;
uniform float uGlassEnabled;

out vec4 outColor;

/*
 * Геометрия задана в CSS-пикселях и домножается на uPixelScale,
 * иначе на retina все пороги оказываются вдвое уже.
 */
const float BEVEL_WIDTH_CSS = 28.0;
const float SHADOW_RADIUS_CSS = 48.0;
const float EDGE_BOOST_WIDTH_CSS = 48.0;
const float EDGE_BOOST_FEATHER_CSS = 2.0;
const float RIM_WIDTH_CSS = 8.0;

/* Тюнинг эффекта */
const float DISPERSION_RED = 1.060;
const float DISPERSION_BLUE = 0.940;

const float FROSTED_BASE = 0.40;
const float FROSTED_IN_WAKE = 0.26;

const float SHADOW_OPACITY = 0.32;

const vec3 TINT_COLOR = vec3(0.82, 0.91, 1.0);
const float TINT_AMOUNT = 0.10;

const vec3 RIM_COLOR = vec3(1.0, 0.985, 0.96);
const float RIM_INTENSITY = 0.22;

const vec3 FRESNEL_COLOR = vec3(0.58, 0.82, 1.0);
const float FRESNEL_INTENSITY = 0.24;

const float SPECULAR_INTENSITY = 0.34;

const vec2 WAKE_ANISOTROPY = vec2(1.40, 0.95);
const float WAKE_CLAMP = 0.030;

float sdRoundRect(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;

  return min(max(q.x, q.y), 0.0)
    + length(max(q, 0.0))
    - radius;
}

/*
 * Профиль фаски, параметризованный расстоянием до границы SDF:
 * t = 0 у самой кромки, t = 1 в толще стекла. Направление "наружу"
 * берётся из градиента SDF центральными разностями.
 */
vec3 glassNormal(
  vec2 localPoint,
  vec2 halfSize,
  float radius,
  float bevelWidth
) {
  float distanceToShape = sdRoundRect(localPoint, halfSize, radius);

  float t = clamp(-distanceToShape / bevelWidth, 0.0, 1.0);
  float dome = t * (2.0 - t);

  float nz = sqrt(max(dome, 0.0));
  float nxy = sqrt(max(1.0 - dome, 0.0));

  float epsilon = uPixelScale;

  vec2 grad = vec2(
    sdRoundRect(localPoint + vec2(epsilon, 0.0), halfSize, radius)
      - sdRoundRect(localPoint - vec2(epsilon, 0.0), halfSize, radius),
    sdRoundRect(localPoint + vec2(0.0, epsilon), halfSize, radius)
      - sdRoundRect(localPoint - vec2(0.0, epsilon), halfSize, radius)
  );

  float gradLength = max(length(grad), 1e-4);

  return vec3(-(grad / gradLength) * nxy, nz);
}

void main() {
  vec3 background = textureLod(uBackground, vUv, 0.0).rgb;

  vec2 pixel = vUv * uResolution;

  vec2 local = pixel - uRect.xy - uRect.zw * 0.5;
  vec2 halfSize = uRect.zw * 0.5;

  float minSize = min(halfSize.x, halfSize.y);

  /* Защита от вырожденной геометрии: радиус не может превышать полуразмер */
  float safeRadius = min(uRadius, minSize);

  float bevelWidth = max(BEVEL_WIDTH_CSS * uPixelScale, 1.0);

  float distanceToShape = sdRoundRect(
    local,
    halfSize,
    safeRadius
  );

  float antiAlias = max(
    fwidth(distanceToShape) * 1.25,
    0.25
  );

  float glassMask = 1.0 - smoothstep(
    -antiAlias,
    antiAlias,
    distanceToShape
  );

  float outsideDistance = max(distanceToShape, 0.0);

  float shadow = 1.0 - smoothstep(
    0.0,
    SHADOW_RADIUS_CSS * uPixelScale,
    outsideDistance
  );

  shadow *= (1.0 - glassMask) * SHADOW_OPACITY;

  vec3 color = background * (1.0 - shadow);

  if (glassMask > 0.001) {
    vec3 normal = glassNormal(
      local,
      halfSize,
      safeRadius,
      bevelWidth
    );

    float edgeThickness = smoothstep(
      -minSize * 0.82,
      0.0,
      distanceToShape
    );

    float edgeBoost = smoothstep(
      -EDGE_BOOST_WIDTH_CSS * uPixelScale,
      EDGE_BOOST_FEATHER_CSS * uPixelScale,
      distanceToShape
    );

    float refractionStrength = uRefraction
      * (0.16 + edgeThickness * 0.84)
      * (0.70 + edgeBoost * 0.70)
      * uGlassEnabled;

    vec2 baseOffset = normal.xy * refractionStrength;

    /*
     * Liquid Wake
     * Влияние скорости курсора ограничено зоной рядом с ним
     * и добавляется только к sharp-refraction.
     */
    vec2 pointerInPixels = uPointer * uResolution;

    vec2 pointerLocal = pointerInPixels
      - uRect.xy
      - uRect.zw * 0.5;

    vec2 localToPointer = (local - pointerLocal)
      / max(halfSize, vec2(1.0));

    float pointerDistance = dot(
      localToPointer,
      localToPointer
    );

    float wakeMask = 1.0 - smoothstep(
      0.0,
      1.10,
      pointerDistance
    );

    /* Данные приходят в UV/c, ограничение держит смещение в разумных рамках */
    vec2 wakeDirection = clamp(
      uPointerVelocity * WAKE_ANISOTROPY,
      vec2(-WAKE_CLAMP),
      vec2(WAKE_CLAMP)
    );

    /*
     * В центре follow-through сильнее, у bevel сохраняется
     * базовая normal refraction.
     */
    vec2 liquidWake = wakeDirection
      * wakeMask
      * (0.55 + edgeThickness * 0.45);

    /*
     * Смещение живёт в UV, поэтому на неквадратном экране его надо
     * сжать по X — иначе преломление растянуто по одной оси.
     */
    float aspect = uResolution.x / uResolution.y;
    vec2 uvScale = vec2(1.0 / aspect, 1.0);

    vec2 offset = (baseOffset + liquidWake) * uvScale;

    /* Текстуры используют CLAMP_TO_EDGE, дополнительный clamp() не нужен */
    vec3 refractedSharp = vec3(
      textureLod(uBackground, vUv + offset * DISPERSION_RED, 0.0).r,
      textureLod(uBackground, vUv + offset, 0.0).g,
      textureLod(uBackground, vUv + offset * DISPERSION_BLUE, 0.0).b
    );

    /*
     * Blur читается по тому же offset, что и sharp: иначе матовая
     * составляющая "не едет" вместе с искажением.
     */
    vec3 refractedBlurred = textureLod(
      uBlurredBackground,
      vUv + offset,
      0.0
    ).rgb;

    /* В зоне волны матовость ослабевает, чтобы искажение читалось */
    float frostedMix = mix(
      FROSTED_BASE,
      FROSTED_IN_WAKE,
      wakeMask
    );

    vec3 refracted = mix(
      refractedSharp,
      refractedBlurred,
      frostedMix
    );

    vec3 glassColor = mix(
      refracted,
      TINT_COLOR,
      TINT_AMOUNT
    );

    float rim = 1.0 - smoothstep(
      0.0,
      RIM_WIDTH_CSS * uPixelScale,
      abs(distanceToShape)
    );

    glassColor += RIM_COLOR * rim * RIM_INTENSITY;

    /*
     * Polynomial Fresnel:
     * (1 - normal.z)^4 без pow().
     */
    float normalFacing = clamp(normal.z, 0.0, 1.0);
    float grazingAngle = 1.0 - normalFacing;

    float fresnel = grazingAngle * grazingAngle;
    fresnel *= fresnel;

    glassColor += FRESNEL_COLOR * fresnel * FRESNEL_INTENSITY;

    /*
     * Pointer highlight без exp(), pow() и normalize().
     */
    vec2 stretchedDistance = localToPointer * vec2(0.72, 1.28);

    float highlightDistance = dot(
      stretchedDistance,
      stretchedDistance
    );

    float pointerHighlight = 1.0 - smoothstep(
      0.0,
      0.55,
      highlightDistance
    );

    float edgeLight = smoothstep(
      -minSize * 0.78,
      0.0,
      distanceToShape
    );

    float specular = pointerHighlight
      * (0.18 + edgeLight * 0.82);

    glassColor += RIM_COLOR * specular * SPECULAR_INTENSITY;

    glassColor = clamp(glassColor, 0.0, 1.0);

    color = mix(
      color,
      glassColor,
      glassMask
    );
  }

  outColor = vec4(color, 1.0);
}
