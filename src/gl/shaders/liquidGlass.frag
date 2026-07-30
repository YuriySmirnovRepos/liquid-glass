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

uniform float uRefraction;
uniform float uGlassEnabled;

out vec4 outColor;

float sdRoundRect(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;

  return min(max(q.x, q.y), 0.0)
    + length(max(q, 0.0))
    - radius;
}

float surfaceHeight(
  vec2 localPoint,
  vec2 halfSize,
  float radius
) {
  float distanceToShape = sdRoundRect(
    localPoint,
    halfSize,
    radius
  );

  float minSize = min(halfSize.x, halfSize.y);

  float core = 1.0 - smoothstep(
    -minSize * 0.88,
    0.0,
    distanceToShape
  );

  float bevel = 1.0 - smoothstep(
    -28.0,
    3.0,
    distanceToShape
  );

  return core * 0.16 + bevel * 0.84;
}

vec3 surfaceNormal(
  vec2 localPoint,
  vec2 halfSize,
  float radius
) {
  const float EPSILON = 1.0;

  float heightCenter = surfaceHeight(
    localPoint,
    halfSize,
    radius
  );

  float heightX = surfaceHeight(
    localPoint + vec2(EPSILON, 0.0),
    halfSize,
    radius
  );

  float heightY = surfaceHeight(
    localPoint + vec2(0.0, EPSILON),
    halfSize,
    radius
  );

  return normalize(vec3(
    -(heightX - heightCenter),
    -(heightY - heightCenter),
    0.15
  ));
}

void main() {
  vec3 background = texture(uBackground, vUv).rgb;

  vec2 pixel = vUv * uResolution;

  vec2 local = pixel - uRect.xy - uRect.zw * 0.5;
  vec2 halfSize = uRect.zw * 0.5;

  float distanceToShape = sdRoundRect(
    local,
    halfSize,
    uRadius
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
    48.0,
    outsideDistance
  );

  shadow *= (1.0 - glassMask) * 0.32;

  vec3 color = background * (1.0 - shadow);

  if (glassMask > 0.001) {
    vec3 normal = surfaceNormal(
      local,
      halfSize,
      uRadius
    );

    float minSize = min(halfSize.x, halfSize.y);

    float edgeThickness = smoothstep(
      -minSize * 0.82,
      0.0,
      distanceToShape
    );

    float edgeBoost = smoothstep(
      -48.0,
      2.0,
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

    /*
 * Данные приходят в UV/c; ограничение защищает края texture.
 * 0.030 заметно на фоне с цветными blobs, но UV остаются
 * внутри clamp() ниже.
 */
vec2 wakeDirection = clamp(
  uPointerVelocity * vec2(1.40, 0.95),
  vec2(-0.030),
  vec2(0.030)
);

/*
 * В центре follow-through сильнее, у bevel сохраняется
 * базовая normal refraction.
 */
vec2 liquidWake = wakeDirection
  * wakeMask
  * (0.55 + edgeThickness * 0.45);

    vec2 offset = baseOffset + liquidWake;

    /*
     * RGB-dispersion применяется только к sharp texture.
     */
    vec2 uvRed = clamp(
      vUv + offset * 1.060,
      vec2(0.001),
      vec2(0.999)
    );

    vec2 uvGreen = clamp(
      vUv + offset,
      vec2(0.001),
      vec2(0.999)
    );

    vec2 uvBlue = clamp(
      vUv + offset * 0.940,
      vec2(0.001),
      vec2(0.999)
    );

    vec3 refractedSharp = vec3(
      texture(uBackground, uvRed).r,
      texture(uBackground, uvGreen).g,
      texture(uBackground, uvBlue).b
    );

    /*
     * Blur texture читается только по vUv.
     * Не применять offset к uBlurredBackground.
     */
    vec3 refractedBlurred = texture(
      uBlurredBackground,
      vUv
    ).rgb;

    /*
    * Меньше blur точно в области волны:
    * sharp distortion становится заметна, но не меняет
    * sampling blur texture.
    */
   float frostedMix = mix(
     0.62,
     0.26,
     wakeMask
   );

    vec3 refracted = mix(
      refractedSharp,
      refractedBlurred,
      frostedMix
    );

    vec3 glassColor = mix(
      refracted,
      vec3(0.82, 0.91, 1.0),
      0.10
    );

    float rim = 1.0 - smoothstep(
      0.0,
      8.0,
      abs(distanceToShape)
    );

    glassColor += vec3(1.0, 0.985, 0.96)
      * rim
      * 0.22;

    /*
     * Polynomial Fresnel:
     * (1 - normal.z)^4 без pow().
     */
    float normalFacing = clamp(normal.z, 0.0, 1.0);
    float grazingAngle = 1.0 - normalFacing;

    float fresnel = grazingAngle * grazingAngle;
    fresnel *= fresnel;

    glassColor += vec3(0.58, 0.82, 1.0)
      * fresnel
      * 0.24;

    /*
     * Pointer highlight без exp(), pow() и normalize().
     */
    vec2 normalizedDistance = (local - pointerLocal)
      / max(halfSize, vec2(1.0));

    vec2 stretchedDistance = normalizedDistance
      * vec2(0.72, 1.28);

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

    glassColor += vec3(1.0, 0.985, 0.96)
      * specular
      * 0.34;

    glassColor = clamp(glassColor, 0.0, 1.0);

    color = mix(
      color,
      glassColor,
      glassMask
    );
  }

  outColor = vec4(color, 1.0);
}