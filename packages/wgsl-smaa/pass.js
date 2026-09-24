// Shared by the pass modules: a fullscreen triangle or quad in clip space, and
// texture coordinates with the top-left origin the reference and WebGPU share.
// The reference computes the neighbor offsets in the vertex stage; here they
// are derived in the fragment stage from the texture size, which needs no
// uniform, and the vertex stage uses no binding.
export const vertex = /* wgsl */ `
struct VertexInput {
  @location(0) position: vec2f,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  return VertexOutput(
    vec4f(input.position, 0.0, 1.0),
    vec2f(input.position.x * 0.5 + 0.5, 0.5 - input.position.y * 0.5)
  );
}
`;
