// POST /api/ask — 학생의 대화를 받아 Claude 의 답을 한 줄씩(NDJSON) 흘려보낸다.
// Cloudflare Pages Functions 형식. API 키는 비밀값 ANTHROPIC_API_KEY 에만 둔다.
// Claude SDK 를 파일 하나로 묶어 둔 것(tools/build.mjs). Cloudflare 가 빌드 없이 올릴 수 있게.
import Anthropic from "../../lib/vendor/anthropic.js";
import { SYSTEM_PROMPT } from "../../lib/prompt.js";
import { whoIs, json, koreaDay } from "../../lib/auth.js";
import { questionsTable } from "../../lib/db.js";
import { costUsd } from "../../lib/prices.js";

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_EFFORT = "high";
const MAX_TURNS = 40;
const MAX_IMAGE_BASE64 = 7_000_000; // 사진 한 장 약 5MB
const MAX_BLOCKS = 6; // 한 번에 사진 4장 + 글, 복원된 대화의 사진 표시 글까지
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function onRequestPost(context) {
  const { request, env } = context;
  const who = whoIs(request, env);
  if (!who) return json({ error: "입장 코드가 맞지 않아요.", code: "bad_code" }, 401);
  if (!env.ANTHROPIC_API_KEY) return json({ error: "서버에 API 키가 설정되지 않았어요." }, 500);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "요청 형식이 잘못됐어요." }, 400);
  }
  const messages = cleanMessages(body?.messages);
  if (!messages) return json({ error: "대화 형식이 잘못됐어요." }, 400);
  const conversation = /^[\w-]{1,64}$/.test(body?.conversation || "") ? body.conversation : "unknown";

  const table = questionsTable(env);
  const day = koreaDay();
  // DAILY_LIMIT 를 넣었을 때만 학생의 하루 질문 수를 제한한다(지금은 넣지 않아 제한 없음)
  const limit = Number(env.DAILY_LIMIT || 0);
  if (table && who === "student" && limit > 0 && (await table.countStudentToday(day)) >= limit) {
    return json({ error: `오늘 질문은 여기까지예요. 하루에 ${limit}개까지 물을 수 있어요.`, code: "limit" }, 429);
  }

  const last = messages[messages.length - 1].content;
  const rowId = table
    ? await table.insert({
        day,
        conversation,
        who,
        question: last.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
        has_image: last.filter((b) => b.type === "image").length,
      })
    : null;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  // 학생이 "멈추기"를 누르거나 창을 닫으면 쓰기가 실패한다. 그때는 Claude 쪽 생성도 끊는다.
  let gone = false;
  const send = async (obj) => {
    try {
      await writer.write(encoder.encode(JSON.stringify(obj) + "\n"));
    } catch (err) {
      gone = true;
      throw err;
    }
  };

  const task = (async () => {
    let answer = "";
    let stream = null;
    let started = null; // message_start 에 오는 모델 이름과 입력 토큰
    let saved = false;
    try {
      stream = client.beta.messages.stream({
        model: env.MODEL || DEFAULT_MODEL,
        max_tokens: 64000,
        output_config: { effort: env.EFFORT || DEFAULT_EFFORT },
        // 안전 분류기가 거절하면 서버가 알맞은 다른 모델로 다시 돌린다
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // 지침은 매번 같으니 캐시해서 싸게 읽는다
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      });

      for await (const event of stream) {
        if (event.type === "message_start") {
          started = event.message;
        } else if (event.type === "content_block_start" && event.content_block.type === "thinking" && !answer) {
          await send({ t: "thinking" });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          answer += event.delta.text;
          await send({ t: "text", v: event.delta.text });
        }
      }

      const final = await stream.finalMessage();
      const cost = costUsd(final.model, final.usage);
      const status = final.stop_reason === "refusal" ? "refused" : final.stop_reason === "max_tokens" ? "cut" : "done";
      // 기록을 먼저 남긴다. 그 뒤에 학생이 창을 닫아도 다 받은 답으로 남는다.
      if (rowId) {
        await table.update(rowId, {
          answer,
          model: final.model,
          input_tokens: final.usage.input_tokens ?? 0,
          cache_read_tokens: final.usage.cache_read_input_tokens ?? 0,
          cache_write_tokens: final.usage.cache_creation_input_tokens ?? 0,
          output_tokens: final.usage.output_tokens ?? 0,
          cost_usd: cost,
          status,
        });
      }
      saved = true;
      if (status === "refused") await send({ t: "error", message: "이 질문에는 답할 수 없어요." });
      if (status === "cut") await send({ t: "error", message: "답이 너무 길어져서 중간에 끊겼어요." });
      await send({ t: "done", model: final.model, usage: final.usage, cost, who });
    } catch (err) {
      if (saved) return;
      if (gone) {
        // 멈춘 경우: 생성을 끊고, 거기까지의 답과 입력 쪽 토큰만 남긴다(출력 토큰은 끝나야 알 수 있다)
        stream?.abort();
        if (rowId) {
          const u = started?.usage || {};
          await table
            .update(rowId, {
              answer,
              model: started?.model || null,
              input_tokens: u.input_tokens ?? null,
              cache_read_tokens: u.cache_read_input_tokens ?? null,
              cache_write_tokens: u.cache_creation_input_tokens ?? null,
              cost_usd: started ? costUsd(started.model, { ...u, output_tokens: 0 }) : null,
              status: "stopped",
            })
            .catch(() => {});
        }
        return;
      }
      const message = describeError(err);
      await send({ t: "error", message }).catch(() => {});
      if (rowId) await table.update(rowId, { answer: answer || message, status: "error" }).catch(() => {});
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  // 학생이 창을 닫아도 기록은 끝까지 남긴다
  context.waitUntil?.(task);

  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

// 브라우저가 보낸 대화를 그대로 믿지 않고, 허용한 모양만 남긴다.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_TURNS) return null;
  const out = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    const role = i % 2 === 0 ? "user" : "assistant";
    if (!m || m.role !== role) return null;

    if (role === "assistant") {
      if (typeof m.content !== "string" || !m.content) return null;
      out.push({ role, content: m.content });
      continue;
    }

    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_BLOCKS) return null;
    const content = [];
    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        content.push({ type: "text", text: b.text.slice(0, 4000) });
      } else if (
        b?.type === "image" &&
        b.source?.type === "base64" &&
        IMAGE_TYPES.has(b.source.media_type) &&
        typeof b.source.data === "string" &&
        b.source.data.length <= MAX_IMAGE_BASE64
      ) {
        content.push({ type: "image", source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
      } else {
        return null;
      }
    }
    if (content.length === 0) return null;
    out.push({ role, content });
  }
  return out[out.length - 1].role === "user" ? out : null;
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "API 키가 맞지 않아요.";
  if (err instanceof Anthropic.PermissionDeniedError) return "이 API 키로는 이 모델을 쓸 수 없어요.";
  if (err instanceof Anthropic.RateLimitError) return "요청이 몰렸어요. 잠시 뒤에 다시 보내 주세요.";
  if (err instanceof Anthropic.BadRequestError) return `요청이 거절됐어요: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `Claude 서버 오류(${err.status ?? "연결"})예요. 잠시 뒤에 다시 보내 주세요.`;
  return "알 수 없는 오류가 났어요.";
}
