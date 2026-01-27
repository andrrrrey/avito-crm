export function stableKey(parts: Array<string | number | null | undefined>) {
  const s = parts
    .map((p) => (p === null || p === undefined ? "" : String(p)))
    .join("|");

  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return `k_${h.toString(16)}`;
}

export function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Math.trunc(Number(v));
  return null;
}

export function pickFirstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return null;
}

export function pickFirstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = toInt(v);
    if (n !== null) return n;
  }
  return null;
}
