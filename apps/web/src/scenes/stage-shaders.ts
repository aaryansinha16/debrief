// GLSL shared by the stages: a screen-space quad for one line segment (D-055) and the flat fragment that draws it.
// `quadLine` trims the segment at the near plane in view space, projects both ends and offsets this vertex by
// `side × uLineWidth / 2` device pixels along the screen-space normal, keeping the near end's depth.
export const QUAD_LINE_GLSL = `
uniform vec2 uResolution;
uniform float uNear;
uniform float uLineWidth;
vec4 quadLine(vec3 from, vec3 to, float side) {
  vec4 a = modelViewMatrix * vec4(from, 1.0);
  vec4 b = modelViewMatrix * vec4(to, 1.0);
  float nearZ = -uNear;
  if (a.z > nearZ && b.z > nearZ) return vec4(0.0, 0.0, 2.0, 1.0);
  if (a.z > nearZ) a = mix(a, b, (nearZ - a.z) / (b.z - a.z));
  else if (b.z > nearZ) b = mix(b, a, (nearZ - b.z) / (a.z - b.z));
  vec4 clipA = projectionMatrix * a;
  vec4 clipB = projectionMatrix * b;
  vec2 pxA = (clipA.xy / clipA.w * 0.5 + 0.5) * uResolution;
  vec2 pxB = (clipB.xy / clipB.w * 0.5 + 0.5) * uResolution;
  vec2 d = pxB - pxA;
  float len = length(d);
  vec2 dir = len > 0.0 ? d / len : vec2(1.0, 0.0);
  vec2 px = pxA + vec2(-dir.y, dir.x) * side * uLineWidth * 0.5;
  return vec4((px / uResolution * 2.0 - 1.0) * clipA.w, clipA.z, clipA.w);
}
`;

export const FLAT_FRAGMENT = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`;

export const LINE_PX = 1.5;
