export function setupCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.scale(dpr, dpr);
  return ctx;
}

export function niceTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const step = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  let niceStep: number;
  if (norm < 1.5) niceStep = 1 * mag;
  else if (norm < 3) niceStep = 2 * mag;
  else if (norm < 7) niceStep = 5 * mag;
  else niceStep = 10 * mag;
  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;
  for (let v = start; v <= max; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo}/${day} ${hh}:${mm}`;
}

export const CHART_COLORS = {
  grid: "rgba(94,115,152,0.15)",
  axis: "#5e7398",
  up: "#3fdc9b",
  down: "#f65c7a",
  emaF: "#f2b33d",
  emaS: "#3bc9c4",
  rsi: "#6fa8ff",
  equity: "#f2b33d",
  bench: "#5e7398",
  cross: "rgba(233,240,251,0.4)",
};
