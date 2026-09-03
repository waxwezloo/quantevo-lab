import { useEffect, useRef, useState } from "react";
import type { GenInfo } from "../lib/ga";
import { setupCanvas, CHART_COLORS as C } from "./chartlib";

interface Props {
  history: GenInfo[];
  running: boolean;
}

export default function FitnessChart({ history, running }: Props) {
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

  const g = history.length;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 40) return;
    const ctx = setupCanvas(canvas, size.w, size.h);
    if (!ctx) return;
    const W = size.w;
    const H = size.h;
    const padR = 40;
    const padT = 12;
    const padB = 18;
    const plotW = W - padR - 8;
    const plotH = H - padT - padB;

    if (g === 0) {
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillStyle = C.axis;
      ctx.textAlign = "center";
      ctx.fillText("запустите эволюцию — здесь появится динамика фитнеса", W / 2, H / 2);
      return;
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const h of history) {
      yMin = Math.min(yMin, h.avg, h.best);
      yMax = Math.max(yMax, h.avg, h.best);
    }
    const pad = (yMax - yMin) * 0.15 || 1;
    yMin -= pad;
    yMax += pad;
    const xG = (i: number) => 8 + (g === 1 ? 0.5 : i / (g - 1)) * plotW;
    const yV = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    ctx.font = "9.5px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    for (let k = 0; k <= 4; k++) {
      const v = yMin + ((yMax - yMin) * k) / 4;
      const y = yV(v);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(8 + plotW, y);
      ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.fillText(v.toFixed(1), 8 + plotW + 6, y + 3);
    }

    // zero line
    if (yMin < 0 && yMax > 0) {
      ctx.strokeStyle = "rgba(233,240,251,0.18)";
      ctx.beginPath();
      ctx.moveTo(8, yV(0));
      ctx.lineTo(8 + plotW, yV(0));
      ctx.stroke();
    }

    // area under best
    ctx.beginPath();
    history.forEach((h, i) => {
      if (i === 0) ctx.moveTo(xG(i), yV(h.best));
      else ctx.lineTo(xG(i), yV(h.best));
    });
    const strokePath = () => ctx.stroke();
    ctx.strokeStyle = C.equity;
    ctx.lineWidth = 1.8;
    strokePath();
    ctx.lineWidth = 1;
    ctx.lineTo(xG(g - 1), padT + plotH);
    ctx.lineTo(xG(0), padT + plotH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, "rgba(242,179,61,0.16)");
    grad.addColorStop(1, "rgba(242,179,61,0)");
    ctx.fillStyle = grad;
    ctx.fill();

    // avg line
    ctx.strokeStyle = "#3bc9c4";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    history.forEach((h, i) => {
      if (i === 0) ctx.moveTo(xG(i), yV(h.avg));
      else ctx.lineTo(xG(i), yV(h.avg));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // hover
    if (hover >= 0 && hover < g) {
      const x = xG(hover);
      ctx.strokeStyle = C.cross;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [size, history, hover, g]);

  const last = g > 0 ? history[g - 1] : null;
  const lastX = g > 1 ? 8 + ((size.w - 40 - 8) * 1) : 0;
  void lastX;

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseMove={(e) => {
            if (g < 2) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const plotW = size.w - 40 - 8;
            const i = Math.round(((e.clientX - rect.left - 8) / plotW) * (g - 1));
            setHover(i >= 0 && i < g ? i : -1);
          }}
          onMouseLeave={() => setHover(-1)}
        />
      </div>
      {hover >= 0 && hover < g ? (
        <div className="absolute top-1 left-3 qe-num text-[10px] text-mut bg-bg0/85 border border-line rounded px-2 py-0.5 pointer-events-none">
          поколение {history[hover].gen} · best{" "}
          <span className="text-amber2">{history[hover].best.toFixed(2)}</span> · avg{" "}
          <span className="text-teal">{history[hover].avg.toFixed(2)}</span>
        </div>
      ) : last ? (
        <div className="absolute top-1 left-3 qe-num text-[10px] text-mut pointer-events-none flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full bg-amber ${running ? "pulse-dot" : ""}`} />
          gen {last.gen}: best {last.best.toFixed(2)}
        </div>
      ) : null}
    </div>
  );
}
