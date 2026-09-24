# shaders-smaa

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://conventionalcommits.org)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![license](https://img.shields.io/github/license/dmnsgn/shaders-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md)

SMAA (Enhanced Subpixel Morphological Antialiasing) post-processing for GLSL and WGSL, as ES module strings and as plain shader files. Both are ports of the [reference implementation](https://github.com/iryoku/smaa) with the same features: luma, color and depth edge detection, predication, and the temporal resolve with reprojection.

![Edges detected by the luma, color and depth methods](https://raw.githubusercontent.com/dmnsgn/shaders-smaa/main/screenshot.gif)

## Packages

| Package                                                                                                                       | Install           | For    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| [**glsl-smaa**](packages/glsl-smaa) [![npm](https://img.shields.io/npm/v/glsl-smaa)](https://www.npmjs.com/package/glsl-smaa) | `npm i glsl-smaa` | WebGL  |
| [**wgsl-smaa**](packages/wgsl-smaa) [![npm](https://img.shields.io/npm/v/wgsl-smaa)](https://www.npmjs.com/package/wgsl-smaa) | `npm i wgsl-smaa` | WebGPU |

## Differences

**Variants.** GLSL picks the edge detection method, predication and reprojection with `#define`. WGSL has no preprocessor, so it ships one module per variant, and settings are override constants.

**Texture origin.** WGSL keeps the reference's top-left texture origin. In WebGL, the passes run on a vertically mirrored image, so temporal jitters flip their y.

**Lookup textures.** Both packages ship the reference's area and search textures as `SMAATextures`, uploaded as is (no flip).

## Usage

### The passes

1. **Edges**: finds where neighbouring pixels differ more than a threshold. Writes left/top edge flags.
2. **Weights**: walks along each edge to find its ends and shape, then looks up how much each pixel should blend with its neighbour (area and search textures).
3. **Blend**: mixes each pixel with the neighbour its weights point at.
4. **Resolve** (T2x only): mixes this frame with the previous one.

Debug views: `edges` shows red and green lines on edges; `weights` shows coloured smears along them. No edges means nothing gets antialiased, so check the edges view first.

### Options

| Option              | GLSL / WGSL                                                       | What it does                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edge mode           | `SMAA_EDGES_LUMA\|COLOR\|DEPTH` / `SMAA_EDGES_*` module / `edges` | **Luma**: brightness differences, the default. **Color**: per channel, so it also catches edges between colours of equal brightness, and costs more. **Depth**: geometry only, the cheapest. It misses shading and texture edges, and edges between surfaces at similar depths. |
| Quality             | `SMAA_PRESET_*` / `PRESETS` / `quality` 0–3                       | Low, medium, high, ultra. Low and medium skip diagonal and corner handling, so slopes look steppier. Ultra lowers the threshold and searches further.                                                                                                                           |
| Threshold           | `SMAA_THRESHOLD`                                                  | Edge sensitivity (0.1 by default). Lower catches fainter edges, blurs more texture detail, and costs more.                                                                                                                                                                      |
| Max search steps    | `SMAA_MAX_SEARCH_STEPS`, `_DIAG`                                  | How far along an edge it looks. Too low and long, nearly horizontal lines get uneven blending.                                                                                                                                                                                  |
| Corner rounding     | `SMAA_CORNER_ROUNDING`                                            | How much sharp corners are softened (0–100).                                                                                                                                                                                                                                    |
| Predication         | `SMAA_PREDICATION 1` / `*_PREDICATION` module / `predication`     | Luma and color only. Uses depth as a hint: raises the threshold everywhere (×`SCALE`), then lowers it where depth also has an edge (by `STRENGTH`). Silhouettes stay antialiased while flat texture detail (stripes, text, patterns) is left sharp.                             |
| sRGB input          | `SMAA_SRGB_INPUT` / override                                      | Edge thresholds are tuned for gamma-encoded values. Turn it on when the input is an sRGB texture, which is read back as linear. Otherwise dark edges get over-detected and bright ones missed.                                                                                  |
| Mode                | `uSubsampleIndices` + resolve pass / `mode: "t2x"`                | **1x**: one frame, spatial only. **T2x**: the camera shifts between two sub-pixel positions on alternate frames, and the resolve averages them. Thin and sub-pixel detail get noticeably smoother.                                                                              |
| Reprojection        | `SMAA_REPROJECTION 1` / `*_REPROJECTION` modules / `reprojection` | T2x only. Follows the velocity buffer to find where each pixel was last frame before mixing. Without it, anything moving leaves a faint double image.                                                                                                                           |
| Reprojection weight | `SMAA_REPROJECTION_WEIGHT_SCALE` / `reprojectionWeightScale`      | T2x with reprojection: how quickly a pixel whose speed changed stops using its history (0–80, 30 by default). Higher means less ghosting but more flicker on moving edges.                                                                                                      |

### Combinations

- **1x + luma**: the baseline. Cheap and good on static geometry. Some crawling on thin moving lines is expected, because nothing ties frames together.
- **Depth edges + predication**: predication is ignored. Depth edges already only see geometry.
- **Luma/color + predication**: mostly changes what gets blurred, not how well geometry is antialiased. Look at the `edges` view: texture detail disappears, silhouettes stay.
- **T2x without reprojection, static camera**: the best static quality, since both samples line up.
- **T2x without reprojection, moving**: ghost trails behind moving objects, strongest at high speed.
- **T2x + reprojection, moving**: the trails mostly go away. Some softness can remain where speed changes suddenly (disocclusion, silhouettes), which is what the weight scale trades off.

Post-Pro stack integration:

- **T2x + TAA**: TAA wins. It uses its own jitter sequence and history, and SMAA runs as 1x on top. Pick one.
- **SMAA + MSAA**: works, but mostly redundant: MSAA already resolved the geometric edges SMAA looks for. The reference's combined modes (S2x, 4x) render each MSAA sample separately with its own subsample indices, which isn't implemented here.
- **SMAA + motion blur**: motion blur runs first, on the HDR image. SMAA antialiases what's left. Smeared regions produce weak edges and are mostly left alone, which is fine. Both read the same velocity buffer.
- **SMAA + FXAA**: both blur edges. Stacking them just softens the image. Pick one.
- **SMAA + depth of field or bloom**: those run earlier on the HDR image and SMAA runs after the tone map, so they don't interact.

### Gotchas

- **Lookup textures**: upload `SMAATextures` without flipY, filtered linearly. A flipped search texture doesn't break anything outright, it just gives slightly wrong blending at line ends.
- **Clear every frame**: edges and weights targets must be cleared to transparent black. The edges pass discards pixels without edges, so stale values survive otherwise.
- **Velocity convention**: SMAA expects velocity in texture coordinates, from the previous frame to the current one. If yours points the other way, override `SMAA_DECODE_VELOCITY` (GLSL) or provide your own `smaaDecodeVelocity()` (WGSL), or the resolve reprojects in the wrong direction.
- **Alpha with reprojection**: the blend stores the velocity length in alpha for the resolve. Anything reading alpha afterwards must take it from elsewhere, or you get a transparent frame.
- **WebGL T2x jitter**: the passes run on a vertically mirrored image, so the jitter's y is the opposite of the reference table (see the glsl-smaa README). A wrong sign doesn't break anything, it just antialiases slightly worse.

## License

MIT. See [license file](LICENSE.md).
