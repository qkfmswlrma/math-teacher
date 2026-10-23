// 지침.md 를 서버 함수가 읽을 수 있는 lib/prompt.js 로 옮긴다.
// 지침을 고친 뒤에는 이걸 다시 돌린다(dev-server 는 켤 때마다 알아서 돌린다).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildPrompt() {
  const text = await readFile(path.join(root, "지침.md"), "utf8");
  await mkdir(path.join(root, "lib"), { recursive: true });
  const out = `// tools/build-prompt.mjs 가 지침.md 에서 만든 파일. 직접 고치지 말 것.\nexport const SYSTEM_PROMPT = ${JSON.stringify(text.trim())};\n`;
  await writeFile(path.join(root, "lib", "prompt.js"), out, "utf8");
  return text.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const n = await buildPrompt();
  console.log(`lib/prompt.js 를 만들었어요 (${n}자)`);
}
