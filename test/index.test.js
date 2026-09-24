import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  packages,
  packageUrl,
  shaders,
  texturesModule,
} from "../scripts/packages.js";

const root = fileURLToPath(new URL("../", import.meta.url));

const run = (command, args) => {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch ({ stdout, stderr, message }) {
    assert.fail(`${[command, ...args].join(" ")}\n${stderr || stdout || message}`);
  }
};

// The plain files and textures.js are generated, so they rot silently when only
// the sources are edited.
for (const language of Object.keys(packages)) {
  test(`${packages[language].name} generated files are up to date`, async () => {
    const dirUrl = packageUrl(language);
    const dir = fileURLToPath(dirUrl);
    const files = shaders(language);

    assert.ok(files.length, `no shader modules found`);

    for (const file of files) {
      const { default: source } = await import(new URL(`${file}.js`, dirUrl));
      assert.ok(
        readFileSync(`${dir}${file}`, "utf8") === source,
        `${file} is out of sync with ${file}.js: run npm run build:shaders`,
      );
    }

    assert.ok(
      readFileSync(`${dir}textures.js`, "utf8") === texturesModule(),
      "textures.js is out of sync with assets/: run npm run build:shaders",
    );
  });
}

// Every define combination the README documents, compiled as GLSL ES 1.00 for
// the WebGL target, the way a consumer prepends them.
test("GLSL compiles", async (t) => {
  try {
    execFileSync("glslangValidator", ["--version"], { stdio: "ignore" });
  } catch {
    return t.skip("glslangValidator not installed, skipping GLSL validation");
  }

  const glsl = await import(new URL("index.js", packageUrl("glsl")));
  const presets = ["LOW", "MEDIUM", "HIGH", "ULTRA"].map(
    (preset) => `#define SMAA_PRESET_${preset}`,
  );
  const passes = {
    edges: [
      "#define SMAA_EDGES_DEPTH",
      "#define SMAA_EDGES_LUMA",
      "#define SMAA_EDGES_COLOR",
      "#define SMAA_EDGES_LUMA\n#define SMAA_PREDICATION 1",
      "#define SMAA_EDGES_COLOR\n#define SMAA_PREDICATION 1",
      "#define SMAA_EDGES_COLOR\n#define SMAA_SRGB_INPUT",
    ],
    weights: [
      "",
      ...presets,
      "#define SMAA_MAX_SEARCH_STEPS 8\n#define SMAA_MAX_SEARCH_STEPS_DIAG 16",
    ],
    blend: ["", "#define SMAA_REPROJECTION 1"],
    resolve: ["", "#define SMAA_REPROJECTION 1"],
  };

  const dir = mkdtempSync(join(tmpdir(), "glsl-smaa-"));

  try {
    for (const [pass, variants] of Object.entries(passes)) {
      for (const [i, defines] of variants.entries()) {
        for (const stage of ["vert", "frag"]) {
          const file = join(dir, `${pass}-${i}.${stage}`);
          writeFileSync(
            file,
            `#version 100
${defines}
${glsl.PRESETS}
${glsl[`SMAA_${pass.toUpperCase()}_${stage.toUpperCase()}`]}`,
          );
          run("glslangValidator", [file]);
        }
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WGSL compiles", (t) => {
  try {
    execFileSync("deno", ["--version"], { stdio: "ignore" });
  } catch {
    return t.skip("deno not installed, skipping WGSL validation");
  }
  run("deno", ["run", "--unstable-webgpu", "--allow-read", "test/wgsl-validate.js"]);
});
