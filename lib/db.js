// D1 의 questions 표를 다룬다. 서버 함수 안에서만 쓴다.
// DB 가 연결되지 않았으면 null 을 돌려주고, 그때는 기록과 하루 제한 없이 돌아간다.
// 표는 처음 쓸 때 알아서 만든다(이미 있으면 그대로 둔다). 학생이 보낸 질문 하나가 한 줄이다.
// created_at 은 UTC, day 는 한국 날짜(하루 질문 수를 셀 때 쓴다),
// who 는 student / admin, status 는 pending / done / cut / refused / error.
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
];
const COLUMNS =
  "id, created_at, day, conversation, who, question, has_image, answer, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, status";

// 학생에게 보여 줄 줄: 학생이 한 질문 가운데 답이 남은 것(멈춘 답 포함)
const STUDENT_COLUMNS =
  "id, created_at, conversation, question, has_image, answer, status, model, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd";
const STUDENT_WHERE = "who = 'student' AND status IN ('done', 'cut', 'stopped') AND answer IS NOT NULL AND answer != ''";

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
    async list({ before, limit = 30 }) {
      await ensureSchema(db);
      const stmt = before
        ? db.prepare(`SELECT ${COLUMNS} FROM questions WHERE id < ? ORDER BY id DESC LIMIT ?`).bind(before, limit)
        : db.prepare(`SELECT ${COLUMNS} FROM questions ORDER BY id DESC LIMIT ?`).bind(limit);
      return (await stmt.all()).results;
    },
    // 학생에게 보여 줄 지난 질문. 학생이 한 질문 중 답이 남은 것만.
    async listForStudent({ before, limit = 30 }) {
      await ensureSchema(db);
      const stmt = before
        ? db.prepare(`SELECT ${STUDENT_COLUMNS} FROM questions WHERE ${STUDENT_WHERE} AND id < ? ORDER BY id DESC LIMIT ?`).bind(before, limit)
        : db.prepare(`SELECT ${STUDENT_COLUMNS} FROM questions WHERE ${STUDENT_WHERE} ORDER BY id DESC LIMIT ?`).bind(limit);
      return (await stmt.all()).results;
    },
    // 지난 질문을 이어서 물을 때 그 대화 전체를 처음부터 돌려준다.
    async conversationForStudent(conversation) {
      await ensureSchema(db);
      const { results } = await db
        .prepare(`SELECT ${STUDENT_COLUMNS} FROM questions WHERE ${STUDENT_WHERE} AND conversation = ? ORDER BY id ASC LIMIT 40`)
        .bind(conversation)
        .all();
      return results;
    },
    async since(day) {
      await ensureSchema(db);
      const { results } = await db
        .prepare("SELECT day, who, cost_usd, status FROM questions WHERE day >= ? ORDER BY day DESC")
        .bind(day)
        .all();
      return results;
    },
  };
}
