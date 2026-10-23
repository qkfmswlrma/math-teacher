// GET /api/conversations        — 들어온 코드의 대화 목록(최근 순)
// GET /api/conversations?id=…   — 대화 하나를 처음부터, 사진까지
// 학생 코드면 학생 대화만, 관리자 코드면 관리자가 시험한 대화만 보인다.
import { whoIs, json } from "../../lib/auth.js";
import { questionsTable } from "../../lib/db.js";

export async function onRequestGet({ request, env }) {
  const who = whoIs(request, env);
  if (!who) return json({ error: "코드가 맞지 않아요." }, 401);
  const table = questionsTable(env);
  if (!table) return json({ error: "DB 가 연결되지 않았어요." }, 500);

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    if (!/^[\w-]{1,64}$/.test(id)) return json({ error: "대화 번호가 잘못됐어요." }, 400);
    return json({ rows: await table.loadConversation(who, id) });
  }
  return json({ conversations: await table.listConversations(who) });
}
