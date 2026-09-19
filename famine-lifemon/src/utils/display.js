// String.prototype.repeat throws RangeError for a negative, Infinity or
// otherwise invalid count, which crashes the whole passport. Stats are allowed
// to go negative (see the food accounting note in Scanner.js), and a group with
// no members divides by zero, so every count reaching repeat() must be
// sanitised. Never call .repeat() directly on a stat.
const MAX_SYMBOLS = 2000; // guards against a pathological value freezing the UI

export function repeatSymbol(symbol, count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return '';
  return symbol.repeat(Math.min(Math.floor(n), MAX_SYMBOLS));
}

// Safe division for per-group averages: 0 members must not yield NaN/Infinity.
export function perMember(total, members) {
  const t = Number(total);
  const m = Number(members);
  if (!Number.isFinite(t) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.floor(t / m);
}
