export default /* wgsl */ `// SMAA temporal resolve (optional pass): blends the current frame with the
// previous one for the 2x temporal modes. Takes textures as parameters and
// declares no bindings. Requires smaaDecodeVelocity(), eg. from the velocity
// chunk.

// Range: [0, 80]. The higher, the sooner a moving pixel stops blending with
// its history.
override SMAA_REPROJECTION_WEIGHT_SCALE: f32 = 30.0;

fn smaaResolve(
  currentColorTex: texture_2d<f32>,
  previousColorTex: texture_2d<f32>,
  colorSampler: sampler,
  texCoord: vec2f
) -> vec4f {
  let current = textureSampleLevel(currentColorTex, colorSampler, texCoord, 0.0);
  let previous = textureSampleLevel(previousColorTex, colorSampler, texCoord, 0.0);
  return mix(current, previous, 0.5);
}

// Expects the current color's alpha written by
// smaaNeighborhoodBlendingReprojection, and the same velocity texture.
fn smaaResolveReprojection(
  currentColorTex: texture_2d<f32>,
  previousColorTex: texture_2d<f32>,
  colorSampler: sampler,
  velocityTex: texture_2d<f32>,
  velocitySampler: sampler,
  texCoord: vec2f
) -> vec4f {
  // Velocity is assumed to be calculated for motion blur, so it is inverted
  // for reprojection
  let velocity = -smaaDecodeVelocity(textureSampleLevel(velocityTex, velocitySampler, texCoord, 0.0));

  let current = textureSampleLevel(currentColorTex, colorSampler, texCoord, 0.0);
  let previous = textureSampleLevel(previousColorTex, colorSampler, texCoord + velocity, 0.0);

  // Attenuate the previous pixel if the velocity is different
  let delta = abs(current.a * current.a - previous.a * previous.a) / 5.0;
  let weight = 0.5 * saturate(1.0 - sqrt(delta) * SMAA_REPROJECTION_WEIGHT_SCALE);

  return mix(current, previous, weight);
}
`;
