import * as gpu from "pex-gpu";
import { mat4 } from "pex-math";
import { cube, icosahedron, torus, utils } from "primitive-geometry";
import { Pane } from "tweakpane";

import {
  SMAATextures,
  PRESETS,
  SMAA_EDGES_LUMA,
  SMAA_EDGES_COLOR,
  SMAA_EDGES_DEPTH,
  SMAA_EDGES_LUMA_PREDICATION,
  SMAA_EDGES_COLOR_PREDICATION,
  SMAA_WEIGHTS,
  SMAA_BLEND,
  SMAA_BLEND_REPROJECTION,
  SMAA_RESOLVE,
  SMAA_RESOLVE_REPROJECTION,
} from "../index.js";

const ctx = await gpu.createContext({ depth: false });

const options = {
  smaa: true,
  edges: "luma",
  predication: false,
  preset: "high",
  mode: "1x",
  reprojection: true,
  output: "result",
  animate: true,
  speed: 0.3,
};

const pane = new Pane({ title: "wgsl-smaa" });
pane.addBinding(options, "smaa", { label: "SMAA" });
pane.addBinding(options, "edges", {
  options: { luma: "luma", color: "color", depth: "depth" },
});
pane.addBinding(options, "predication");
pane.addBinding(options, "preset", {
  options: { low: "low", medium: "medium", high: "high", ultra: "ultra" },
});
pane.addBinding(options, "mode", { options: { "1x": "1x", T2x: "T2x" } });
pane.addBinding(options, "reprojection");
pane.addBinding(options, "output", {
  options: {
    result: "result",
    edges: "edges",
    weights: "weights",
    velocity: "velocity",
  },
});
pane.addBinding(options, "animate");
pane.addBinding(options, "speed", { min: 0, max: 3 });

// T2x camera jitters in pixels (y up) and their subsample indices, as in the
// reference's table.
const SUBSAMPLES = [
  { jitter: [0.25, -0.25], indices: [1, 1, 1, 0] },
  { jitter: [-0.25, 0.25], indices: [2, 2, 2, 0] },
];

// Lookup textures: no flipY, sampled linearly as the reference's samplers.
const loadImage = async (src) =>
  createImageBitmap(await (await fetch(src)).blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });

const [areaTexture, searchTexture] = (
  await Promise.all([
    loadImage(SMAATextures.area),
    loadImage(SMAATextures.search),
  ])
).map((data) => gpu.createTexture(ctx, { data, format: "rgba8unorm" }));

const linearSampler = gpu.createSampler(ctx, { filter: "linear" });
// Non-filtering: required to sample depth
const pointSampler = gpu.createSampler(ctx, { filter: "nearest" });

// Render targets
const createTargets = () => ({
  color: gpu.createTexture(ctx, {
    width: ctx.width,
    height: ctx.height,
    format: "rgba8unorm",
  }),
  depth: gpu.createTexture(ctx, {
    width: ctx.width,
    height: ctx.height,
    format: "depth24plus",
  }),
  edges: gpu.createTexture(ctx, {
    width: ctx.width,
    height: ctx.height,
    format: "rg8unorm",
  }),
  weights: gpu.createTexture(ctx, {
    width: ctx.width,
    height: ctx.height,
    format: "rgba8unorm",
  }),
  velocity: gpu.createTexture(ctx, {
    width: ctx.width,
    height: ctx.height,
    format: "rg16float",
  }),
  // Current and previous blend outputs, for the temporal resolve
  history: [0, 1].map(() =>
    gpu.createTexture(ctx, {
      width: ctx.width,
      height: ctx.height,
      format: "rgba8unorm",
    }),
  ),
});
let targets = createTargets();

