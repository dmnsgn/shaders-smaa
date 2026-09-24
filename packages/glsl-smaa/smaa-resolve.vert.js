export default /* glsl */ `attribute vec2 aPosition;

varying vec2 vTexCoord0;

void main() {
  vTexCoord0 = vec2((aPosition + 1.0) / 2.0);

  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;
