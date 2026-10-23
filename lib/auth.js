// 입장 코드 확인. 학생은 ACCESS_CODE, 사용자(관리자)는 ADMIN_CODE.
// 둘 다 Cloudflare 비밀값으로 넣는다. 설정이 비어 있으면 아무도 못 들어온다.
export function whoIs(request, env) {
  const code = (request.headers.get("x-access-code") || "").trim();
  if (!code) return null;
  if (env.ADMIN_CODE && code === env.ADMIN_CODE) return "admin";
  if (env.ACCESS_CODE && code === env.ACCESS_CODE) return "student";
  return null;
}

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// 하루 제한은 한국 날짜로 끊는다.
export function koreaDay(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