// Scene: flat primitives whose silhouettes alias, and their velocity for the
// temporal reprojection.
const sceneShader = /* wgsl */ `
struct Uniforms {
  projection: mat4x4f,
  view: mat4x4f,
  model: mat4x4f,
  previousModel: mat4x4f,
  color: vec4f,
  jitter: vec2f,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
}
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) normal: vec3f,
  @location(1) objectPosition: vec3f,
  @location(2) currentPosition: vec4f,
  @location(3) previousPosition: vec4f,
}
struct FragmentOutput {
  @location(0) color: vec4f,
  @location(1) velocity: vec4f,
}

@vertex
fn vertexMain(input: VertexInput) -> VertexOutput {
  let viewProjection = uniforms.projection * uniforms.view;
  let current = viewProjection * uniforms.model * vec4f(input.position, 1.0);
  // Jitter in clip space, so it stays out of the velocity
  return VertexOutput(
    vec4f(current.xy + uniforms.jitter * current.w, current.zw),
    (uniforms.model * vec4f(input.normal, 0.0)).xyz,
    input.position,
    current,
    viewProjection * uniforms.previousModel * vec4f(input.position, 1.0)
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
  let diffuse = max(dot(normalize(input.normal), normalize(vec3f(1.0, 2.0, 3.0))), 0.0);
  // Low contrast stripes with no depth edge: detected at the base threshold,
  // skipped once predication raises it away from depth edges.
  let stripes = mix(1.0, 0.65, step(0.5, fract(input.objectPosition.y * 6.0)));
  // Gamma-encoded output, as edge detection expects.
  let color = pow(uniforms.color.rgb * stripes * (0.2 + 0.8 * diffuse), vec3f(1.0 / 2.2));

  // In texture coordinates (y down), from the previous frame to the current one
  let velocity = vec2f(0.5, -0.5) * (
    input.currentPosition.xy / input.currentPosition.w -
    input.previousPosition.xy / input.previousPosition.w
  );

  return FragmentOutput(vec4f(color, 1.0), vec4f(velocity, 0.0, 1.0));
}
`;

const scenePipeline = gpu.definePipeline({
  shader: sceneShader,
  depthWriteEnabled: true,
  cullMode: "back",
});

const projection = mat4.create();
// Updated in place: the commands hold a reference
const jitter = new Float32Array(2);
const view = mat4.lookAt(mat4.create(), [0, 1.5, 6], [0, 0, 0], [0, 1, 0]);

const meshes = [
  [cube({ sx: 1.2 }), [-2.2, 0, 0], [0.9, 0.3, 0.2, 1]],
  [icosahedron({ radius: 0.8 }), [0, 0, 0], [0.2, 0.6, 0.9, 1]],
  [torus({ radius: 0.6, minorRadius: 0.25 }), [2.2, 0, 0], [0.9, 0.8, 0.2, 1]],
].map(([geometry, position, color]) => {
  const model = mat4.create();
  const previousModel = mat4.create();
  return {
    position,
    model,
    previousModel,
    cmd: gpu.defineCommand({
      pipeline: scenePipeline,
      attributes: {
        position: gpu.createBuffer(ctx, {
          usage: "vertex",
          data: geometry.positions,
        }),
        normal: gpu.createBuffer(ctx, {
          usage: "vertex",
          data: geometry.normals,
        }),
      },
      indices: gpu.createBuffer(ctx, { usage: "index", data: geometry.cells }),
      uniforms: { projection, view, model, previousModel, color, jitter },
    }),
  };
});

const scenePass = gpu.definePass({
  colorAttachments: [
    { texture: targets.color, clearValue: [0.1, 0.1, 0.1, 1] },
    { texture: targets.velocity, clearValue: [0, 0, 0, 0] },
  ],
  depthStencilAttachment: targets.depth,
  depthClearValue: 1,
});

// SMAA passes: fullscreen triangles, one pipeline per variant. Presets are
// override constants, so they switch pipeline variants, not shaders.
const fullscreen = {
  position: gpu.createBuffer(ctx, {
    usage: "vertex",
    data: utils.fullscreenTriangle().positions,
  }),
};

const edgesPipelines = Object.fromEntries(
  Object.entries({
    luma: SMAA_EDGES_LUMA,
    color: SMAA_EDGES_COLOR,
    depth: SMAA_EDGES_DEPTH,
    "luma-predication": SMAA_EDGES_LUMA_PREDICATION,
    "color-predication": SMAA_EDGES_COLOR_PREDICATION,
  }).map(([name, shader]) => [name, gpu.definePipeline({ shader })]),
);
const weightsPipeline = gpu.definePipeline({ shader: SMAA_WEIGHTS });
const blendPipelines = [SMAA_BLEND, SMAA_BLEND_REPROJECTION].map((shader) =>
  gpu.definePipeline({ shader }),
);
const resolvePipelines = [SMAA_RESOLVE, SMAA_RESOLVE_REPROJECTION].map(
  (shader) => gpu.definePipeline({ shader }),
);

const edgesPass = gpu.definePass({
  colorAttachments: [{ texture: targets.edges, clearValue: [0, 0, 0, 0] }],
});
const weightsPass = gpu.definePass({
  colorAttachments: [{ texture: targets.weights, clearValue: [0, 0, 0, 0] }],
});
const historyPasses = targets.history.map((texture) =>
  gpu.definePass({ colorAttachments: [{ texture }] }),
);
const canvasPass = gpu.definePass({ clearValue: [0, 0, 0, 1] });

