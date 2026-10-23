// D1 의 questions·photos 표를 다룬다. 서버 함수 안에서만 쓴다.
// DB 가 연결되지 않았으면 null 을 돌려주고, 그때는 기록 없이 돌아간다.
// 표는 처음 쓸 때 알아서 만든다(이미 있으면 그대로 둔다).
// questions: 학생이 보낸 질문 하나가 한 줄이다. created_at 은 UTC, day 는 한국 날짜,
//   who 는 student / admin, status 는 pending / done / cut / stopped / refused / error,
//   has_image 는 그 질문에 붙인 사진 수.
// photos: 질문에 붙인 사진. 공간을 아끼려고 base64 가 아니라 원래 바이트(BLOB)로 둔다.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    day TEXT NOT NULL,
    conversation TEXT NOT NULL,
    who TEXT NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    has_image INTEGER NOT NULL DEFAULT 0,
    answer TEXT,
    model TEXT,
    input_tokens INTEGER,
    cache_read_tokens INTEGER,
    cache_write_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    status TEXT NOT NULL DEFAULT 'pending'
  )`,
  "CREATE INDEX IF NOT EXISTS questions_day ON questions (day)",
  "CREATE INDEX IF NOT EXISTS questions_conversation ON questions (conversation)",
  `CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    media_type TEXT NOT NULL,
    data BLOB NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS photos_question ON photos (question_id)",
];
const COLUMNS =
  "id, created_at, day, conversation, who, question, has_image, answer, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, status";
// 대화 목록·대화 열기에 쓰는 줄: 답이 남은 것(멈춘 답 포함)만
const SHOWN = "status IN ('done', 'cut', 'stopped') AND answer IS NOT NULL AND answer != ''";
const MAX_PHOTO_BYTES = 1_900_000; // D1 의 한 줄 한도(2MB) 안쪽

let ready = null;
function ensureSchema(db) {
  ready ??= db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

export function questionsTable(env) {
  const db = env.DB;
  if (!db) return null;

  return {
    async countStudentToday(day) {
      await ensureSchema(db);
      const row = await db
        .prepare("SELECT COUNT(*) AS n FROM questions WHERE day = ? AND who = 'student' AND status != 'error'")
        .bind(day)
        .first();
      return row?.n ?? 0;
    },
    async insert(row) {
      await ensureSchema(db);
      const cols = Object.keys(row);
      const result = await db
        .prepare(`INSERT INTO questions (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING id`)
        .bind(...cols.map((c) => row[c]))
        .first();
      return result?.id ?? null;
    },
    async update(id, fields) {
      const cols = Object.keys(fields);
      await db
        .prepare(`UPDATE questions SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
        .bind(...cols.map((c) => fields[c]), id)
        .run();
    },
    // images: [{ media_type, data(base64) }]. 너무 큰 사진은 건너뛴다.
    async insertPhotos(questionId, images) {
      const stmts = [];
      images.forEach((img, idx) => {
        const bytes = fromBase64(img.data);
        if (bytes.byteLength > MAX_PHOTO_BYTES) return;
        stmts.push(
          db.prepare("INSERT INTO photos (question_id, idx, media_type, data) VALUES (?, ?, ?, ?)").bind(questionId, idx, img.media_type, bytes),
        );
      });
      if (stmts.length) await db.batch(stmts);
    },
    // 관리자 기록 페이지
    async list({ before, limit = 30 }) {
      await ensureSchema(db);
      const stmt = before
        ? db.prepare(`SELECT ${COLUMNS} FROM questions WHERE id < ? ORDER BY id DESC LIMIT ?`).bind(before, limit)
        : db.prepare(`SELECT ${COLUMNS} FROM questions ORDER BY id DESC LIMIT ?`).bind(limit);
      return (await stmt.all()).results;
    },
    async since(day) {
      await ensureSchema(db);
      const { results } = await db
        .prepare("SELECT day, who, cost_usd, status FROM questions WHERE day >= ? ORDER BY day DESC")
        .bind(day)
        .all();
      return results;
    },
    // 대화 목록: 들어온 코드(학생/관리자)의 대화를 최근 순으로. 제목은 첫 질문.
    async listConversations(who, limit = 50) {
      await ensureSchema(db);
      const { results } = await db
        .prepare(
          `SELECT c.conversation, c.n, c.updated, c.cost, q.question AS title, q.has_image
           FROM (SELECT conversation, MIN(id) AS first_id, MAX(id) AS last_id, COUNT(*) AS n,
                        MAX(created_at) AS updated, SUM(cost_usd) AS cost
                 FROM questions WHERE who = ? AND ${SHOWN} GROUP BY conversation) c
           JOIN questions q ON q.id = c.first_id
           ORDER BY c.last_id DESC LIMIT ?`,
        )
        .bind(who, limit)
        .all();
      return results;
    },
    // 대화 하나를 처음부터, 질문마다 붙인 사진(base64)까지 돌려준다.
    async loadConversation(who, conversation) {
      await ensureSchema(db);
      const { results: rows } = await db
        .prepare(
          `SELECT id, created_at, question, has_image, answer, status, model, input_tokens, cache_read_tokens,
                  cache_write_tokens, output_tokens, cost_usd
           FROM questions WHERE who = ? AND conversation = ? AND ${SHOWN} ORDER BY id ASC LIMIT 60`,
        )
        .bind(who, conversation)
        .all();
      if (!rows.length) return rows;
      const ids = rows.map((r) => r.id);
      const { results: photos } = await db
        .prepare(`SELECT question_id, idx, media_type, data FROM photos WHERE question_id IN (${ids.map(() => "?").join(", ")}) ORDER BY question_id, idx`)
        .bind(...ids)
        .all();
      for (const r of rows) r.photos = [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const p of photos) byId.get(p.question_id)?.photos.push({ type: p.media_type, data: toBase64(p.data) });
      return rows;
    },
  };
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// D1 은 BLOB 을 숫자 배열이나 ArrayBuffer 로 돌려준다
function toBase64(blob) {
  const bytes = blob instanceof ArrayBuffer ? new Uint8Array(blob) : Uint8Array.from(blob);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
