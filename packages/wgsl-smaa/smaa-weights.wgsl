// SMAA pass 2: blending weight calculation. Searches the edges texture for
// the distance to each line end, then looks up the precomputed coverage area.
// Takes textures as parameters and declares no bindings.

// Range: [0, 112]. The maximum line length perfectly handled is 4x this.
override SMAA_MAX_SEARCH_STEPS: i32 = 16;
// Range: [0, 20]. Diagonal searches step one pixel at a time.
override SMAA_MAX_SEARCH_STEPS_DIAG: i32 = 8;
// Range: [0, 100]
override SMAA_CORNER_ROUNDING: i32 = 25;
override SMAA_DISABLE_DIAG_DETECTION: bool = false;
override SMAA_DISABLE_CORNER_DETECTION: bool = false;

const SMAA_AREATEX_MAX_DISTANCE: f32 = 16.0;
const SMAA_AREATEX_MAX_DISTANCE_DIAG: f32 = 20.0;
const SMAA_AREATEX_PIXEL_SIZE: vec2f = 1.0 / vec2f(160.0, 560.0);
const SMAA_AREATEX_SUBTEX_SIZE: f32 = 1.0 / 7.0;
const SMAA_SEARCHTEX_SIZE: vec2f = vec2f(66.0, 33.0);
const SMAA_SEARCHTEX_PACKED_SIZE: vec2f = vec2f(64.0, 16.0);

// Search start coordinates, a quarter texel off so one bilinear fetch reads
// four edges (@PSEUDO_GATHER4), then where the searches end. Affine in
// texCoord, so they can be computed in the vertex stage and interpolated.
fn smaaBlendingWeightCalculationOffsets(texCoord: vec2f, texelSize: vec2f) -> array<vec4f, 3> {
  let offset0 = texelSize.xyxy * vec4f(-0.25, -0.125, 1.25, -0.125) + texCoord.xyxy;
  let offset1 = texelSize.xyxy * vec4f(-0.125, -0.25, -0.125, 1.25) + texCoord.xyxy;
  let offset2 = texelSize.xxyy * vec4f(-2.0, 2.0, -2.0, 2.0) * f32(SMAA_MAX_SEARCH_STEPS) +
    vec4f(offset0.xz, offset1.yw);
  return array<vec4f, 3>(offset0, offset1, offset2);
}

// HLSL's round() takes halves away from zero, WGSL's to even: the decoders
// below depend on the former, and only see positive values.
fn smaaRound(x: vec2f) -> vec2f {
  return floor(x + 0.5);
}

fn smaaSampleLevelZeroOffset(
  tex: texture_2d<f32>,
  texSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  offset: vec2f
) -> vec4f {
  return textureSampleLevel(tex, texSampler, texCoord + offset * texelSize, 0.0);
}

// Decodes two binary values from a single bilinear-filtered fetch: taps at a
// 0.25 offset make the R and G edges land on distinguishable values
// (0.25 or 1.0, and 0.75 or 1.0).
fn smaaDecodeDiagBilinearAccess(e: vec2f) -> vec2f {
  return smaaRound(vec2f(e.r * abs(5.0 * e.r - 3.75), e.g));
}

fn smaaSearchDiag1(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  dir: vec2f,
  e: ptr<function, vec2f>
) -> vec2f {
  var coord = vec4f(texCoord, -1.0, 1.0);
  let t = vec3f(texelSize, 1.0);
  while (coord.z < f32(SMAA_MAX_SEARCH_STEPS_DIAG - 1) && coord.w > 0.9) {
    coord = vec4f(t * vec3f(dir, 1.0) + coord.xyz, coord.w);
    *e = textureSampleLevel(edgesTex, edgesSampler, coord.xy, 0.0).rg;
    coord.w = dot(*e, vec2f(0.5));
  }
  return coord.zw;
}

