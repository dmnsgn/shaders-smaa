export default /* wgsl */ `// SMAA pass 3: neighborhood blending. Mixes each pixel with the neighbor its
// blending weights point at, exploiting bilinear filtering to do it in one tap
// per direction. Takes textures as parameters and declares no bindings.
// Requires smaaDecodeVelocity(), eg. from the velocity chunk.

// Coordinates of the right and top neighbors' weights. Affine in texCoord, so
// they can be computed in the vertex stage and interpolated.
fn smaaNeighborhoodBlendingOffset(texCoord: vec2f, texelSize: vec2f) -> vec4f {
  return texelSize.xyxy * vec4f(1.0, 0.0, 0.0, 1.0) + texCoord.xyxy;
}

// Where to sample the color, and how much of each tap to take. Without any
// blending weight, it is the pixel itself at full weight.
struct SmaaBlendingTaps {
  coords: vec4f,
  weights: vec2f,
}

fn smaaNeighborhoodBlendingTaps(
  blendTex: texture_2d<f32>,
  blendSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  offset: vec4f
) -> SmaaBlendingTaps {
  // Fetch the blending weights for the current pixel
  let bottomLeft = textureSampleLevel(blendTex, blendSampler, texCoord, 0.0);
  let a = vec4f(
    textureSampleLevel(blendTex, blendSampler, offset.xy, 0.0).a, // Right
    textureSampleLevel(blendTex, blendSampler, offset.zw, 0.0).g, // Top
    bottomLeft.z, // Left
    bottomLeft.x // Bottom
  );

  // Is there any blending weight with a value greater than 0.0?
  if (dot(a, vec4f(1.0)) < 1e-5) {
    return SmaaBlendingTaps(texCoord.xyxy, vec2f(1.0, 0.0));
  }

  let h = max(a.x, a.z) > max(a.y, a.w); // max(horizontal) > max(vertical)

  let blendingOffset = select(vec4f(0.0, a.y, 0.0, a.w), vec4f(a.x, 0.0, a.z, 0.0), h);
  var blendingWeight = select(a.yw, a.xz, h);
  blendingWeight /= dot(blendingWeight, vec2f(1.0));

  return SmaaBlendingTaps(
    blendingOffset * vec4f(texelSize, -texelSize) + texCoord.xyxy,
    blendingWeight
  );
}

fn smaaNeighborhoodBlendingSample(
  tex: texture_2d<f32>,
  texSampler: sampler,
  taps: SmaaBlendingTaps
) -> vec4f {
  // Bilinear filtering mixes the current pixel with the chosen neighbor
  var color = taps.weights.x * textureSampleLevel(tex, texSampler, taps.coords.xy, 0.0);
  if (taps.weights.y > 0.0) {
    color += taps.weights.y * textureSampleLevel(tex, texSampler, taps.coords.zw, 0.0);
  }
  return color;
}

fn smaaNeighborhoodBlending(
  colorTex: texture_2d<f32>,
  colorSampler: sampler,
  blendTex: texture_2d<f32>,
  blendSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  offset: vec4f
) -> vec4f {
  let taps = smaaNeighborhoodBlendingTaps(blendTex, blendSampler, texelSize, texCoord, offset);
  return smaaNeighborhoodBlendingSample(colorTex, colorSampler, taps);
}

// Packs the antialiased velocity into the alpha channel, for
// smaaResolveReprojection.
fn smaaNeighborhoodBlendingReprojection(
  colorTex: texture_2d<f32>,
  colorSampler: sampler,
  blendTex: texture_2d<f32>,
  blendSampler: sampler,
  velocityTex: texture_2d<f32>,
  velocitySampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  offset: vec4f
) -> vec4f {
  let taps = smaaNeighborhoodBlendingTaps(blendTex, blendSampler, texelSize, texCoord, offset);
  let color = smaaNeighborhoodBlendingSample(colorTex, colorSampler, taps);
  // Decoded per tap, as the decoding need not be linear
  var velocity = taps.weights.x *
    smaaDecodeVelocity(textureSampleLevel(velocityTex, velocitySampler, taps.coords.xy, 0.0));
  if (taps.weights.y > 0.0) {
    velocity += taps.weights.y *
      smaaDecodeVelocity(textureSampleLevel(velocityTex, velocitySampler, taps.coords.zw, 0.0));
  }
  return vec4f(color.rgb, sqrt(5.0 * length(velocity)));
}
`;
