import resolve from "./chunks/resolve.wgsl.js";
import velocity from "./chunks/velocity.wgsl.js";
import { vertex } from "./pass.js";

export default /* wgsl */ `${velocity}
${resolve}
${vertex}
@group(0) @binding(0) var uPointSampler: sampler;
@group(0) @binding(1) var uCurrentColorTexture: texture_2d<f32>;
@group(0) @binding(2) var uPreviousColorTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return smaaResolve(
    uCurrentColorTexture,
    uPreviousColorTexture,
    uPointSampler,
    input.texCoord
  );
}
`;
