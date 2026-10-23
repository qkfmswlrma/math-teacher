// GET /api/records — 질문 기록.
// 관리자 코드: 모든 질문과 날짜별 비용. 학생 코드: 학생이 한 질문과 답만(비용·토큰 없이).
import { whoIs, json, koreaDay } from "../../lib/auth.js";
import { questionsTable } from "../../lib/db.js";

export async function onRequestGet({ request, env }) {
  const who = whoIs(request, env);
  if (!who) return json({ error: "코드가 맞지 않아요." }, 401);
  const table = questionsTable(env);
  if (!table) return json({ error: "DB 가 연결되지 않았어요." }, 500);

  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || null;

  if (who === "student") {
    return json({ rows: await table.listForStudent({ before, limit: 30 }) });
  }

  const rows = await table.list({ before, limit: 30 });
  let summary = null;
  if (!before) {
    const today = koreaDay();
    const monthStart = today.slice(0, 8) + "01";
    const recent = await table.since(monthStart);
    const pick = (r) => r.status !== "error";
    summary = {
      today,
      todayStudent: recent.filter((r) => r.day === today && r.who === "student" && pick(r)).length,
      todayCost: sum(recent.filter((r) => r.day === today)),
      monthCost: sum(recent),
      limit: Number(env.DAILY_LIMIT || 30),
    };
  }
  return json({ rows, summary });
}

function sum(rows) {
  return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
}
