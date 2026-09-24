export default /* glsl */ `
#define mad(a, b, c) (a * b + c)

attribute vec2 aPosition;

uniform vec2 uTexelSize;

varying vec2 vTexCoord0;
varying vec4 vOffset[3];

void main() {
	vTexCoord0 = vec2((aPosition + 1.0) / 2.0);

  vOffset[0] = mad(vec4(uTexelSize, uTexelSize), vec4(-1.0, 0.0, 0.0, -1.0), vTexCoord0.xyxy);
  vOffset[1] = mad(vec4(uTexelSize, uTexelSize), vec4( 1.0, 0.0, 0.0,  1.0), vTexCoord0.xyxy);
  vOffset[2] = mad(vec4(uTexelSize, uTexelSize), vec4(-2.0, 0.0, 0.0, -2.0), vTexCoord0.xyxy);

  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;
