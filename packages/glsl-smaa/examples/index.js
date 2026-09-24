import createContext from "pex-context";
import { mat4 } from "pex-math";
import { cube, icosahedron, torus, utils } from "primitive-geometry";
import { Pane } from "tweakpane";

import {
  SMAATextures,
  PRESETS,
  SMAA_EDGES_VERT,
  SMAA_EDGES_FRAG,
  SMAA_WEIGHTS_VERT,
  SMAA_WEIGHTS_FRAG,
  SMAA_BLEND_VERT,
  SMAA_BLEND_FRAG,
  SMAA_RESOLVE_VERT,
  SMAA_RESOLVE_FRAG,
} from "../index.js";

// No canvas alpha: the resolve output alpha holds packed velocity.
const ctx = createContext({ pixelRatio: 1, antialias: false, alpha: false });

const options = {
  smaa: true,
  edges: "luma",
  predication: false,
  preset: "HIGH",
  mode: "1x",
  reprojection: true,
  output: "result",
  animate: true,
  speed: 0.3,
};

const pane = new Pane({ title: "glsl-smaa" });
pane.addBinding(options, "smaa", { label: "SMAA" });
pane.addBinding(options, "edges", {
  options: { luma: "luma", color: "color", depth: "depth" },
});
pane.addBinding(options, "predication");
pane.addBinding(options, "preset", {
  options: { low: "LOW", medium: "MEDIUM", high: "HIGH", ultra: "ULTRA" },
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

// T2x camera jitters in pixels (y up) and their subsample indices. The
// reference's table is mirrored vertically, as the passes run on a bottom-left
// texture origin.
const SUBSAMPLES = [
  { jitter: [0.25, 0.25], indices: [1, 1, 1, 0] },
  { jitter: [-0.25, -0.25], indices: [2, 2, 2, 0] },
];

// Lookup textures: no flipY, filtering as the reference's samplers.
const loadImage = async (src) =>
  createImageBitmap(await (await fetch(src)).blob(), {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });

const [areaImage, searchImage] = await Promise.all([
  loadImage(SMAATextures.area),
  loadImage(SMAATextures.search),
]);
const lookupOptions = {
  min: ctx.Filter.Linear,
  mag: ctx.Filter.Linear,
  mipmap: false,
};
const areaTexture = ctx.texture2D({
  data: areaImage,
  width: areaImage.width,
  height: areaImage.height,
  ...lookupOptions,
});
const searchTexture = ctx.texture2D({
  data: searchImage,
  width: searchImage.width,
  height: searchImage.height,
  ...lookupOptions,
});

// Render targets
const targetOptions = { width: 1, height: 1, mipmap: false };
const colorTexture = ctx.texture2D({
  ...targetOptions,
  min: ctx.Filter.Linear,
  mag: ctx.Filter.Linear,
});
const depthTexture = ctx.texture2D({
  ...targetOptions,
  pixelFormat: ctx.PixelFormat.DEPTH_COMPONENT24,
});
const edgesTexture = ctx.texture2D({
  ...targetOptions,
  min: ctx.Filter.Linear,
  mag: ctx.Filter.Linear,
});
const weightsTexture = ctx.texture2D({
  ...targetOptions,
  min: ctx.Filter.Linear,
  mag: ctx.Filter.Linear,
});
const velocityTexture = ctx.texture2D({
  ...targetOptions,
  pixelFormat: ctx.PixelFormat.RGBA16F,
  min: ctx.Filter.Linear,
  mag: ctx.Filter.Linear,
});
// Current and previous blend outputs, for the temporal resolve
const historyTextures = [
  ctx.texture2D(targetOptions),
  ctx.texture2D(targetOptions),
];
const targets = [
  colorTexture,
  depthTexture,
  edgesTexture,
  weightsTexture,
  velocityTexture,
  ...historyTextures,
];

// Scene: flat primitives whose silhouettes alias. GLSL ES 3.00 for the second
// render target: velocity, for the temporal reprojection.
const sceneVert = /* glsl */ `#version 300 es
in vec3 aPosition;
in vec3 aNormal;

uniform mat4 uProjectionMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uModelMatrix;
uniform mat4 uPreviousModelMatrix;
uniform vec2 uJitter;

out vec3 vNormal;
out vec3 vPosition;
out vec4 vCurrentPosition;
out vec4 vPreviousPosition;

void main() {
  vNormal = (uModelMatrix * vec4(aNormal, 0.0)).xyz;
  vPosition = aPosition;
  vCurrentPosition = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
  vPreviousPosition = uProjectionMatrix * uViewMatrix * uPreviousModelMatrix * vec4(aPosition, 1.0);

  // Jitter in clip space, so it stays out of the velocity
  gl_Position = vCurrentPosition;
  gl_Position.xy += uJitter * gl_Position.w;
}`;
const sceneFrag = /* glsl */ `#version 300 es
precision highp float;

uniform vec3 uColor;

in vec3 vNormal;
in vec3 vPosition;
in vec4 vCurrentPosition;
in vec4 vPreviousPosition;

layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outVelocity;

void main() {
  float diffuse = max(dot(normalize(vNormal), normalize(vec3(1.0, 2.0, 3.0))), 0.0);
  // Low contrast stripes with no depth edge: detected at the base threshold,
  // skipped once predication raises it away from depth edges.
  float stripes = mix(1.0, 0.65, step(0.5, fract(vPosition.y * 6.0)));
  // Gamma-encoded output, as edge detection expects.
  outColor = vec4(pow(uColor * stripes * (0.2 + 0.8 * diffuse), vec3(1.0 / 2.2)), 1.0);

  // In texture coordinates, from the previous frame to the current one
  outVelocity = vec4(
    0.5 * (vCurrentPosition.xy / vCurrentPosition.w - vPreviousPosition.xy / vPreviousPosition.w),
    0.0,
    1.0
  );
}`;

const scenePipeline = ctx.pipeline({
  vert: sceneVert,
  frag: sceneFrag,
  depthTest: true,
  cullFace: true,
});

const meshes = [
  [cube({ sx: 1.2 }), [-2.2, 0, 0], [0.9, 0.3, 0.2]],
  [icosahedron({ radius: 0.8 }), [0, 0, 0], [0.2, 0.6, 0.9]],
  [torus({ radius: 0.6, minorRadius: 0.25 }), [2.2, 0, 0], [0.9, 0.8, 0.2]],
].map(([geometry, position, color]) => ({
  position,
  modelMatrix: mat4.create(),
  previousModelMatrix: mat4.create(),
  cmd: {
    pipeline: scenePipeline,
    attributes: {
      aPosition: ctx.vertexBuffer(geometry.positions),
      aNormal: ctx.vertexBuffer(geometry.normals),
    },
    indices: ctx.indexBuffer(geometry.cells),
    uniforms: { uColor: color },
  },
}));

const projectionMatrix = mat4.create();
const viewMatrix = mat4.lookAt(
  mat4.create(),
  [0, 1.5, 6],
  [0, 0, 0],
  [0, 1, 0],
);

const scenePass = ctx.pass({
  color: [colorTexture, velocityTexture],
  depth: depthTexture,
  clearColor: [
    [0.1, 0.1, 0.1, 1],
    [0, 0, 0, 0],
  ],
  clearDepth: 1,
});

// SMAA passes: fullscreen triangles, with pipelines cached per define set
const fullscreen = {
  aPosition: ctx.vertexBuffer(utils.fullscreenTriangle().positions),
};
const pipelines = new Map();
const pipeline = (vert, frag, defines) => {
  const key = `${defines}${frag}`;
  if (!pipelines.has(key)) {
    const header = `${defines}\n${PRESETS}\n`;
    pipelines.set(
      key,
      ctx.pipeline({ vert: `${header}${vert}`, frag: `${header}${frag}` }),
    );
  }
  return pipelines.get(key);
};

const edgesPass = ctx.pass({ color: [edgesTexture], clearColor: [0, 0, 0, 0] });
const weightsPass = ctx.pass({
  color: [weightsTexture],
  clearColor: [0, 0, 0, 0],
});
const historyPasses = historyTextures.map((texture) =>
  ctx.pass({ color: [texture] }),
);
const screenPass = ctx.pass({ clearColor: [0, 0, 0, 1] });

const blitCmd = {
  pipeline: ctx.pipeline({
    vert: /* glsl */ `
attribute vec2 aPosition;
varying vec2 vTexCoord0;
void main() {
  vTexCoord0 = (aPosition + 1.0) / 2.0;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`,
    frag: /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform float uScale;
varying vec2 vTexCoord0;
void main() {
  gl_FragColor = vec4(abs(texture2D(uTexture, vTexCoord0).rgb) * uScale, 1.0);
}`,
  }),
  attributes: fullscreen,
  count: 3,
};
const blit = (texture, scale = 1) =>
  ctx.submit(blitCmd, { uniforms: { uTexture: texture, uScale: scale } });

window.addEventListener("resize", () => {
  ctx.set({ width: window.innerWidth, height: window.innerHeight });
});

let time = 0;
let frame = 0;

ctx.frame(() => {
  if (options.animate) time += (1 / 60) * options.speed;
  frame++;

  // ctx.set() applies on the next frame, so targets follow the drawing buffer.
  const width = ctx.gl.drawingBufferWidth;
  const height = ctx.gl.drawingBufferHeight;
  if (colorTexture.width !== width || colorTexture.height !== height) {
    for (const texture of targets) ctx.update(texture, { width, height });
    mat4.perspective(projectionMatrix, Math.PI / 4, width / height, 1, 20);
  }
  const texelSize = [1 / width, 1 / height];

  const temporal = options.smaa && options.mode === "T2x";
  const reprojection = temporal && options.reprojection;
  const subsample = SUBSAMPLES[frame % 2];
  // Pixels to clip space
  const jitter = temporal
    ? [(2 * subsample.jitter[0]) / width, (2 * subsample.jitter[1]) / height]
    : [0, 0];

  ctx.submit({ pass: scenePass }, () => {
    for (const { position, modelMatrix, previousModelMatrix, cmd } of meshes) {
      mat4.set(previousModelMatrix, modelMatrix);
      mat4.identity(modelMatrix);
      mat4.translate(modelMatrix, position);
      mat4.rotate(modelMatrix, time, [0.3, 1, 0.2]);
      ctx.submit(cmd, {
        uniforms: {
          uProjectionMatrix: projectionMatrix,
          uViewMatrix: viewMatrix,
          uModelMatrix: modelMatrix,
          uPreviousModelMatrix: previousModelMatrix,
          uJitter: jitter,
        },
      });
    }
  });

  if (!options.smaa) {
    ctx.submit({ pass: screenPass }, () => blit(colorTexture));
    return;
  }

  const preset = `#define SMAA_PRESET_${options.preset}`;
  const depth = options.edges === "depth";
  const predication = !depth && options.predication;

  ctx.submit({
    pass: edgesPass,
    pipeline: pipeline(
      SMAA_EDGES_VERT,
      SMAA_EDGES_FRAG,
      `${preset}
#define SMAA_EDGES_${options.edges.toUpperCase()}
#define SMAA_PREDICATION ${predication ? 1 : 0}`,
    ),
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uTexelSize: texelSize,
      ...(depth || predication ? { uDepthTexture: depthTexture } : {}),
      ...(depth ? {} : { uColorTexture: colorTexture }),
    },
  });

  ctx.submit({
    pass: weightsPass,
    pipeline: pipeline(SMAA_WEIGHTS_VERT, SMAA_WEIGHTS_FRAG, preset),
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uTexelSize: texelSize,
      uViewportSize: [width, height],
      uSubsampleIndices: temporal ? subsample.indices : [0, 0, 0, 0],
      uEdgesTexture: edgesTexture,
      uAreaTexture: areaTexture,
      uSearchTexture: searchTexture,
    },
  });

  if (options.output !== "result") {
    ctx.submit({ pass: screenPass }, () => {
      if (options.output === "velocity") blit(velocityTexture, 50);
      else blit(options.output === "edges" ? edgesTexture : weightsTexture);
    });
    return;
  }

  const reprojectionDefine = `#define SMAA_REPROJECTION ${reprojection ? 1 : 0}`;
  const blendCmd = {
    pipeline: pipeline(SMAA_BLEND_VERT, SMAA_BLEND_FRAG, reprojectionDefine),
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uTexelSize: texelSize,
      uColorTexture: colorTexture,
      uBlendTexture: weightsTexture,
      ...(reprojection ? { uVelocityTexture: velocityTexture } : {}),
    },
  };

  if (!temporal) {
    ctx.submit({ pass: screenPass }, () => ctx.submit(blendCmd));
    return;
  }

  // T2x: blend into this frame's history, then resolve it with the previous one
  const current = frame % 2;
  ctx.submit({ ...blendCmd, pass: historyPasses[current] });

  ctx.submit({
    pass: screenPass,
    pipeline: pipeline(
      SMAA_RESOLVE_VERT,
      SMAA_RESOLVE_FRAG,
      reprojectionDefine,
    ),
    attributes: fullscreen,
    count: 3,
    uniforms: {
      uCurrentColorTexture: historyTextures[current],
      uPreviousColorTexture: historyTextures[1 - current],
      ...(reprojection ? { uVelocityTexture: velocityTexture } : {}),
    },
  });
});
