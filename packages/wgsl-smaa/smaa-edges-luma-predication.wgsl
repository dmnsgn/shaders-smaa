// SMAA pass 1: edge detection. Writes the left/top edge pair, and discards
// where there is none: the stencil-like early out the reference relies on.
// Takes textures as parameters and declares no bindings.

override SMAA_THRESHOLD: f32 = 0.1;
override SMAA_DEPTH_THRESHOLD: f32 = 0.1 * SMAA_THRESHOLD;
override SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR: f32 = 2.0;

// Threshold to be used in the predication texture. Depends on its content.
override SMAA_PREDICATION_THRESHOLD: f32 = 0.01;
// How much to scale the global threshold when using predication. Range: [1, 5]
override SMAA_PREDICATION_SCALE: f32 = 2.0;
// How much to locally decrease the threshold. Range: [0, 1]
override SMAA_PREDICATION_STRENGTH: f32 = 0.4;

// Edge detection expects gamma-encoded color: sampling an `-srgb` texture
// decodes it to linear, so it has to be re-encoded before thresholding.
override SMAA_SRGB_INPUT: bool = false;

// Neighbor coordinates for the edge detection functions. Affine in texCoord,
// so they can be computed in the vertex stage and interpolated.
fn smaaEdgeDetectionOffsets(texCoord: vec2f, texelSize: vec2f) -> array<vec4f, 3> {
  return array<vec4f, 3>(
    texelSize.xyxy * vec4f(-1.0, 0.0, 0.0, -1.0) + texCoord.xyxy,
    texelSize.xyxy * vec4f(1.0, 0.0, 0.0, 1.0) + texCoord.xyxy,
    texelSize.xyxy * vec4f(-2.0, 0.0, 0.0, -2.0) + texCoord.xyxy
  );
}

fn smaaSampleColor(tex: texture_2d<f32>, texSampler: sampler, texCoord: vec2f) -> vec3f {
  let color = textureSampleLevel(tex, texSampler, texCoord, 0.0).rgb;
  if (!SMAA_SRGB_INPUT) {
    return color;
  }
  return select(
    color * 12.92,
    1.055 * pow(color, vec3f(1.0 / 2.4)) - 0.055,
    color >= vec3f(0.0031308)
  );
}

// Gathers current pixel, and the top-left neighbors.
fn smaaGatherNeighbours(
  tex: texture_depth_2d,
  texSampler: sampler,
  texCoord: vec2f,
  offset0: vec4f
) -> vec3f {
  return vec3f(
    textureSampleLevel(tex, texSampler, texCoord, 0),
    textureSampleLevel(tex, texSampler, offset0.xy, 0),
    textureSampleLevel(tex, texSampler, offset0.zw, 0)
  );
}

// Lowers the threshold where the predication texture has an edge, so the
// global threshold can be higher.
fn smaaCalculatePredicatedThreshold(
  predicationTex: texture_depth_2d,
  predicationSampler: sampler,
  texCoord: vec2f,
  offset0: vec4f
) -> vec2f {
  let neighbours = smaaGatherNeighbours(predicationTex, predicationSampler, texCoord, offset0);
  let delta = abs(neighbours.xx - neighbours.yz);
  let edges = step(vec2f(SMAA_PREDICATION_THRESHOLD), delta);
  return SMAA_PREDICATION_SCALE * SMAA_THRESHOLD * (1.0 - SMAA_PREDICATION_STRENGTH * edges);
}

