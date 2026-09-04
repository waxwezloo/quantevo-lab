import { useEffect, useRef, useState } from "react";
import type { Candle } from "../lib/indicators";
import type { Trade } from "../lib/backtest";
import { fmtPrice } from "../lib/backtest";
import { setupCanvas, niceTicks, fmtDate, CHART_COLORS as C } from "./chartlib";

export interface ChartLevels {
  entry: number;
  sl: number;
  tp: number;
  side: 1 | -1;
}

interface Props {
  candles: Candle[];
  emaF: number[];
  emaS: number[];
  rsi: number[];
  rsiLow: number;
  rsiHigh: number;
  trades: Trade[];
  loading: boolean;
  levels?: ChartLevels | null;
}

const MAX_BARS = 640;

export default function PriceChart({ candles, emaF, emaS, rsi, rsiLow, rsiHigh, trades, loading, levels = null }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<number>(-1);

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

  const n = candles.length;
  const B = Math.max(1, Math.ceil(n / MAX_BARS));
  const m = Math.ceil(n / B);

  const buckets = (() => {
    if (n === 0) return null;
    const o = new Array<number>(m);
    const c = new Array<number>(m);
    const h = new Array<number>(m);
    const l = new Array<number>(m);
    const t = new Array<number>(m);
    const eF = new Array<number>(m);
    const eS = new Array<number>(m);
    const r = new Array<number>(m);
    for (let j = 0; j < m; j++) {
      const s = j * B;
      const e = Math.min(n, s + B);
      o[j] = candles[s].o;
      c[j] = candles[e - 1].c;
      t[j] = candles[s].t;
      let hh = -Infinity;
      let ll = Infinity;
      for (let i = s; i < e; i++) {
        if (candles[i].h > hh) hh = candles[i].h;
        if (candles[i].l < ll) ll = candles[i].l;
      }
      h[j] = hh;
      l[j] = ll;
      eF[j] = emaF.length > e - 1 ? emaF[e - 1] : candles[e - 1].c;
      eS[j] = emaS.length > e - 1 ? emaS[e - 1] : candles[e - 1].c;
      r[j] = rsi.length > e - 1 ? rsi[e - 1] : 50;
    }
    return { o, c, h, l, t, eF, eS, r };
  })();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 40 || !buckets || m === 0) return;
    const ctx = setupCanvas(canvas, size.w, size.h);
    if (!ctx) return;
    const W = size.w;
    const H = size.h;
    const padR = 64;
    const padT = 12;
    const rsiH = 78;
    const gap = 26;
    const plotW = W - padR - 8;
    const priceH = H - rsiH - gap - padT - 6;

    let yMin = Infinity;
    let yMax = -Infinity;
    for (let j = 0; j < m; j++) {
      if (buckets.l[j] < yMin) yMin = buckets.l[j];
      if (buckets.h[j] > yMax) yMax = buckets.h[j];
    }
    if (levels) {
      for (const v of [levels.entry, levels.sl, levels.tp]) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    const pad = (yMax - yMin) * 0.06 || 1;
    yMin -= pad;
    yMax += pad;
    const yP = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * priceH;
    const xB = (j: number) => 8 + ((j + 0.5) / m) * plotW;

    // сетка и цены
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    for (const v of niceTicks(yMin, yMax, 5)) {
      const y = yP(v);
      ctx.strokeStyle = C.grid;
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(8 + plotW, y);
      ctx.stroke();
      ctx.fillStyle = C.axis;
      ctx.fillText(fmtPrice(v), 8 + plotW + 8, y + 3);
    }
    ctx.textAlign = "center";
    const dateStep = Math.max(1, Math.floor(m / 6));
    for (let j = Math.floor(dateStep / 2); j < m; j += dateStep) {
      ctx.fillStyle = C.axis;
      ctx.fillText(fmtDate(buckets.t[j], false), xB(j), H - rsiH - gap + 16);
    }

    // ---------- зоны TP/SL (под свечами) ----------
    if (levels) {
      const yE = yP(levels.entry);
      const ySL = yP(levels.sl);
      const yTP = yP(levels.tp);
      ctx.fillStyle = "rgba(63,220,155,0.055)";
      ctx.fillRect(8, Math.min(yE, yTP), plotW, Math.abs(yTP - yE));
      ctx.fillStyle = "rgba(246,92,122,0.06)";
      ctx.fillRect(8, Math.min(yE, ySL), plotW, Math.abs(ySL - yE));
    }

    // свечи
    const cw = Math.max(1, (plotW / m) * 0.66);
    for (let j = 0; j < m; j++) {
      const up = buckets.c[j] >= buckets.o[j];
      const col = up ? C.up : C.down;
      const x = xB(j);
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, yP(buckets.h[j]));
      ctx.lineTo(x, yP(buckets.l[j]));
      ctx.stroke();
      ctx.fillStyle = col;
      const yO = yP(buckets.o[j]);
      const yC = yP(buckets.c[j]);
      ctx.fillRect(x - cw / 2, Math.min(yO, yC), cw, Math.max(1, Math.abs(yC - yO)));
    }

    // EMA
    const line = (arr: number[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let j = 0; j < m; j++) {
        const y = yP(arr[j]);
        if (!started) {
          ctx.moveTo(xB(j), y);
          started = true;
        } else ctx.lineTo(xB(j), y);
      }
      ctx.stroke();
      ctx.lineWidth = 1;
    };
    line(buckets.eS, C.emaS, 1.4);
    line(buckets.eF, C.emaF, 1.4);

    // ---------- линии ENTRY / SL / TP ----------
    if (levels) {
      const rows: Array<{ v: number; col: string; label: string; glow: string }> = [
        { v: levels.tp, col: "#3fdc9b", label: "TP", glow: "rgba(63,220,155,0.35)" },
        { v: levels.entry, col: "#ffd27a", label: levels.side === 1 ? "LONG" : "SHORT", glow: "rgba(242,179,61,0.35)" },
        { v: levels.sl, col: "#f65c7a", label: "SL", glow: "rgba(246,92,122,0.35)" },
      ];
      for (const r of rows) {
        const y = yP(r.v);
        ctx.strokeStyle = r.col;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(8 + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1;
        // метка слева
        ctx.font = "bold 9.5px JetBrains Mono, monospace";
        const txt = `${r.label} ${fmtPrice(r.v)}`;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = "rgba(7,13,26,0.85)";
        ctx.fillRect(10, y - 8, tw + 10, 15);
        ctx.strokeStyle = r.col;
        ctx.strokeRect(10, y - 8, tw + 10, 15);
        ctx.fillStyle = r.col;
        ctx.textAlign = "left";
        ctx.fillText(txt, 15, y + 3);
        // ценник справа
        ctx.fillStyle = r.col;
        ctx.fillRect(8 + plotW + 2, y - 7, padR - 4, 14);
        ctx.fillStyle = "#07101f";
        ctx.fillText(fmtPrice(r.v), 8 + plotW + 6, y + 3);
      }
      ctx.font = "10px JetBrains Mono, monospace";
    }

    // сделки
    for (const tr of trades) {
      const be = Math.floor(tr.entryI / B);
      const bx = Math.floor(tr.exitI / B);
      const col = tr.dir === 1 ? C.up : C.down;
      const xe = xB(Math.min(be, m - 1));
      const ye = yP(tr.entryP);
      ctx.fillStyle = col;
      ctx.beginPath();
      if (tr.dir === 1) {
        ctx.moveTo(xe, ye + 4);
        ctx.lineTo(xe - 4.5, ye + 11);
        ctx.lineTo(xe + 4.5, ye + 11);
      } else {
        ctx.moveTo(xe, ye - 4);
        ctx.lineTo(xe - 4.5, ye - 11);
        ctx.lineTo(xe + 4.5, ye - 11);
      }
      ctx.closePath();
      ctx.fill();
      const xx = xB(Math.min(bx, m - 1));
      const yx = yP(tr.exitP);
      ctx.strokeStyle = tr.pnlPct >= 0 ? C.up : C.down;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(xx - 3.5, yx - 3.5);
      ctx.lineTo(xx + 3.5, yx + 3.5);
      ctx.moveTo(xx + 3.5, yx - 3.5);
      ctx.lineTo(xx - 3.5, yx + 3.5);
      ctx.stroke();
      ctx.lineWidth = 1;
      if (Math.abs(xe - xx) > 10) {
        ctx.strokeStyle = tr.pnlPct >= 0 ? "rgba(63,220,155,0.28)" : "rgba(246,92,122,0.28)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(xe, ye);
        ctx.lineTo(xx, yx);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // RSI-панель
    const rsiTop = H - rsiH - 4;
    const yR = (v: number) => rsiTop + (1 - v / 100) * rsiH;
    ctx.fillStyle = "rgba(111,168,255,0.04)";
    ctx.fillRect(8, rsiTop, plotW, rsiH);
    ctx.strokeStyle = C.grid;
    ctx.strokeRect(8, rsiTop, plotW, rsiH);
    ctx.fillStyle = "rgba(242,179,61,0.06)";
    ctx.fillRect(8, rsiTop, plotW, yR(rsiHigh) - rsiTop);
    ctx.fillRect(8, yR(rsiLow), plotW, rsiTop + rsiH - yR(rsiLow));
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(242,179,61,0.4)";
    for (const lvl of [rsiLow, rsiHigh]) {
      ctx.beginPath();
      ctx.moveTo(8, yR(lvl));
      ctx.lineTo(8 + plotW, yR(lvl));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = C.rsi;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let j = 0; j < m; j++) {
      const y = yR(Math.max(0, Math.min(100, buckets.r[j])));
      if (j === 0) ctx.moveTo(xB(j), y);
      else ctx.lineTo(xB(j), y);
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = C.axis;
    ctx.textAlign = "left";
    ctx.fillText(`RSI ${Math.round(buckets.r[m - 1])}`, 8 + plotW + 8, yR(buckets.r[m - 1]) + 3);
    ctx.fillText("RSI", 12, rsiTop + 12);

    // crosshair
    if (hover >= 0 && hover < m) {
      const x = xB(hover);
      ctx.strokeStyle = C.cross;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, H - 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(233,240,251,0.5)";
      ctx.strokeRect(x - cw / 2 - 1.5, yP(buckets.h[hover]) - 1.5, cw + 3, yP(buckets.l[hover]) - yP(buckets.h[hover]) + 3);
    }
  }, [size, buckets, hover, trades, m, rsiLow, rsiHigh, levels]);

  const hj = hover >= 0 && hover < m ? hover : m - 1;
  const hc = buckets && hj >= 0 && hj < m ? buckets.c[hj] : NaN;

  return (
    <div className="relative h-full w-full">
      <div ref={wrapRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="cursor-crosshair"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const plotW = size.w - 64 - 8;
            const j = Math.floor(((x - 8) / plotW) * m);
            setHover(j >= 0 && j < m ? j : -1);
          }}
          onMouseLeave={() => setHover(-1)}
        />
      </div>
      {buckets && hj >= 0 && hj < m && Number.isFinite(hc) ? (
        <div className="absolute top-2 left-3 qe-num text-[10.5px] leading-[1.7] text-mut bg-bg0/80 border border-line rounded-md px-2.5 py-1.5 pointer-events-none backdrop-blur-sm">
          <span className="text-dim">{fmtDate(buckets.t[hj])}</span>
          {"  O "}
          <span className="text-ink">{fmtPrice(buckets.o[hj])}</span>
          {" H "}
          <span className="text-green">{fmtPrice(buckets.h[hj])}</span>
          {" L "}
          <span className="text-red">{fmtPrice(buckets.l[hj])}</span>
          {" C "}
          <span className={buckets.c[hj] >= buckets.o[hj] ? "text-green" : "text-red"}>
            {fmtPrice(buckets.c[hj])}
          </span>
          {" · RSI "}
          <span className="text-blue">{buckets.r[hj].toFixed(0)}</span>
          {" · EMAf "}
          <span className="text-amber2">{fmtPrice(buckets.eF[hj])}</span>
        </div>
      ) : null}
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg0/60 backdrop-blur-[2px]">
          <div className="qe-num text-[12px] text-teal tracking-[0.2em] flex items-center gap-2">
            <span className="led led-pulse" style={{ background: "#3bc9c4", boxShadow: "0 0 8px #3bc9c4" }} />
            ЗАГРУЗКА ДАННЫХ…
          </div>
        </div>
      ) : null}
    </div>
  );
}
