import { basename } from "node:path";

const packageName = basename(process.cwd());

export default {
  files: "{*.+(j|t|mj|mt|cj|ct)s,chunks/*.+(j|t|mj|mt|cj|ct)s}",
  commitAndTagVersion: {
    tagPrefix: `${packageName}@v`,
    npmPublishHint: `npm publish --workspace ${packageName}`,
    releaseCommitMessageFormat: `chore(release): ${packageName}@{{currentTag}}`,
  },
};
