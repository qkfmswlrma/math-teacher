// GET /api/check — 입장 코드가 맞는지만 알려 준다.
import { whoIs, json } from "../../lib/auth.js";

export async function onRequestGet({ request, env }) {
  const who = whoIs(request, env);
  if (!who) return json({ error: "입장 코드가 맞지 않아요." }, 401);
  return json({ who });
}
