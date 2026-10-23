// 100만 토큰당 달러. 캐시 쓰기는 5분 캐시 값(입력의 1.25배).
const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20, read: 0.2, write: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.2, write: 2.5 },
};

export function costUsd(model, usage = {}) {
  const p = PRICES[model] || PRICES["claude-opus-5-5"];
  return (
    ((usage.input_tokens || 0) * p.in +
      (usage.cache_read_input_tokens || 0) * p.read +
      (usage.cache_creation_input_tokens || 0) * p.write +
      (usage.output_tokens || 0) * p.out) /
    1e6
  );
}
