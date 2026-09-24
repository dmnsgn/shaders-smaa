import edges from "./chunks/edges.wgsl.js";
import { vertex } from "./pass.js";

export default /* wgsl */ `${edges}
${vertex}
@group(0) @binding(0) var uPointSampler: sampler;
@group(0) @binding(1) var uDepthTexture: texture_depth_2d;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = 1.0 / vec2f(textureDimensions(uDepthTexture));
  let offsets = smaaEdgeDetectionOffsets(input.texCoord, texelSize);

  let edges = smaaDepthEdgeDetection(uDepthTexture, uPointSampler, input.texCoord, offsets[0]);

  return vec4f(edges, 0.0, 1.0);
}
`;
