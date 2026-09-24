// Default velocity decoding for the blend and resolve chunks: velocity stored
// in the red and green channels, in texture coordinates, pointing from the
// previous frame to the current one. Replace it with your own
// smaaDecodeVelocity() when yours is encoded or points the other way.
fn smaaDecodeVelocity(sample: vec4f) -> vec2f {
  return sample.rg;
}
