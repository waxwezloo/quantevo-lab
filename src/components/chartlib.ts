// Общие helpers для канвас-графиков
export function setupCanvas(
  canvas: HTMLCanvasElement,
  w: number,
  h: number
): CanvasRenderingContext2D | null {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

export function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (span <= 0 || !Number.isFinite(span)) return [min];
  const step0 = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export function fmtDate(ts: number, withTime = true): string {
  const d = new Date(ts);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  if (!withTime) return `${da}.${mo}.${String(d.getFullYear()).slice(2)}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${da}.${mo} ${hh}:${mm}`;
}

export const CHART_COLORS = {
  grid: "rgba(111,168,255,0.08)",
  axis: "#5e7398",
  up: "#3fdc9b",
  down: "#f65c7a",
  emaF: "#f2b33d",
  emaS: "#3bc9c4",
  rsi: "#6fa8ff",
  equity: "#f2b33d",
  bench: "#5e7398",
  dd: "rgba(246,92,122,0.35)",
  cross: "rgba(233,240,251,0.25)",
};
