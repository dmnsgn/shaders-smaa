# wgsl-smaa

[![npm version](https://img.shields.io/npm/v/wgsl-smaa)](https://www.npmjs.com/package/wgsl-smaa)
[![stability-stable](https://img.shields.io/badge/stability-stable-green.svg)](https://www.npmjs.com/package/wgsl-smaa)
[![npm minzipped size](https://img.shields.io/bundlephobia/minzip/wgsl-smaa)](https://bundlephobia.com/package/wgsl-smaa)
[![dependencies](https://img.shields.io/librariesio/release/npm/wgsl-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/packages/wgsl-smaa/package.json)
[![types](https://img.shields.io/npm/types/wgsl-smaa)](https://github.com/microsoft/TypeScript)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://conventionalcommits.org)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![license](https://img.shields.io/github/license/dmnsgn/shaders-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md)

SMAA (Enhanced Subpixel Morphological Antialiasing) post-processing for WebGPU, as ES module strings and WGSL files. A port of the [reference implementation (iryoku)](http://www.iryoku.com/smaa/), keeping its top-left texture origin, which WebGPU shares.

Looking for WebGL? See [glsl-smaa](https://github.com/dmnsgn/shaders-smaa/tree/main/packages/glsl-smaa), which ships the same passes in GLSL.

[![paypal](https://img.shields.io/badge/donate-paypal-informational?logo=paypal)](https://paypal.me/dmnsgn)
[![coinbase](https://img.shields.io/badge/donate-coinbase-informational?logo=coinbase)](https://commerce.coinbase.com/checkout/56cbdf28-e323-48d8-9c98-7019e72c97f3)
[![twitter](https://img.shields.io/twitter/follow/dmnsgn?style=social)](https://twitter.com/dmnsgn)

## Installation

```bash
npm install wgsl-smaa
```

## Usage

Three passes are required to apply the effect:

```
             |input|------------------·
                v                     |
      [ SMAA*EdgeDetection ]          |
                v                     |
            |edgesTex|                |
                v                     |
[ SMAABlendingWeightCalculation ]     |
                v                     |
            |blendTex|                |
                v                     |
  [ SMAANeighborhoodBlending ] <------·
                v
             |output|
```

The package ships two layers:

- **Pass modules**: complete shader modules, one per variant, with a `vertexMain` and a `fragmentMain` entry point and their bindings in group 0. Settings are override constants.
- **Chunks**: the functions behind them, taking textures as parameters and declaring no bindings, to build your own passes (eg. merging edge detection into a motion blur pass).

See the [example](https://dmnsgn.github.io/shaders-smaa/packages/wgsl-smaa/) and its [source](examples/index.js) for a setup with [pex-gpu](https://github.com/pex-gl/pex-gpu).

```js
import { SMAA_EDGES_LUMA, PRESETS } from "wgsl-smaa";

const module = device.createShaderModule({ code: SMAA_EDGES_LUMA });
const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module,
    buffers: [
      {
        arrayStride: 8,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
      },
    ],
    constants: PRESETS.high.edges,
  },
  fragment: {
    module,
    targets: [{ format: "rg8unorm" }],
    constants: PRESETS.high.edges,
  },
});
```

Each module also ships as a plain file (eg. `wgsl-smaa/smaa-edges-luma.wgsl`, `wgsl-smaa/chunks/edges.wgsl`) for bundlers that load shaders as raw text.

### Lookup textures

`SMAATextures.area` and `SMAATextures.search` are the reference's precomputed textures as PNG data URIs. Upload them as is (no `flipY`) to `rgba8unorm` textures, decoding with `createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" })`.

### Targets and samplers

- The edges (eg. `rg8unorm`) and weights (`rgba8unorm`) targets must be cleared to `[0, 0, 0, 0]` every frame.
- `uLinearSampler` is a linear, clamp-to-edge sampler.
- `uPointSampler` is a nearest, clamp-to-edge sampler, bound as `"non-filtering"` when it samples depth.
- The vertex input is a clip space `vec2f` at `@location(0)`, eg. a fullscreen triangle.

## Pass modules

### Edge detection

| Export                         | File                                | Bindings                                                                    |
| ------------------------------ | ----------------------------------- | --------------------------------------------------------------------------- |
| `SMAA_EDGES_LUMA`              | `smaa-edges-luma.wgsl`              | `uPointSampler`, `uColorTexture`                                            |
| `SMAA_EDGES_COLOR`             | `smaa-edges-color.wgsl`             | `uPointSampler`, `uColorTexture`                                            |
| `SMAA_EDGES_DEPTH`             | `smaa-edges-depth.wgsl`             | `uPointSampler`, `uDepthTexture: texture_depth_2d`                          |
| `SMAA_EDGES_LUMA_PREDICATION`  | `smaa-edges-luma-predication.wgsl`  | `uPointSampler`, `uColorTexture`, `uDepthTexture: texture_depth_2d`         |
| `SMAA_EDGES_COLOR_PREDICATION` | `smaa-edges-color-predication.wgsl` | `uPointSampler`, `uColorTexture`, `uDepthTexture: texture_depth_2d`         |

- Depth: the fastest but it may miss some edges.
- Luma: more expensive than depth edge detection, but catches visible edges that depth edge detection can miss.
- Color: the most expensive one but catches chroma-only edges.
- Predication: locally decreases the luma or color threshold if an edge is found in the depth buffer (so the global threshold can be higher).

| Override                                  | Default [Range]       | Description                                                                                                                                                         |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SMAA_THRESHOLD**                        | 0.1 [0, 0.5]          | Sensitivity to edges. 0.1 catches most visible edges, 0.05 catches 'em all at the expense of performance.                                                           |
| **SMAA_DEPTH_THRESHOLD**                  | 0.1 \* SMAA_THRESHOLD | Specific threshold for depth edge detection.                                                                                                                        |
| **SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR** | 2.0                   | Discards an edge when a neighbor edge has this many times its contrast, eliminating spurious crossing edges.                                                        |
| **SMAA_PREDICATION_THRESHOLD**            | 0.01                  | Threshold used in the depth buffer. Depends on its content.                                                                                                         |
| **SMAA_PREDICATION_SCALE**                | 2.0 [1, 5]            | How much to scale the global threshold when using predication.                                                                                                      |
| **SMAA_PREDICATION_STRENGTH**             | 0.4 [0, 1]            | How much to locally decrease the threshold.                                                                                                                         |
| **SMAA_SRGB_INPUT**                       | false                 | Luma and color edge detection expect gamma-encoded input. Set it when sampling an `-srgb` texture, which decodes to linear, to re-encode the color before thresholding. |

### Blending weight calculation

| Export         | File                | Bindings                                                                                                  |
| -------------- | ------------------- | --------------------------------------------------------------------------------------------------------- |
| `SMAA_WEIGHTS` | `smaa-weights.wgsl` | `uLinearSampler`, `uEdgesTexture`, `uAreaTexture`, `uSearchTexture`, `uSubsampleIndices: vec4f` (uniform) |

`uSubsampleIndices` is `[0, 0, 0, 0]` for SMAA 1x. See [Temporal supersampling](#temporal-supersampling-t2x).

| Override                          | Default [Range] | Description                                                                                                                                         |
| --------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SMAA_MAX_SEARCH_STEPS**         | 16 [0, 112]     | Maximum steps performed in the horizontal/vertical pattern searches, at each side of the pixel. Lines up to 4x this length are perfectly handled. |
| **SMAA_MAX_SEARCH_STEPS_DIAG**    | 8 [0, 20]       | Maximum steps performed in the diagonal pattern searches, at each side of the pixel, one pixel at a time.                                          |
| **SMAA_CORNER_ROUNDING**          | 25 [0, 100]     | How much sharp corners will be rounded.                                                                                                            |
| **SMAA_DISABLE_DIAG_DETECTION**   | false           | Skips diagonal patterns.                                                                                                                           |
| **SMAA_DISABLE_CORNER_DETECTION** | false           | Skips corner rounding.                                                                                                                             |

`PRESETS.low|medium|high|ultra` holds the reference's quality presets, split into `edges` and `weights` override constants.

### Neighborhood blending

| Export                    | File                           | Bindings                                                               |
| ------------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `SMAA_BLEND`              | `smaa-blend.wgsl`              | `uLinearSampler`, `uColorTexture`, `uBlendTexture`                     |
| `SMAA_BLEND_REPROJECTION` | `smaa-blend-reprojection.wgsl` | `uLinearSampler`, `uColorTexture`, `uBlendTexture`, `uVelocityTexture` |

The reprojection variant packs the antialiased velocity into the output alpha, for the temporal resolve. Velocity is read from the red and green channels, in texture coordinates, from the previous to the current frame (see [Velocity](#velocity) to change that).

### Temporal resolve

| Export                      | File                             | Bindings                                                                               |
| --------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| `SMAA_RESOLVE`              | `smaa-resolve.wgsl`              | `uPointSampler`, `uCurrentColorTexture`, `uPreviousColorTexture`                       |
| `SMAA_RESOLVE_REPROJECTION` | `smaa-resolve-reprojection.wgsl` | `uPointSampler`, `uCurrentColorTexture`, `uPreviousColorTexture`, `uVelocityTexture` |

| Override                           | Default [Range] | Description                                                              |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------ |
| **SMAA_REPROJECTION_WEIGHT_SCALE** | 30.0 [0, 80]    | The higher, the sooner a moving pixel stops blending with its history. |

## Chunks

`chunks.edges`, `chunks.weights`, `chunks.blend` and `chunks.resolve` (or `wgsl-smaa/chunks/*.wgsl`) each declare the overrides they use. Their entry functions mirror the reference's:

| Chunk     | Functions                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edges`   | `smaaEdgeDetectionOffsets`, `smaaLumaEdgeDetection`, `smaaColorEdgeDetection`, `smaaDepthEdgeDetection`, `smaaCalculatePredicatedThreshold`       |
| `weights` | `smaaBlendingWeightCalculationOffsets`, `smaaBlendingWeightCalculation`                                                                           |
| `blend`   | `smaaNeighborhoodBlendingOffset`, `smaaNeighborhoodBlending`, `smaaNeighborhoodBlendingReprojection`                                              |
| `resolve` | `smaaResolve`, `smaaResolveReprojection`                                                                                                          |

### Velocity

The blend and resolve chunks call `fn smaaDecodeVelocity(sample: vec4f) -> vec2f`, the counterpart of the reference's `SMAA_DECODE_VELOCITY`, which the including module provides. `chunks.velocity` is the default, reading the red and green channels as texture coordinates from the previous to the current frame, and the pass modules include it. Provide your own instead when velocity is encoded or points the other way:

```wgsl
fn smaaDecodeVelocity(sample: vec4f) -> vec2f {
  return -sample.rg; // Stored from the current frame to the previous one
}
```

### Offsets

The `*Offsets` functions are the reference's vertex stage. They are affine in the texture coordinates, so they can run in either stage. Luma and color edge detection take the threshold as their last parameter: `vec2f(SMAA_THRESHOLD)`, or `smaaCalculatePredicatedThreshold(...)`.

## Temporal supersampling (T2x)

1. Jitter the camera projection by a subpixel offset alternating every frame.
2. Run the three passes on each frame, setting `uSubsampleIndices` to the index matching the frame's jitter.
3. Resolve the current and previous blend outputs with `SMAA_RESOLVE`. With the reprojection variants of the blend and resolve passes, the previous frame is reprojected with a velocity texture.

| Frame | Camera jitter (pixels, y up) | `uSubsampleIndices` |
| ----- | ---------------------------- | ------------------- |
| 0     | `(0.25, -0.25)`              | `[1, 1, 1, 0]`      |
| 1     | `(-0.25, 0.25)`              | `[2, 2, 2, 0]`      |

See `@SUBSAMPLE_INDICES` in [SMAA.hlsl](https://github.com/iryoku/smaa/blob/master/SMAA.hlsl) for the 4x mode.

## License

Copyright (C) 2013 Jorge Jimenez (jorge@iryoku.com)
Copyright (C) 2013 Jose I. Echevarria (joseignacioechevarria@gmail.com)
Copyright (C) 2013 Belen Masia (bmasia@unizar.es)
Copyright (C) 2013 Fernando Navarro (fernandn@microsoft.com)
Copyright (C) 2013 Diego Gutierrez (diegog@unizar.es)

MIT. See [license file](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md).