fn smaaSearchDiag2(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  dir: vec2f,
  e: ptr<function, vec2f>
) -> vec2f {
  // Offset by a quarter texel so both crossing edges come back in one
  // bilinear fetch (@SearchDiag2Optimization).
  var coord = vec4f(texCoord.x + 0.25 * texelSize.x, texCoord.y, -1.0, 1.0);
  let t = vec3f(texelSize, 1.0);
  while (coord.z < f32(SMAA_MAX_SEARCH_STEPS_DIAG - 1) && coord.w > 0.9) {
    coord = vec4f(t * vec3f(dir, 1.0) + coord.xyz, coord.w);
    *e = smaaDecodeDiagBilinearAccess(
      textureSampleLevel(edgesTex, edgesSampler, coord.xy, 0.0).rg
    );
    coord.w = dot(*e, vec2f(0.5));
  }
  return coord.zw;
}

// Area for a diagonal distance and crossing edges.
fn smaaAreaDiag(
  areaTex: texture_2d<f32>,
  areaSampler: sampler,
  dist: vec2f,
  e: vec2f,
  offset: f32
) -> vec2f {
  var texCoord = vec2f(SMAA_AREATEX_MAX_DISTANCE_DIAG) * e + dist;

  // Scale and bias to texel space
  texCoord = SMAA_AREATEX_PIXEL_SIZE * texCoord + 0.5 * SMAA_AREATEX_PIXEL_SIZE;
  // Diagonal areas live in the second half of the texture
  texCoord.x += 0.5;
  // Move to the subpixel offset's row
  texCoord.y += SMAA_AREATEX_SUBTEX_SIZE * offset;

  return textureSampleLevel(areaTex, areaSampler, texCoord, 0.0).rg;
}

fn smaaCalculateDiagWeights(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  areaTex: texture_2d<f32>,
  areaSampler: sampler,
  texelSize: vec2f,
  texCoord: vec2f,
  e: vec2f,
  subsampleIndices: vec4f
) -> vec2f {
  var weights = vec2f(0.0);

  // Search for the line ends
  var d = vec4f(0.0);
  var end = vec2f(0.0);
  if (e.r > 0.0) {
    let search = smaaSearchDiag1(edgesTex, edgesSampler, texelSize, texCoord, vec2f(-1.0, 1.0), &end);
    d.x = search.x + f32(end.y > 0.9);
    d.z = search.y;
  }
  let search = smaaSearchDiag1(edgesTex, edgesSampler, texelSize, texCoord, vec2f(1.0, -1.0), &end);
  d.y = search.x;
  d.w = search.y;

  if (d.x + d.y > 2.0) { // d.x + d.y + 1 > 3
    // Fetch the crossing edges
    let coords = vec4f(-d.x + 0.25, d.x, d.y, -d.y - 0.25) * texelSize.xyxy + texCoord.xyxy;
    let c = vec4f(
      smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.xy, vec2f(-1.0, 0.0)).rg,
      smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.zw, vec2f(1.0, 0.0)).rg
    );
    let decoded = vec4f(smaaDecodeDiagBilinearAccess(c.xy), smaaDecodeDiagBilinearAccess(c.zw));

    // Merge the crossing edges at each side into a single value
    var cc = vec2f(2.0) * decoded.yw + decoded.xz;

    // Remove the crossing edge if the end of the line wasn't found
    cc = select(cc, vec2f(0.0), d.zw >= vec2f(0.9));

    weights += smaaAreaDiag(areaTex, areaSampler, d.xy, cc, subsampleIndices.z);
  }

  // Search for the line ends
  let search2 = smaaSearchDiag2(edgesTex, edgesSampler, texelSize, texCoord, vec2f(-1.0, -1.0), &end);
  d.x = search2.x;
  d.z = search2.y;
  if (smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord, vec2f(1.0, 0.0)).r > 0.0) {
    let search3 = smaaSearchDiag2(edgesTex, edgesSampler, texelSize, texCoord, vec2f(1.0, 1.0), &end);
    d.y = search3.x + f32(end.y > 0.9);
    d.w = search3.y;
  } else {
    d.y = 0.0;
    d.w = 0.0;
  }

  if (d.x + d.y > 2.0) { // d.x + d.y + 1 > 3
    // Fetch the crossing edges
    let coords = vec4f(-d.x, -d.x, d.y, d.y) * texelSize.xyxy + texCoord.xyxy;
    let c = vec4f(
      smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.xy, vec2f(-1.0, 0.0)).g,
      smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.xy, vec2f(0.0, -1.0)).r,
      smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.zw, vec2f(1.0, 0.0)).gr
    );
    var cc = vec2f(2.0) * c.xz + c.yw;

    // Remove the crossing edge if the end of the line wasn't found
    cc = select(cc, vec2f(0.0), d.zw >= vec2f(0.9));

    weights += smaaAreaDiag(areaTex, areaSampler, d.xy, cc, subsampleIndices.w).gr;
  }

  return weights;
}