const blitPipeline = gpu.definePipeline({
  shader: /* wgsl */ `
@group(0) @binding(0) var uSampler: sampler;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> uScale: f32;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texCoord: vec2f,
}

@vertex
fn vertexMain(@location(0) position: vec2f) -> VertexOutput {
  return VertexOutput(
    vec4f(position, 0.0, 1.0),
    vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5)
  );
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return vec4f(abs(textureSample(uTexture, uSampler, input.texCoord).rgb) * uScale, 1.0);
}
`,
});
const blit = (texture, scale = 1) =>
  gpu.submit(ctx, {
    pipeline: blitPipeline,
    attributes: fullscreen,
    count: 3,
    uniforms: { uSampler: pointSampler, uTexture: texture, uScale: scale },
  });

window.addEventListener("resize", () => {
  gpu.resize(ctx, window.innerWidth, window.innerHeight);
});

let time = 0;
let frame = 0;

gpu.frame(ctx, ({ resized }) => {
  if (options.animate) time += (1 / 60) * options.speed;
  frame++;

  if (resized) {
    for (const texture of Object.values(targets).flat()) texture.dispose();
    targets = createTargets();
    scenePass.colorAttachments[0].texture = targets.color;
    scenePass.colorAttachments[1].texture = targets.velocity;
    historyPasses.forEach((pass, i) => {
      pass.colorAttachments[0].texture = targets.history[i];
    });
    scenePass.depthStencilAttachment = targets.depth;
    edgesPass.colorAttachments[0].texture = targets.edges;
    weightsPass.colorAttachments[0].texture = targets.weights;
  }

  mat4.perspectiveZO(projection, Math.PI / 4, ctx.width / ctx.height, 1, 20);

  const temporal = options.smaa && options.mode === "T2x";
  const reprojection = temporal && options.reprojection;
  const subsample = SUBSAMPLES[frame % 2];
  // Pixels to clip space
  jitter[0] = temporal ? (2 * subsample.jitter[0]) / ctx.width : 0;
  jitter[1] = temporal ? (2 * subsample.jitter[1]) / ctx.height : 0;

  gpu.submit(ctx, { pass: scenePass }, () => {
    for (const { position, model, previousModel, cmd } of meshes) {
      mat4.set(previousModel, model);
      mat4.identity(model);
      mat4.translate(model, position);
      mat4.rotate(model, time, [0.3, 1, 0.2]);
      gpu.submit(ctx, cmd);
    }
  });

  if (!options.smaa) {
    gpu.submit(ctx, { pass: canvasPass }, () => blit(targets.color));
    return;
  }

  const preset = PRESETS[options.preset];
  const depth = options.edges === "depth";
  const edgesPipeline =
    edgesPipelines[
      !depth && options.predication
        ? `${options.edges}-predication`
        : options.edges
    ];
  edgesPipeline.constants = preset.edges;
  weightsPipeline.constants = preset.weights;

  gpu.submit(ctx, {
    pass: edgesPass,
    pipeline: edgesPipeline,
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uPointSampler: pointSampler,
      uColorTexture: targets.color,
      uDepthTexture: targets.depth,
    },
  });

  gpu.submit(ctx, {
    pass: weightsPass,
    pipeline: weightsPipeline,
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uLinearSampler: linearSampler,
      uEdgesTexture: targets.edges,
      uAreaTexture: areaTexture,
      uSearchTexture: searchTexture,
      uSubsampleIndices: temporal ? subsample.indices : [0, 0, 0, 0],
    },
  });

  if (options.output !== "result") {
    gpu.submit(ctx, { pass: canvasPass }, () => {
      if (options.output === "velocity") blit(targets.velocity, 50);
      else blit(options.output === "edges" ? targets.edges : targets.weights);
    });
    return;
  }

  const blendCmd = {
    pipeline: blendPipelines[reprojection ? 1 : 0],
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uLinearSampler: linearSampler,
      uColorTexture: targets.color,
      uBlendTexture: targets.weights,
      uVelocityTexture: targets.velocity,
    },
  };

  if (!temporal) {
    gpu.submit(ctx, { pass: canvasPass }, () => gpu.submit(ctx, blendCmd));
    return;
  }

  // T2x: blend into this frame's history, then resolve it with the previous one
  const current = frame % 2;
  gpu.submit(ctx, { ...blendCmd, pass: historyPasses[current] });

  gpu.submit(ctx, {
    pass: canvasPass,
    pipeline: resolvePipelines[reprojection ? 1 : 0],
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uPointSampler: pointSampler,
      uCurrentColorTexture: targets.history[current],
      uPreviousColorTexture: targets.history[1 - current],
      uVelocityTexture: targets.velocity,
    },
  });
});
