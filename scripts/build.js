// Regenerates the plain shader files from the module strings, which are the
// single source of truth, and each package's textures.js from assets/. Run
// after editing a shader; `npm test` fails when they drift apart.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { packages, packageUrl, shaders, texturesModule } from "./packages.js";

for (const language of Object.keys(packages)) {
  const dirUrl = packageUrl(language);
  const dir = fileURLToPath(dirUrl);
  const files = shaders(language);

  for (const file of files) {
    const { default: source } = await import(new URL(`${file}.js`, dirUrl));
    writeFileSync(`${dir}${file}`, source);
  }

  writeFileSync(`${dir}textures.js`, texturesModule());

  console.log(`${packages[language].name}: ${files.length} shader files`);
}