// How much length to add in the last step of a search: takes the bilinearly
// interpolated edge (@PSEUDO_GATHER4) and adds 0, 1 or 2.
fn smaaSearchLength(
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  e: vec2f,
  offset: f32
) -> f32 {
  // The texture is flipped vertically, with left and right cases taking half
  // the space horizontally.
  var scale = SMAA_SEARCHTEX_SIZE * vec2f(0.5, -1.0);
  var bias = SMAA_SEARCHTEX_SIZE * vec2f(offset, 1.0);

  // Scale and bias to texel centers
  scale += vec2f(-1.0, 1.0);
  bias += vec2f(0.5, -0.5);

  // Pixel coordinates to texcoords (the texture is cropped, hence the packed size)
  scale /= SMAA_SEARCHTEX_PACKED_SIZE;
  bias /= SMAA_SEARCHTEX_PACKED_SIZE;

  return textureSampleLevel(searchTex, searchSampler, scale * e + bias, 0.0).r;
}

// The search coordinates are offset by (-0.25, -0.125) in the vertex stage to
// sample between edges, fetching four in a row. Different offsets in each
// direction disambiguate which of them are active (@PSEUDO_GATHER4).
fn smaaSearchXLeft(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  texelSize: vec2f,
  texCoordStart: vec2f,
  end: f32
) -> f32 {
  var texCoord = texCoordStart;
  var e = vec2f(0.0, 1.0);
  // Stop at an unactivated edge, or at a crossing edge breaking the line
  while (texCoord.x > end && e.g > 0.8281 && e.r == 0.0) {
    e = textureSampleLevel(edgesTex, edgesSampler, texCoord, 0.0).rg;
    texCoord -= vec2f(2.0, 0.0) * texelSize;
  }
  let offset = -(255.0 / 127.0) * smaaSearchLength(searchTex, searchSampler, e, 0.0) + 3.25;
  return texelSize.x * offset + texCoord.x;
}

fn smaaSearchXRight(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  texelSize: vec2f,
  texCoordStart: vec2f,
  end: f32
) -> f32 {
  var texCoord = texCoordStart;
  var e = vec2f(0.0, 1.0);
  while (texCoord.x < end && e.g > 0.8281 && e.r == 0.0) {
    e = textureSampleLevel(edgesTex, edgesSampler, texCoord, 0.0).rg;
    texCoord += vec2f(2.0, 0.0) * texelSize;
  }
  let offset = -(255.0 / 127.0) * smaaSearchLength(searchTex, searchSampler, e, 0.5) + 3.25;
  return -texelSize.x * offset + texCoord.x;
}

fn smaaSearchYUp(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  texelSize: vec2f,
  texCoordStart: vec2f,
  end: f32
) -> f32 {
  var texCoord = texCoordStart;
  var e = vec2f(1.0, 0.0);
  while (texCoord.y > end && e.r > 0.8281 && e.g == 0.0) {
    e = textureSampleLevel(edgesTex, edgesSampler, texCoord, 0.0).rg;
    texCoord -= vec2f(0.0, 2.0) * texelSize;
  }
  let offset = -(255.0 / 127.0) * smaaSearchLength(searchTex, searchSampler, e.gr, 0.0) + 3.25;
  return texelSize.y * offset + texCoord.y;
}

