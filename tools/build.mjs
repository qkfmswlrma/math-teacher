// 배포 전에 이 컴퓨터에서 돌려, Cloudflare 가 빌드 없이 바로 올릴 수 있는 파일 두 개를 만든다.
//   lib/prompt.js            지침.md 를 서버 함수가 읽을 수 있게 옮긴 것
//   lib/vendor/anthropic.js  Claude SDK(@anthropic-ai/sdk)를 파일 하나로 묶은 것
// 둘 다 깃에 같이 올린다. 지침을 고치거나 SDK 를 올린 뒤에는 다시 돌린다(dev.mjs 는 켤 때마다 돌린다).
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildPrompt } from "./build-prompt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildAll() {
  const chars = await buildPrompt();
  const sdk = JSON.parse(await readFile(path.join(root, "node_modules/@anthropic-ai/sdk/package.json"), "utf8"));
  await build({
    stdin: { contents: 'export { default } from "@anthropic-ai/sdk";', resolveDir: root, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "browser",
    conditions: ["workerd", "worker", "browser"],
    target: "es2022",
    minify: true,
    legalComments: "inline",
    banner: { js: `// @anthropic-ai/sdk ${sdk.version} (MIT). tools/build.mjs 가 만든 파일. 직접 고치지 말 것.` },
    outfile: path.join(root, "lib/vendor/anthropic.js"),
    logLevel: "warning",
  });
  return { chars, sdk: sdk.version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chars, sdk } = await buildAll();
  console.log(`lib/prompt.js (${chars}자), lib/vendor/anthropic.js (SDK ${sdk}) 를 만들었어요`);
}
