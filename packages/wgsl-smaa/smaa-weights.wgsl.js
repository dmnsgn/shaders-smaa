import weights from "./chunks/weights.wgsl.js";
import { vertex } from "./pass.js";

export default /* wgsl */ `${weights}
${vertex}
@group(0) @binding(0) var uLinearSampler: sampler;
@group(0) @binding(1) var uEdgesTexture: texture_2d<f32>;
@group(0) @binding(2) var uAreaTexture: texture_2d<f32>;
@group(0) @binding(3) var uSearchTexture: texture_2d<f32>;
@group(0) @binding(4) var<uniform> uSubsampleIndices: vec4f;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let viewportSize = vec2f(textureDimensions(uEdgesTexture));
  let texelSize = 1.0 / viewportSize;
  let offsets = smaaBlendingWeightCalculationOffsets(input.texCoord, texelSize);

  return smaaBlendingWeightCalculation(
    uEdgesTexture,
    uLinearSampler,
    uAreaTexture,
    uLinearSampler,
    uSearchTexture,
    uLinearSampler,
    viewportSize,
    texelSize,
    input.texCoord,
    input.texCoord * viewportSize,
    offsets[0],
    offsets[1],
    offsets[2],
    uSubsampleIndices
  );
}
`;