fn smaaSearchYDown(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  texelSize: vec2f,
  texCoordStart: vec2f,
  end: f32
) -> f32 {
  var texCoord = texCoordStart;
  var e = vec2f(1.0, 0.0);
  while (texCoord.y < end && e.r > 0.8281 && e.g == 0.0) {
    e = textureSampleLevel(edgesTex, edgesSampler, texCoord, 0.0).rg;
    texCoord += vec2f(0.0, 2.0) * texelSize;
  }
  let offset = -(255.0 / 127.0) * smaaSearchLength(searchTex, searchSampler, e.gr, 0.5) + 3.25;
  return -texelSize.y * offset + texCoord.y;
}

// The distance and both crossing edges are known: look up the area at each
// side of the current edge.
fn smaaArea(
  areaTex: texture_2d<f32>,
  areaSampler: sampler,
  dist: vec2f,
  e1: f32,
  e2: f32,
  offset: f32
) -> vec2f {
  // Rounding prevents precision errors of bilinear filtering
  var texCoord = vec2f(SMAA_AREATEX_MAX_DISTANCE) * smaaRound(4.0 * vec2f(e1, e2)) + dist;

  texCoord = SMAA_AREATEX_PIXEL_SIZE * texCoord + 0.5 * SMAA_AREATEX_PIXEL_SIZE;
  texCoord.y = SMAA_AREATEX_SUBTEX_SIZE * offset + texCoord.y;

  return textureSampleLevel(areaTex, areaSampler, texCoord, 0.0).rg;
}

fn smaaDetectHorizontalCornerPattern(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  texelSize: vec2f,
  weights: vec2f,
  texCoord: vec4f,
  d: vec2f
) -> vec2f {
  if (SMAA_DISABLE_CORNER_DETECTION) {
    return weights;
  }

  let leftRight = step(d.xy, d.yx);
  // Reduce blending for pixels in the center of a line
  let rounding = (1.0 - f32(SMAA_CORNER_ROUNDING) / 100.0) * leftRight / (leftRight.x + leftRight.y);

  var factor = vec2f(1.0);
  factor.x -= rounding.x * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.xy, vec2f(0.0, 1.0)).r;
  factor.x -= rounding.y * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.zw, vec2f(1.0, 1.0)).r;
  factor.y -= rounding.x * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.xy, vec2f(0.0, -2.0)).r;
  factor.y -= rounding.y * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.zw, vec2f(1.0, -2.0)).r;

  return weights * saturate(factor);
}

fn smaaDetectVerticalCornerPattern(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  texelSize: vec2f,
  weights: vec2f,
  texCoord: vec4f,
  d: vec2f
) -> vec2f {
  if (SMAA_DISABLE_CORNER_DETECTION) {
    return weights;
  }

  let leftRight = step(d.xy, d.yx);
  let rounding = (1.0 - f32(SMAA_CORNER_ROUNDING) / 100.0) * leftRight / (leftRight.x + leftRight.y);

  var factor = vec2f(1.0);
  factor.x -= rounding.x * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.xy, vec2f(1.0, 0.0)).g;
  factor.x -= rounding.y * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.zw, vec2f(1.0, 1.0)).g;
  factor.y -= rounding.x * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.xy, vec2f(-2.0, 0.0)).g;
  factor.y -= rounding.y * smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, texCoord.zw, vec2f(-2.0, 1.0)).g;

  return weights * saturate(factor);
}