// Threshold is vec2f(SMAA_THRESHOLD), or smaaCalculatePredicatedThreshold().
fn smaaLumaEdgeDetection(
  colorTex: texture_2d<f32>,
  colorSampler: sampler,
  texCoord: vec2f,
  offset0: vec4f,
  offset1: vec4f,
  offset2: vec4f,
  threshold: vec2f
) -> vec2f {
  let weights = vec3f(0.2126, 0.7152, 0.0722);
  let L = dot(smaaSampleColor(colorTex, colorSampler, texCoord), weights);

  let Lleft = dot(smaaSampleColor(colorTex, colorSampler, offset0.xy), weights);
  let Ltop = dot(smaaSampleColor(colorTex, colorSampler, offset0.zw), weights);

  var delta = vec4f(abs(L - vec2f(Lleft, Ltop)), 0.0, 0.0);
  var edges = step(threshold, delta.xy);

  if (dot(edges, vec2f(1.0)) == 0.0) {
    discard;
  }

  let Lright = dot(smaaSampleColor(colorTex, colorSampler, offset1.xy), weights);
  let Lbottom = dot(smaaSampleColor(colorTex, colorSampler, offset1.zw), weights);
  delta = vec4f(delta.xy, abs(L - vec2f(Lright, Lbottom)));

  // Maximum delta in the direct neighborhood
  var maxDelta = max(delta.xy, delta.zw);

  let Lleftleft = dot(smaaSampleColor(colorTex, colorSampler, offset2.xy), weights);
  let Ltoptop = dot(smaaSampleColor(colorTex, colorSampler, offset2.zw), weights);
  delta = vec4f(delta.xy, abs(vec2f(Lleft, Ltop) - vec2f(Lleftleft, Ltoptop)));

  maxDelta = max(maxDelta, delta.zw);
  let finalDelta = max(maxDelta.x, maxDelta.y);

  // Local contrast adaptation
  edges *= step(vec2f(finalDelta), SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR * delta.xy);

  return edges;
}

fn smaaColorDelta(a: vec3f, b: vec3f) -> f32 {
  let t = abs(a - b);
  return max(max(t.r, t.g), t.b);
}

// Threshold is vec2f(SMAA_THRESHOLD), or smaaCalculatePredicatedThreshold().
fn smaaColorEdgeDetection(
  colorTex: texture_2d<f32>,
  colorSampler: sampler,
  texCoord: vec2f,
  offset0: vec4f,
  offset1: vec4f,
  offset2: vec4f,
  threshold: vec2f
) -> vec2f {
  let C = smaaSampleColor(colorTex, colorSampler, texCoord);

  let Cleft = smaaSampleColor(colorTex, colorSampler, offset0.xy);
  let Ctop = smaaSampleColor(colorTex, colorSampler, offset0.zw);
  var delta = vec4f(smaaColorDelta(C, Cleft), smaaColorDelta(C, Ctop), 0.0, 0.0);

  var edges = step(threshold, delta.xy);

  if (dot(edges, vec2f(1.0)) == 0.0) {
    discard;
  }

  let Cright = smaaSampleColor(colorTex, colorSampler, offset1.xy);
  let Cbottom = smaaSampleColor(colorTex, colorSampler, offset1.zw);
  delta = vec4f(delta.xy, smaaColorDelta(C, Cright), smaaColorDelta(C, Cbottom));

  var maxDelta = max(delta.xy, delta.zw);

  let Cleftleft = smaaSampleColor(colorTex, colorSampler, offset2.xy);
  let Ctoptop = smaaSampleColor(colorTex, colorSampler, offset2.zw);
  delta = vec4f(delta.xy, smaaColorDelta(C, Cleftleft), smaaColorDelta(C, Ctoptop));

  maxDelta = max(maxDelta, delta.zw);
  let finalDelta = max(maxDelta.x, maxDelta.y);

  edges *= step(vec2f(finalDelta), SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR * delta.xy);

  return edges;
}

fn smaaDepthEdgeDetection(
  depthTex: texture_depth_2d,
  depthSampler: sampler,
  texCoord: vec2f,
  offset0: vec4f
) -> vec2f {
  let neighbours = smaaGatherNeighbours(depthTex, depthSampler, texCoord, offset0);
  let delta = abs(neighbours.xx - neighbours.yz);
  let edges = step(vec2f(SMAA_DEPTH_THRESHOLD), delta);

  if (dot(edges, vec2f(1.0)) == 0.0) {
    discard;
  }

  return edges;
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
