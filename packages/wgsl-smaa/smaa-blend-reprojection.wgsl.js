import blend from "./chunks/blend.wgsl.js";
import velocity from "./chunks/velocity.wgsl.js";
import { vertex } from "./pass.js";

export default /* wgsl */ `${velocity}
${blend}
${vertex}
@group(0) @binding(0) var uLinearSampler: sampler;
@group(0) @binding(1) var uColorTexture: texture_2d<f32>;
@group(0) @binding(2) var uBlendTexture: texture_2d<f32>;
@group(0) @binding(3) var uVelocityTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let texelSize = 1.0 / vec2f(textureDimensions(uColorTexture));

  return smaaNeighborhoodBlendingReprojection(
    uColorTexture,
    uLinearSampler,
    uBlendTexture,
    uLinearSampler,
    uVelocityTexture,
    uLinearSampler,
    texelSize,
    input.texCoord,
    smaaNeighborhoodBlendingOffset(input.texCoord, texelSize)
  );
}
`;
