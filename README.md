# shaders-smaa

[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-fa6673.svg)](https://conventionalcommits.org)
[![styled with prettier](https://img.shields.io/badge/styled_with-Prettier-f8bc45.svg?logo=prettier)](https://github.com/prettier/prettier)
[![linted with eslint](https://img.shields.io/badge/linted_with-ES_Lint-4B32C3.svg?logo=eslint)](https://github.com/eslint/eslint)
[![license](https://img.shields.io/github/license/dmnsgn/shaders-smaa)](https://github.com/dmnsgn/shaders-smaa/blob/main/LICENSE.md)

SMAA (Enhanced Subpixel Morphological Antialiasing) post-processing for GLSL and WGSL, as ES module strings and as plain shader files. Both are ports of the [reference implementation](https://github.com/iryoku/smaa) with the same features: luma, color and depth edge detection, predication, and the temporal resolve with reprojection.

![Edges detected by the luma, color and depth methods](https://raw.githubusercontent.com/dmnsgn/shaders-smaa/main/preview-edges.gif)

## Packages

| Package                                                                                                                       | Install           | For    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------ |
| [**glsl-smaa**](packages/glsl-smaa) [![npm](https://img.shields.io/npm/v/glsl-smaa)](https://www.npmjs.com/package/glsl-smaa) | `npm i glsl-smaa` | WebGL  |
| [**wgsl-smaa**](packages/wgsl-smaa) [![npm](https://img.shields.io/npm/v/wgsl-smaa)](https://www.npmjs.com/package/wgsl-smaa) | `npm i wgsl-smaa` | WebGPU |

## Differences

**Variants.** GLSL picks the edge detection method, predication and reprojection with `#define`. WGSL has no preprocessor, so it ships one module per variant, and settings are override constants.

**Texture origin.** WGSL keeps the reference's top-left texture origin. In WebGL, the passes run on a vertically mirrored image, so temporal jitters flip their y.

**Lookup textures.** Both packages ship the reference's area and search textures as `SMAATextures`, uploaded as is (no flip).

## License

MIT. See [license file](LICENSE.md).
