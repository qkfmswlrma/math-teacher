// GET /api/records — 관리자 코드로만 연다. 최근 질문과 날짜별 비용을 돌려준다.
import { whoIs, json, koreaDay } from "../../lib/auth.js";
import { questionsTable } from "../../lib/db.js";

export async function onRequestGet({ request, env }) {
  if (whoIs(request, env) !== "admin") return json({ error: "관리자 코드가 맞지 않아요." }, 401);
  const table = questionsTable(env);
  if (!table) return json({ error: "DB 가 연결되지 않았어요." }, 500);

  const url = new URL(request.url);
  const before = Number(url.searchParams.get("before")) || null;

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
      limit: Number(env.DAILY_LIMIT || 0),
    };
  }
  return json({ rows, summary });
}

function sum(rows) {
  return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
}
