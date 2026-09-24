// Validates every *.wgsl.js module string against a real WGSL implementation.
// Run via `npm test`; needs deno on PATH for its WebGPU (naga) support.
// Chunks declare no bindings, so each one compiles standalone, alongside the
// default smaaDecodeVelocity() for those requiring it. Pass modules also go
// through render pipeline creation, which is where override constants are
// resolved: once with defaults, then with every preset.
import { packageUrl, shaders } from "../scripts/packages.js";

const dirUrl = packageUrl("wgsl");
const { PRESETS, chunks } = await import(new URL("index.js", dirUrl).href);

const adapter = await navigator.gpu.requestAdapter();

if (!adapter) {
  console.error("no WebGPU adapter available");
  Deno.exit(1);
}

const device = await adapter.requestDevice();

const validate = async (create) => {
  device.pushErrorScope("validation");
  const result = create();
  const messages = result.getCompilationInfo
    ? (await result.getCompilationInfo()).messages.filter(
        ({ type }) => type === "error",
      )
    : [];
  const scope = await device.popErrorScope();
  return [
    ...messages.map(
      ({ lineNum, linePos, message }) => `${lineNum}:${linePos} ${message}`,
    ),
    ...(scope ? [scope.message] : []),
  ];
};

const pipeline = (module, constants) =>
  device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module,
      buffers: [
        {
          arrayStride: 8,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }],
        },
      ],
      constants,
    },
    fragment: {
      module,
      targets: [{ format: "rgba8unorm" }],
      constants,
    },
  });

let failed = 0;

for (const file of shaders("wgsl")) {
  const { default: source } = await import(new URL(`${file}.js`, dirUrl).href);
  const requiresVelocity =
    source.includes("smaaDecodeVelocity(") &&
    !source.includes("fn smaaDecodeVelocity(");
  const code = requiresVelocity ? `${chunks.velocity}${source}` : source;

  const module = device.createShaderModule({ code });
  const errors = await validate(() => module);

  if (!errors.length && /(^|\/)smaa-/.test(file)) {
    const pass = file.match(/smaa-(\w+)/)[1];
    const variants = [
      {},
      ...Object.values(PRESETS)
        .map((preset) => preset[pass])
        .filter(Boolean),
    ];
    for (const constants of variants) {
      errors.push(...(await validate(() => pipeline(module, constants))));
    }
  }

  if (errors.length) {
    failed++;
    console.error(`✘ ${file}`);
    for (const error of errors) console.error(`  ${error}`);
  } else {
    console.log(`✔ ${file}`);
  }
}

Deno.exit(failed);
