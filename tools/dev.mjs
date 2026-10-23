// 내 컴퓨터에서 사이트를 Cloudflare 와 같은 방식으로 띄운다.
// 지침.md 로 lib/prompt.js 를 만든 뒤 wrangler pages dev 를 켠다. 로컬 D1 은 .wrangler/ 에 생긴다.
// 비밀값은 .dev.vars 에서 읽는다.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt } from "./build-prompt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const port = process.argv[2] || "4176";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };

await buildPrompt();
const child = spawn(process.execPath, [wrangler, "pages", "dev", "--port", port, "--ip", "127.0.0.1"], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
