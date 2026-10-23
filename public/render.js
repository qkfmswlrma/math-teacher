// 답 글을 화면에 그린다. 질문 화면과 기록 화면이 같이 쓴다.
// 수식($...$, $$...$$)을 먼저 떼어 두고, 나머지 글을 문단·인용·목록으로 나눈 뒤 수식을 KaTeX 로 그린다.
function renderAnswer(src) {
  const maths = [];
  const keep = (tex, display) => {
    maths.push({ tex, display });
    return `\u0000${maths.length - 1}\u0000`;
  };
  let s = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true))
    .replace(/\$([^\n$]+?)\$/g, (_, t) => keep(t, false))
    .replace(/\\\(([^\n]+?)\\\)/g, (_, t) => keep(t, false));
  s = escapeHtml(s);

  const out = [];
  let para = [];
  let quote = [];
  let list = null;
  const flushPara = () => { if (para.length) out.push(`<div class="p">${para.join("<br>")}</div>`); para = []; };
  const flushQuote = () => { if (quote.length) out.push(`<blockquote>${quote.join("<br>")}</blockquote>`); quote = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`); list = null; };
  const flushAll = () => { flushPara(); flushQuote(); flushList(); };

  for (const raw of s.split("\n")) {
    const line = raw.trim();
    const only = line.match(/^\u0000(\d+)\u0000$/);
    if (!line) { flushAll(); continue; }
    if (only && maths[+only[1]].display) { flushAll(); out.push(`<div class="math-block">${line}</div>`); continue; }
    if (line.startsWith("&gt;")) { flushPara(); flushList(); quote.push(line.replace(/^&gt;\s?/, "")); continue; }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara(); flushQuote();
      const tag = bullet ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((bullet || numbered)[1]);
      continue;
    }
    flushQuote(); flushList();
    para.push(line);
  }
  flushAll();

  return out
    .join("")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => renderMath(maths[+i]));
}

function renderMath({ tex, display }) {
  if (!window.katex) return `<code>${escapeHtml(tex)}</code>`;
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return `<code>${escapeHtml(tex)}</code>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// KaTeX 가 늦게 받아지면, 이미 그려 둔 답을 수식까지 다시 그린다.
const rendered = new Map();
function paint(el, text) {
  rendered.set(el, text);
  el.innerHTML = renderAnswer(text);
}
function rerenderAll() {
  for (const [el, text] of rendered) {
    if (el.isConnected) el.innerHTML = renderAnswer(text);
    else rendered.delete(el);
  }
}

// localStorage 는 막혀 있을 수 있으니 늘 감싸서 쓴다.
const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};
