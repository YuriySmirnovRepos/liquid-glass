#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTexture;
uniform vec2 uDirection;

/*
 * Разрешение ЦЕЛИ прохода: шаг тексела должен быть одинаковым
 * для горизонтального и вертикального проходов, иначе даунсемплящий
 * проход размывает вдвое слабее и ядро становится анизотропным.
 */
uniform vec2 uOutputResolution;
uniform float uStrength;

out vec4 outColor;

void main() {
  vec2 texel = 1.0 / uOutputResolution;

  vec2 offset1 = uDirection
    * texel
    * 1.384615
    * uStrength;

  vec2 offset2 = uDirection
    * texel
    * 3.230769
    * uStrength;

  vec3 color = texture(uTexture, vUv).rgb * 0.227027;

  color += texture(uTexture, vUv + offset1).rgb * 0.316216;
  color += texture(uTexture, vUv - offset1).rgb * 0.316216;

  color += texture(uTexture, vUv + offset2).rgb * 0.070270;
  color += texture(uTexture, vUv - offset2).rgb * 0.070270;

  outColor = vec4(color, 1.0);
}