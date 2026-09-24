import edges from "./chunks/edges.wgsl.js";
import { vertex } from "./pass.js";

export default /* wgsl */ `${edges}
${vertex}
@group(0) @binding(0) var uPointSampler: sampler;
@group(0) @binding(1) var uColorTexture: texture_2d<f32>;
@group(0) @binding(2) var uDepthTexture: texture_depth_2d;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = 1.0 / vec2f(textureDimensions(uColorTexture));
  let offsets = smaaEdgeDetectionOffsets(input.texCoord, texelSize);

  let edges = smaaLumaEdgeDetection(
    uColorTexture,
    uPointSampler,
    input.texCoord,
    offsets[0],
    offsets[1],
    offsets[2],
    smaaCalculatePredicatedThreshold(uDepthTexture, uPointSampler, input.texCoord, offsets[0])
  );

  return vec4f(edges, 0.0, 1.0);
}
`;