// Subsample indices are zero for SMAA 1x, see @SUBSAMPLE_INDICES in SMAA.hlsl
// for the temporal and multisampled modes.
fn smaaBlendingWeightCalculation(
  edgesTex: texture_2d<f32>,
  edgesSampler: sampler,
  areaTex: texture_2d<f32>,
  areaSampler: sampler,
  searchTex: texture_2d<f32>,
  searchSampler: sampler,
  viewportSize: vec2f,
  texelSize: vec2f,
  texCoord: vec2f,
  pixCoord: vec2f,
  offset0: vec4f,
  offset1: vec4f,
  offset2: vec4f,
  subsampleIndices: vec4f
) -> vec4f {
  var weights = vec4f(0.0);
  var e = textureSampleLevel(edgesTex, edgesSampler, texCoord, 0.0).rg;

  if (e.g > 0.0) { // Edge at north
    if (!SMAA_DISABLE_DIAG_DETECTION) {
      // Diagonals have both north and west edges, so searching one boundary
      // is enough.
      weights = vec4f(
        smaaCalculateDiagWeights(edgesTex, edgesSampler, areaTex, areaSampler, texelSize, texCoord, e, subsampleIndices),
        weights.ba
      );
    }

    // Diagonals take priority: finding one skips horizontal/vertical processing.
    if (weights.r == -weights.g) { // weights.r + weights.g == 0.0
      // Distance to the left
      var coords = vec3f(
        smaaSearchXLeft(edgesTex, edgesSampler, searchTex, searchSampler, texelSize, offset0.xy, offset2.x),
        offset1.y, // offset1.y = texCoord.y - 0.25 * texelSize.y (@CROSSING_OFFSET)
        0.0
      );

      // Fetch the left crossing edges, two at a time using bilinear filtering.
      // Sampling at -0.25 (@CROSSING_OFFSET) discerns what value each edge has.
      let e1 = textureSampleLevel(edgesTex, edgesSampler, coords.xy, 0.0).r;

      // Distance to the right
      coords.z = smaaSearchXRight(edgesTex, edgesSampler, searchTex, searchSampler, texelSize, offset0.zw, offset2.y);

      // In pixel units, so the area texture's quadratic compression applies
      let d = abs(smaaRound(viewportSize.xx * coords.xz - pixCoord.xx));

      // Fetch the right crossing edges
      let e2 = smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.zy, vec2f(1.0, 0.0)).r;

      weights = vec4f(smaaArea(areaTex, areaSampler, sqrt(d), e1, e2, subsampleIndices.y), weights.ba);

      // Fix corners
      coords.y = texCoord.y;
      weights = vec4f(
        smaaDetectHorizontalCornerPattern(edgesTex, edgesSampler, texelSize, weights.rg, coords.xyzy, d),
        weights.ba
      );
    } else {
      e.r = 0.0; // Skip vertical processing
    }
  }

  if (e.r > 0.0) { // Edge at west
    // Distance to the top
    var coords = vec3f(
      offset0.x, // offset0.x = texCoord.x - 0.25 * texelSize.x
      smaaSearchYUp(edgesTex, edgesSampler, searchTex, searchSampler, texelSize, offset1.xy, offset2.z),
      0.0
    );

    // Fetch the top crossing edges
    let e1 = textureSampleLevel(edgesTex, edgesSampler, coords.xy, 0.0).g;

    // Distance to the bottom
    coords.z = smaaSearchYDown(edgesTex, edgesSampler, searchTex, searchSampler, texelSize, offset1.zw, offset2.w);

    let d = abs(smaaRound(viewportSize.yy * coords.yz - pixCoord.yy));

    // Fetch the bottom crossing edges
    let e2 = smaaSampleLevelZeroOffset(edgesTex, edgesSampler, texelSize, coords.xz, vec2f(0.0, 1.0)).g;

    weights = vec4f(weights.rg, smaaArea(areaTex, areaSampler, sqrt(d), e1, e2, subsampleIndices.x));

    // Fix corners
    coords.x = texCoord.x;
    weights = vec4f(
      weights.rg,
      smaaDetectVerticalCornerPattern(edgesTex, edgesSampler, texelSize, weights.ba, coords.xyxz, d)
    );
  }

  return weights;
}


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
