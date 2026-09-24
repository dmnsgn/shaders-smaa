# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

# [3.0.0](https://github.com/dmnsgn/glsl-smaa/compare/v2.0.0...v3.0.0) (2025-09-11)


### Features

* add js exports ([8666f0a](https://github.com/dmnsgn/glsl-smaa/commit/8666f0a69831bfdbcbc6cbe00d70575659cc9428))
* add SMAA_PREDICATION ([3360a14](https://github.com/dmnsgn/glsl-smaa/commit/3360a147e3483e555033abbdfd855e473a60069c))
* combine edges detection into one shader ([f1a84fd](https://github.com/dmnsgn/glsl-smaa/commit/f1a84fd4085dbf571f9a6b50b4e8115d97f98300))
* prefix uniforms + use uTexelSize/uViewportSize instead of SMAA_RT_METRICS ([43b5b36](https://github.com/dmnsgn/glsl-smaa/commit/43b5b3652c449f7260c888e7595af9c3a86417e8))


### Reverts

* rename uTexture to uColorTexture ([4fe1b00](https://github.com/dmnsgn/glsl-smaa/commit/4fe1b0002a023dc32931d958825583d819a0c533))



# 2.0.0 (2021-03-31)


### Bug Fixes

* flip search and area textures ([191590a](https://github.com/dmnsgn/glsl-smaa/commit/191590ac9245d898b2a6e0ef720ce1734623fb39))
* remove round and offset defines from weights fragment shader ([650bcbf](https://github.com/dmnsgn/glsl-smaa/commit/650bcbfbccacd57afbc853f88f5db5c4d57849a6))
* update search texture ([dede139](https://github.com/dmnsgn/glsl-smaa/commit/dede1395a143c777c8c95bdf8716faeebf31fd78))


### Code Refactoring

* use ES modules ([c20d12f](https://github.com/dmnsgn/glsl-smaa/commit/c20d12fad379ac63a7f702541a7067bc2b0ec5bf))


### Features

* move presets in separate file ([028253f](https://github.com/dmnsgn/glsl-smaa/commit/028253f4f5e301d0a963ca904244d37982fdcf81))


### BREAKING CHANGES

* switch to type module
