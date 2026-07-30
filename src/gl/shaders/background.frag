#version 300 es
precision highp float;

in vec2 vUv;

uniform vec2 uResolution;
uniform float uTime;

out vec4 outColor;

float inverseSmoothstep(float edge0, float edge1, float value) {
  return 1.0 - smoothstep(edge0, edge1, value);
}

float blob(vec2 point, vec2 center, float radius) {
  return inverseSmoothstep(
    radius * 0.25,
    radius,
    length(point - center)
  );
}

void main() {
  vec2 point = (vUv - 0.5) * vec2(
    uResolution.x / uResolution.y,
    1.0
  );

  float time = uTime * 0.09;

  float blue = blob(
    point,
    vec2(
      -0.34 + 0.28 * sin(time),
      0.24 + 0.20 * cos(time * 0.70)
    ),
    0.63
  );

  float purple = blob(
    point,
    vec2(
      0.31 + 0.35 * cos(time * 0.80),
      -0.18 + 0.24 * sin(time)
    ),
    0.61
  );

  float cyan = blob(
    point,
    vec2(
      0.04 + 0.31 * sin(time * 0.53),
      0.34 + 0.21 * cos(time * 0.60)
    ),
    0.47
  );

  vec3 color = vec3(0.012, 0.022, 0.060);

  color += vec3(0.06, 0.30, 1.00) * blue;
  color += vec3(0.72, 0.10, 0.92) * purple;
  color += vec3(0.00, 0.82, 0.68) * cyan;

  float grain = fract(
    sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)))
    * 43758.5453
  );

  color += (grain - 0.5) * 0.014;

  outColor = vec4(color, 1.0);
}