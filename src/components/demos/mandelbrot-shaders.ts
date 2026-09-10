const UNIFORMS = /* glsl */ `
uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uScale;
uniform float uMaxIter;
uniform vec3 uPaletteA;
uniform vec3 uPaletteB;
uniform vec3 uPaletteC;
uniform vec3 uPaletteD;
uniform vec3 uInterior;
uniform float uColorScale;
`;

const BODY = /* glsl */ `
  float minDim = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / minDim;
  vec2 c = uCenter + uv * uScale;
  vec2 z = vec2(0.0);
  float n = 0.0;
  bool escaped = false;
  const int MAX = 1024;
  int maxIter = int(uMaxIter + 0.5);

  for (int i = 0; i < MAX; i++) {
    if (i >= maxIter) break;
    float x2 = z.x * z.x;
    float y2 = z.y * z.y;
    if (x2 + y2 > 256.0) {
      escaped = true;
      break;
    }
    z = vec2(x2 - y2, 2.0 * z.x * z.y) + c;
    n += 1.0;
  }

  if (!escaped) {
    FRAG_COLOR = vec4(uInterior, 1.0);
    return;
  }

  float logZn = log(dot(z, z)) * 0.5;
  float nu = log(logZn * 1.44269504089) * 1.44269504089;
  float t = (n + 1.0 - nu) * uColorScale;
  vec3 col = uPaletteA + uPaletteB * cos(6.28318530718 * (uPaletteC * t + uPaletteD));
  col = pow(clamp(col, 0.0, 1.0), vec3(0.92));
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) / 255.0;
  FRAG_COLOR = vec4(col, 1.0);
`;

export const VS_WEBGL2 = /* glsl */ `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FS_WEBGL2 = /* glsl */ `#version 300 es
precision highp float;
${UNIFORMS}
out vec4 outColor;
void main() {
${BODY.replaceAll("FRAG_COLOR", "outColor")}
}
`;

export const VS_WEBGL1 = /* glsl */ `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FS_WEBGL1 = /* glsl */ `
precision highp float;
${UNIFORMS}
void main() {
${BODY.replaceAll("FRAG_COLOR", "gl_FragColor")}
}
`;
