# glsl-smaa

[![npm version](https://img.shields.io/npm/v/glsl-smaa)](https://www.npmjs.com/package/glsl-smaa)
[![stability-stable](https://img.shields.io/badge/stability-stable-green.svg)](https://www.npmjs.com/package/glsl-smaa)
[![npm minzipped size](https://img.shields.io/bundlephobia/minzip/glsl-smaa)](https://bundlephobia.com/package/glsl-smaa)
[![dependencies](https://img.shields.io/librariesio/release/npm/glsl-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/packages/glsl-smaa/package.json)
[![types](https://img.shields.io/npm/types/glsl-smaa)](https://github.com/microsoft/TypeScript)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://conventionalcommits.org)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![license](https://img.shields.io/github/license/dmnsgn/shaders-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md)

SMAA (Enhanced Subpixel Morphological Antialiasing) post-processing; WebGL (OpenGL ES 2.0) implementation with no fluff. All credit goes to the incredible work [here (iryoku)](http://www.iryoku.com/smaa/) and [there (beakbeak)](https://github.com/beakbeak/smaa-webgl).

Looking for WebGPU? See [wgsl-smaa](https://github.com/dmnsgn/shaders-smaa/tree/main/packages/wgsl-smaa), which ships the same passes in WGSL.

[![paypal](https://img.shields.io/badge/donate-paypal-informational?logo=paypal)](https://paypal.me/dmnsgn)
[![coinbase](https://img.shields.io/badge/donate-coinbase-informational?logo=coinbase)](https://commerce.coinbase.com/checkout/56cbdf28-e323-48d8-9c98-7019e72c97f3)
[![twitter](https://img.shields.io/twitter/follow/dmnsgn?style=social)](https://twitter.com/dmnsgn)

## Installation

```bash
npm install glsl-smaa
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

You would typically set this up as part of a post-processing chain with framebuffers. The edges and weights targets must be cleared to `[0, 0, 0, 0]` every frame, and sampled with a linear filter.

See the [example](https://dmnsgn.github.io/shaders-smaa/packages/glsl-smaa/) and its [source](examples/index.js) for a setup with [pex-context](https://github.com/pex-gl/pex-context).

```js
import {
  SMAATextures,
  PRESETS,
  SMAA_EDGES_VERT,
  SMAA_EDGES_FRAG,
} from "glsl-smaa";

const frag = /* glsl */ `#define SMAA_PRESET_HIGH
#define SMAA_EDGES_LUMA
${PRESETS}
${SMAA_EDGES_FRAG}`;
```

Each shader also ships as a plain file (eg. `glsl-smaa/smaa-edges.frag`) for bundlers that load shaders as raw text.

### Lookup textures

`SMAATextures.area` and `SMAATextures.search` are the reference's precomputed textures as PNG data URIs. Upload them as is (no `flipY`), with linear filtering and no mipmaps.

> [!IMPORTANT]
> Before 4.0.0, the search texture was stored flipped and had to be uploaded with `flipY: true`. It now matches the reference data: remove the flip.

## Attributes

Attributes required for all vertex shaders:

| Name          | Type | Description                                      |
| ------------- | ---- | ------------------------------------------------ |
| **aPosition** | vec2 | Screen vertices (eg. a fullscreen triangle/quad) |

## Uniforms and defines

`#define` can be prepended to the shaders to override default settings. Typically:

```js
const frag = /* glsl */ `#define SMAA_PRESET_HIGH
${PRESETS}
${SMAA_WEIGHTS_FRAG}
`;
```

### `smaa-edges.(vert|frag)`

You can use one of the 3 following edge detection method:

- Depth: the fastest but it may miss some edges.

- Luma: more expensive than depth edge detection, but catches visible edges that depth edge detection can miss.

- Color: the most expensive one but catches chroma-only edges.

![](https://raw.githubusercontent.com/dmnsgn/shaders-smaa/main/preview-edges.gif)

Defines:

```glsl
# One of:
#define SMAA_EDGES_DEPTH
#define SMAA_EDGES_LUMA
#define SMAA_EDGES_COLOR

#define SMAA_THRESHOLD 0.1
#define SMAA_DEPTH_THRESHOLD (0.1 * SMAA_THRESHOLD)
#define SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR 2.0
#define SMAA_PREDICATION 0
#define SMAA_PREDICATION_THRESHOLD 0.01
#define SMAA_PREDICATION_SCALE 2.0
#define SMAA_PREDICATION_STRENGTH 0.4

# Optional:
#define SMAA_SRGB_INPUT
```

| Name                                      | Default [Range]       | Description                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SMAA_THRESHOLD**                        | 0.1 [0, 0.5]          | Specifies the threshold or sensitivity to edges. Lowering this value you will be able to detect more edges at the expense of performance. 0.1 is a reasonable value, and allows to catch most visible edges. 0.05 is a rather overkill value, that allows to catch 'em all.                                                           |
| **SMAA_DEPTH_THRESHOLD**                  | 0.1 \* SMAA_THRESHOLD | Specific threshold for depth edge detection.                                                                                                                                                                                                                                                                                          |
| **SMAA_LOCAL_CONTRAST_ADAPTATION_FACTOR** | 2.0                   | If there is an neighbor edge that has SMAA_LOCAL_CONTRAST_FACTOR times bigger contrast than current edge, current edge will be discarded. This allows to eliminate spurious crossing edges, and is based on the fact that, if there is too much contrast in a direction, that will hide perceptually contrast in the other neighbors. |
| **SMAA_PREDICATION**                      | 0                     | Locally decreases the luma or color threshold if an edge is found in the depth buffer (so the global threshold can be higher).                                                                                                                                                                                                        |
| **SMAA_PREDICATION_THRESHOLD**            | 0.01                  | Threshold used in the depth buffer. Depends on its content.                                                                                                                                                                                                                                                                           |
| **SMAA_PREDICATION_SCALE**                | 2.0 [1, 5]            | How much to scale the global threshold used for luma or color edge detection when using predication.                                                                                                                                                                                                                                  |
| **SMAA_PREDICATION_STRENGTH**             | 0.4 [0, 1]            | How much to locally decrease the threshold.                                                                                                                                                                                                                                                                                           |
| **SMAA_SRGB_INPUT**                       | undefined             | Luma and color edge detection expect gamma-encoded input. Define it when sampling an sRGB texture, which decodes to linear, to re-encode the color before thresholding.                                                                                                                                                                |

Uniforms:

| Name              | Type      | Description                                                        |
| ----------------- | --------- | ------------------------------------------------------------------ |
| **uTexelSize**    | vec2      | `1 / framebuffer size`.                                            |
| **uColorTexture** | sampler2D | The input color framebuffer. Luma and color edge detection only.   |
| **uDepthTexture** | sampler2D | The input depth framebuffer. Depth edge detection and predication. |

---

### `smaa-weights.(vert|frag)`

Defines from `presets.glsl`:

```glsl
# Use presets:
#define SMAA_PRESET_LOW
#define SMAA_PRESET_MEDIUM
#define SMAA_PRESET_HIGH
#define SMAA_PRESET_ULTRA

# or individually setting:
#define SMAA_THRESHOLD 0.1
#define SMAA_MAX_SEARCH_STEPS 16
#define SMAA_MAX_SEARCH_STEPS_DIAG 8
#define SMAA_CORNER_ROUNDING 25

# and optionally disable diagonal and corner detection:
#define SMAA_DISABLE_DIAG_DETECTION
#define SMAA_DISABLE_CORNER_DETECTION
```

| Name                           | Default [Range] | Description                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SMAA_THRESHOLD**             | 0.1 [0, 0.5]    | Should be the same as for the edge pass.                                                                                                                                                                                                                                                                                 |
| **SMAA_MAX_SEARCH_STEPS**      | 16 [0, 112]     | Specifies the maximum steps performed in the horizontal/vertical pattern searches, at each side of the pixel. In number of pixels, it's actually the double. So the maximum line length perfectly handled by, for example 16, is 64 (by perfectly, we meant that longer lines won't look as good, but still antialiased. |
| **SMAA_MAX_SEARCH_STEPS_DIAG** | 8 [0, 20]       | Specifies the maximum steps performed in the diagonal pattern searches, at each side of the pixel. In this case we jump one pixel at time, instead of two.                                                                                                                                                               |
| **SMAA_CORNER_ROUNDING**       | 25 [0, 100]     | Specifies how much sharp corners will be rounded.                                                                                                                                                                                                                                                                        |

Uniforms:

| Name                  | Type      | Description                                                                             |
| --------------------- | --------- | --------------------------------------------------------------------------------------- |
| **uTexelSize**        | vec2      | `1 / framebuffer size`.                                                                 |
| **uViewportSize**     | vec2      | The framebuffer size.                                                                   |
| **uSubsampleIndices** | vec4      | `[0, 0, 0, 0]` for SMAA 1x. See [Temporal supersampling](#temporal-supersampling-t2x). |
| **uEdgesTexture**     | sampler2D | The framebuffer with edges.                                                             |
| **uAreaTexture**      | sampler2D | `SMAATextures.area`.                                                                    |
| **uSearchTexture**    | sampler2D | `SMAATextures.search`.                                                                  |

---

### `smaa-blend.(vert|frag)`

Defines:

```glsl
#define SMAA_REPROJECTION 0
#define SMAA_DECODE_VELOCITY(sample) sample.rg
```

| Name                     | Default   | Description                                                                                      |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------ |
| **SMAA_REPROJECTION**    | 0         | Packs the antialiased velocity into the output alpha, for the temporal resolve.                  |
| **SMAA_DECODE_VELOCITY** | sample.rg | Decodes the velocity texture. Velocity is in texture coordinates, from previous to current frame. |

Uniforms:

| Name                 | Type      | Description                                      |
| -------------------- | --------- | ------------------------------------------------ |
| **uTexelSize**       | vec2      | `1 / framebuffer size`.                          |
| **uColorTexture**    | sampler2D | The input color framebuffer.                     |
| **uBlendTexture**    | sampler2D | The framebuffer with weights.                    |
| **uVelocityTexture** | sampler2D | The velocity framebuffer. `SMAA_REPROJECTION` only. |

---

### `smaa-resolve.(vert|frag)`

Optional temporal resolve pass, blending the current and previous frames.

Defines: `SMAA_REPROJECTION`, `SMAA_DECODE_VELOCITY` as above, and `SMAA_REPROJECTION_WEIGHT_SCALE` (30.0 [0, 80]): the higher, the sooner a moving pixel stops blending with its history.

| Name                      | Type      | Description                                         |
| ------------------------- | --------- | --------------------------------------------------- |
| **uCurrentColorTexture**  | sampler2D | Output of the current frame's blend pass.           |
| **uPreviousColorTexture** | sampler2D | Output of the previous frame's blend pass.          |
| **uVelocityTexture**      | sampler2D | The velocity framebuffer. `SMAA_REPROJECTION` only. |

---

## Temporal supersampling (T2x)

1. Jitter the camera projection by a subpixel offset alternating every frame.
2. Run the three passes on each frame, setting `uSubsampleIndices` to the index matching the frame's jitter.
3. Resolve the current and previous blend outputs with `smaa-resolve`. With `SMAA_REPROJECTION`, both the blend and the resolve passes read a velocity texture, and the previous frame is reprojected.

| Frame | Camera jitter (pixels, y up) | `uSubsampleIndices` |
| ----- | ---------------------------- | ------------------- |
| 0     | `(0.25, 0.25)`               | `[1, 1, 1, 0]`      |
| 1     | `(-0.25, -0.25)`             | `[2, 2, 2, 0]`      |

WebGL's bottom-left texture origin runs the passes on a vertically mirrored image, so the jitter's y is the opposite of the reference table (see `@SUBSAMPLE_INDICES` in [SMAA.hlsl](https://github.com/iryoku/smaa/blob/master/SMAA.hlsl)).

## License

Copyright (C) 2013 Jorge Jimenez (jorge@iryoku.com)
Copyright (C) 2013 Jose I. Echevarria (joseignacioechevarria@gmail.com)
Copyright (C) 2013 Belen Masia (bmasia@unizar.es)
Copyright (C) 2013 Fernando Navarro (fernandn@microsoft.com)
Copyright (C) 2013 Diego Gutierrez (diegog@unizar.es)

MIT. See [license file](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md).
