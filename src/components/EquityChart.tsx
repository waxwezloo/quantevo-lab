import { useEffect, useRef, useState } from "react";
import { setupCanvas, niceTicks, fmtDate, CHART_COLORS as C } from "./chartlib";

interface Props {
  equity: number[] | null;
  bench: number[] | null; // buy&hold, нормированный к стартовому капиталу
  times: number[];
  loading: boolean;
}

export default function EquityChart({ equity, bench, times, loading }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState(-1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect;
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = equity ? equity.length : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 40 || !equity || n < 2) return;
    const ctx = setupCanvas(canvas, size.w, size.h);
    if (!ctx) return;
    const W = size.w;
    const H = size.h;
    const padR = 58;
    const padT = 10;
    const padB = 20;
    const plotW = W - padR - 8;
    const plotH = H - padT - padB;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = equity[i];
      if (a < yMin) yMin = a;
      if (a > yMax) yMax = a;
      if (bench) {
        const b = bench[i];
        if (b < yMin) yMin = b;
        if (b > yMax) yMax = b;
      }
    }
    const pad = (yMax - yMin) * 0.08 || 1;
    yMin -= pad;
    yMax += pad;
    const xI = (i: number) => 8 + (i / (n - 1)) * plotW;
    const yV = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    for (const v of niceTicks(yMin, yMax, 5)) {
      const y = yV(v);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(8 + plotW, y);
      ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.fillText((v / 1000).toFixed(1) + "k", 8 + plotW + 8, y + 3);
    }
    ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(n / 6));
    for (let i = Math.floor(step / 2); i < n; i += step) {
      if (!times[i]) continue;
      ctx.fillStyle = C.axis;
      ctx.fillText(fmtDate(times[i], false), xI(i), H - 6);
    }

    // benchmark — пунктир
    if (bench) {
      ctx.strokeStyle = C.bench;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (i === 0) ctx.moveTo(xI(i), yV(bench[i]));
        else ctx.lineTo(xI(i), yV(bench[i]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // кривая капитала + градиентная заливка
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i === 0) ctx.moveTo(xI(i), yV(equity[i]));
      else ctx.lineTo(xI(i), yV(equity[i]));
    }
    ctx.strokeStyle = C.equity;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.lineTo(xI(n - 1), padT + plotH);
    ctx.lineTo(8, padT + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, "rgba(242,179,61,0.20)");
    grad.addColorStop(1, "rgba(242,179,61,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // просадка (нижняя полоса)
    let peak = -Infinity;
    const dd = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      if (equity[i] > peak) peak = equity[i];
      dd[i] = 1 - equity[i] / peak;
    }
    const ddH = plotH * 0.22;
    ctx.fillStyle = C.dd;
    ctx.beginPath();
    ctx.moveTo(xI(0), padT + plotH);
    for (let i = 0; i < n; i++) {
      const v = Math.min(dd[i] / 0.5, 1);
      ctx.lineTo(xI(i), padT + plotH - v * ddH);
    }
    ctx.lineTo(xI(n - 1), padT + plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(246,92,122,0.8)";
    ctx.textAlign = "left";
    ctx.fillText("DRAWDOWN", 12, padT + plotH - ddH + 10);

    // crosshair
    if (hover >= 0 && hover < n) {
      const x = xI(hover);
      ctx.strokeStyle = C.cross;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.equity;
      ctx.beginPath();
      ctx.arc(x, yV(equity[hover]), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [size, equity, bench, times, hover, n]);

  const hi = hover >= 0 && hover < n ? hover : n - 1;

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const plotW = size.w - 58 - 8;
            const i = Math.round(((e.clientX - rect.left - 8) / plotW) * (n - 1));
            setHover(i >= 0 && i < n ? i : -1);
          }}
          onMouseLeave={() => setHover(-1)}
        />
      </div>
      {equity && n > 0 && hi >= 0 ? (
        <div className="absolute top-1.5 left-3 qe-num text-[10.5px] text-mut bg-bg0/80 border border-line rounded-md px-2.5 py-1 pointer-events-none">
          <span className="text-dim">{fmtDate(times[hi] ?? 0)}</span>
          {" · Капитал "}
          <span className="text-amber2">${equity[hi].toFixed(0)}</span>
          {bench ? (
            <>
              {" · B&H "}
              <span className="text-mut">${bench[hi].toFixed(0)}</span>
            </>
          ) : null}
          {" · "}
          <span className={equity[hi] >= equity[0] ? "text-green" : "text-red"}>
            {((equity[hi] / equity[0] - 1) * 100).toFixed(1)}%
          </span>
        </div>
      ) : null}
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg0/60">
          <span className="qe-num text-[12px] text-teal tracking-[0.2em]">РАСЧЁТ…</span>
        </div>
      ) : null}
    </div>
  );
}
