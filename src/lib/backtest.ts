// ============================================================
// QuantEvo Lab — стратегия FibDiv + бэктест + фитнес
// Вход: цена в Фибо-зоне ретрейсмента + RSI-дивергенция +
// Такенс-импульс (EKF) + трендовый фильтр EMA.
// Исполнение на открытии следующего бара, TP/SL внутри бара,
// комиссия и проскальзывание, реверс-выход по противоположному сигналу.
// ============================================================

import type { Candle } from "./indicators";
import {
  ema,
  rsiWilder,
  findPivots,
  takensMomentum,
  divergenceFlags,
  fibZones,
} from "./indicators";

export interface GeneDef {
  key: string;
  label: string;
  min: number;
  max: number;
  int?: boolean;
  log?: boolean;
  unit?: string;
}

export const GENES: GeneDef[] = [
  { key: "rsiPeriod", label: "RSI · период", min: 6, max: 36, int: true, unit: "бар" },
  { key: "rsiLow", label: "RSI · перепроданность", min: 15, max: 42, int: true },
  { key: "rsiHigh", label: "RSI · перекупленность", min: 58, max: 85, int: true },
  { key: "emaFast", label: "EMA быстрая", min: 8, max: 60, int: true, unit: "бар" },
  { key: "emaSlow", label: "EMA медленная", min: 70, max: 260, int: true, unit: "бар" },
  { key: "takensDelay", label: "Такенс τ · лаг", min: 1, max: 12, int: true },
  { key: "takensDim", label: "Такенс m · размерность", min: 2, max: 6, int: true },
  { key: "kalmanQ", label: "EKF · шум процесса Q", min: 1e-5, max: 3e-2, log: true },
  { key: "momThr", label: "Порог Такенс-импульса", min: 0, max: 1.6 },
  { key: "divLookback", label: "Окно дивергенции", min: 10, max: 90, int: true, unit: "бар" },
  { key: "swingLen", label: "Плечо свинга", min: 3, max: 14, int: true, unit: "бар" },
  { key: "fibLo", label: "Фибо-зона · от", min: 0.2, max: 0.5 },
  { key: "fibHi", label: "Фибо-зона · до", min: 0.55, max: 0.85 },
  { key: "tpPct", label: "Тейк-профит", min: 0.6, max: 9, unit: "%" },
  { key: "slPct", label: "Стоп-лосс", min: 0.4, max: 7, unit: "%" },
];

export type Genome = number[];
export type Params = Record<string, number>;

export function decodeGenome(g: Genome): Params {
  const p: Params = {};
  GENES.forEach((d, i) => {
    p[d.key] = d.int ? Math.round(g[i]) : g[i];
  });
  if (p.emaFast >= p.emaSlow) {
    p.emaFast = Math.max(GENES[3].min, Math.min(p.emaFast, p.emaSlow - 12));
    p.emaSlow = Math.min(GENES[4].max, Math.max(p.emaSlow, p.emaFast + 12));
  }
  if (p.fibLo >= p.fibHi) {
    const mid = (p.fibLo + p.fibHi) / 2;
    p.fibLo = Math.max(0.2, mid - 0.06);
    p.fibHi = Math.min(0.85, mid + 0.06);
  }
  return p;
}

export interface StratCfg {
  allowShort: boolean;
  trendFilter: boolean;
  feePct: number;
  slipPct: number;
  minTrades: number;
}

export interface Trade {
  dir: 1 | -1;
  entryI: number;
  exitI: number;
  entryP: number;
  exitP: number;
  pnlPct: number;
  reason: string;
}

export interface Metrics {
  returnPct: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDD: number;
  winRate: number;
  pf: number;
  trades: number;
  avgPct: number;
  exposure: number;
}

export interface BacktestResult {
  equity: number[];
  trades: Trade[];
  metrics: Metrics;
}

const START_EQ = 10000;

export function runBacktest(
  candles: Candle[],
  tfMinutes: number,
  p: Params,
  cfg: StratCfg
): BacktestResult {
  const n = candles.length;
  const open = new Array<number>(n);
  const high = new Array<number>(n);
  const low = new Array<number>(n);
  const close = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    open[i] = candles[i].o;
    high[i] = candles[i].h;
    low[i] = candles[i].l;
    close[i] = candles[i].c;
  }

  const emaF = ema(close, p.emaFast);
  const emaS = ema(close, p.emaSlow);
  const rsi = rsiWilder(close, p.rsiPeriod);
  const mom = takensMomentum(close, p.takensDelay, p.takensDim, p.kalmanQ);

  const swingLen = Math.round(p.swingLen);
  const { lows, highs } = findPivots(high, low, swingLen);
  const bullDiv = divergenceFlags(lows, rsi, p.divLookback, n, "bull", swingLen);
  const bearDiv = divergenceFlags(highs, rsi, p.divLookback, n, "bear", swingLen);
  const life = Math.round(p.divLookback) * 2 + 30;
  const longZ = fibZones(highs, lows, p.fibLo, p.fibHi, life, swingLen, n, "long");
  const shortZ = fibZones(highs, lows, p.fibLo, p.fibHi, life, swingLen, n, "short");

  const warm = Math.max(
    p.emaSlow + 5,
    p.rsiPeriod + 5,
    (Math.round(p.takensDim) - 1) * Math.round(p.takensDelay) + 60,
    swingLen * 2 + 5
  );

  const fee = cfg.feePct / 100;
  const slip = cfg.slipPct / 100;

  const longCond = (t: number): boolean => {
    const lo = longZ.lo[t];
    if (Number.isNaN(lo)) return false;
    if (close[t] < lo || close[t] > longZ.hi[t]) return false;
    if (!bullDiv[t]) return false;
    if (mom[t] <= p.momThr) return false;
    if (rsi[t] >= p.rsiHigh) return false;
    if (cfg.trendFilter && emaF[t] <= emaS[t]) return false;
    return true;
  };
  const shortCond = (t: number): boolean => {
    const lo = shortZ.lo[t];
    if (Number.isNaN(lo)) return false;
    if (close[t] < lo || close[t] > shortZ.hi[t]) return false;
    if (!bearDiv[t]) return false;
    if (mom[t] >= -p.momThr) return false;
    if (rsi[t] <= p.rsiLow) return false;
    if (cfg.trendFilter && emaF[t] >= emaS[t]) return false;
    return true;
  };

  const equity = new Array<number>(n).fill(START_EQ);
  const trades: Trade[] = [];
  let eq = START_EQ;
  let pos: 0 | 1 | -1 = 0;
  let entryP = 0;
  let entryI = 0;
  let tp = 0;
  let sl = 0;
  let pendingDir: 0 | 1 | -1 = 0;
  let barsInPos = 0;

  for (let t = warm; t < n; t++) {
    const c = close[t];
    // исполнение отложенного входа по открытию бара
    if (pendingDir !== 0) {
      const o = open[t] * (1 + slip * pendingDir);
      entryP = o;
      entryI = t;
      pos = pendingDir;
      pendingDir = 0;
      tp = pos === 1 ? o * (1 + p.tpPct / 100) : o * (1 - p.tpPct / 100);
      sl = pos === 1 ? o * (1 - p.slPct / 100) : o * (1 + p.slPct / 100);
    }

    if (pos !== 0) {
      barsInPos++;
      let exitP = 0;
      let reason = "";
      if (pos === 1) {
        if (low[t] <= sl) {
          exitP = sl;
          reason = "SL";
        } else if (high[t] >= tp) {
          exitP = tp;
          reason = "TP";
        }
      } else {
        if (high[t] >= sl) {
          exitP = sl;
          reason = "SL";
        } else if (low[t] <= tp) {
          exitP = tp;
          reason = "TP";
        }
      }
      if (exitP === 0) {
        const rev = pos === 1 ? shortCond(t) : longCond(t);
        if (rev) {
          exitP = c;
          reason = "REV";
        } else if (pos === 1 && rsi[t] > p.rsiHigh + 6) {
          exitP = c;
          reason = "RSI";
        } else if (pos === -1 && rsi[t] < p.rsiLow - 6) {
          exitP = c;
          reason = "RSI";
        }
      }
      if (exitP > 0) {
        const gross = pos * (exitP - entryP) / entryP;
        const net = gross - 2 * fee;
        eq *= 1 + net;
        trades.push({
          dir: pos,
          entryI,
          exitI: t,
          entryP,
          exitP,
          pnlPct: net * 100,
          reason,
        });
        pos = 0;
      }
    }

    if (pos === 0 && pendingDir === 0 && t + 1 < n) {
      if (longCond(t)) pendingDir = 1;
      else if (cfg.allowShort && shortCond(t)) pendingDir = -1;
    }

    equity[t] =
      pos === 0
        ? eq
        : eq * (1 + pos * ((c - entryP) / entryP) - fee);
  }

  if (pos !== 0) {
    const exitP = close[n - 1];
    const gross = pos * (exitP - entryP) / entryP;
    const net = gross - 2 * fee;
    eq *= 1 + net;
    trades.push({
      dir: pos,
      entryI,
      exitI: n - 1,
      entryP,
      exitP,
      pnlPct: net * 100,
      reason: "EOD",
    });
    equity[n - 1] = eq;
  }

  return { equity, trades, metrics: computeMetrics(equity, trades, n, tfMinutes, barsInPos) };
}

export function computeMetrics(
  equity: number[],
  trades: Trade[],
  n: number,
  tfMinutes: number,
  barsInPos: number
): Metrics {
  const ppy = (365 * 24 * 60) / tfMinutes;
  const final = equity[n - 1];
  const returnPct = (final / START_EQ - 1) * 100;
  const cagr = n > 0 ? Math.pow(Math.max(final / START_EQ, 1e-6), ppy / n) - 1 : 0;

  let mean = 0;
  let cnt = 0;
  const rets: number[] = [];
  for (let i = 1; i < n; i++) {
    const r = equity[i] / equity[i - 1] - 1;
    rets.push(r);
    mean += r;
    cnt++;
  }
  mean = cnt ? mean / cnt : 0;
  let varr = 0;
  let downVar = 0;
  let downCnt = 0;
  for (const r of rets) {
    varr += (r - mean) * (r - mean);
    if (r < 0) {
      downVar += r * r;
      downCnt++;
    }
  }
  const sd = cnt > 1 ? Math.sqrt(varr / (cnt - 1)) : 0;
  const dd = downCnt > 0 ? Math.sqrt(downVar / Math.max(cnt, 1)) : 0;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(ppy) : 0;
  const sortino = dd > 0 ? (mean / dd) * Math.sqrt(ppy) : 0;

  let peak = -Infinity;
  let maxDD = 0;
  for (let i = 0; i < n; i++) {
    if (equity[i] > peak) peak = equity[i];
    const d = 1 - equity[i] / peak;
    if (d > maxDD) maxDD = d;
  }

  let wins = 0;
  let grossW = 0;
  let grossL = 0;
  let sumPct = 0;
  for (const tr of trades) {
    sumPct += tr.pnlPct;
    if (tr.pnlPct > 0) {
      wins++;
      grossW += tr.pnlPct;
    } else grossL += -tr.pnlPct;
  }
  const nt = trades.length;
  return {
    returnPct,
    cagr: cagr * 100,
    sharpe,
    sortino,
    maxDD,
    winRate: nt ? (wins / nt) * 100 : 0,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? 99 : 0,
    trades: nt,
    avgPct: nt ? sumPct / nt : 0,
    exposure: n ? barsInPos / n : 0,
  };
}

// ---------- фитнес ----------
export interface GAWeights {
  sharpe: number;
  pf: number;
  ret: number;
  dd: number;
}

export function fitness(m: Metrics, w: GAWeights, minTrades: number): number {
  if (m.trades < minTrades) return -25 - (minTrades - m.trades) * 0.8;
  const sh = clamp(m.sharpe, -4, 6);
  const pfT = Math.log(clamp(m.pf, 0.05, 30));
  const rt = clamp(m.returnPct / 100, -3, 8);
  const score =
    w.sharpe * sh + w.pf * pfT + w.ret * rt - w.dd * m.maxDD * 10 + 0.5 * Math.log10(m.trades + 1);
  return clamp(score, -60, 60);
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

export function fmtPrice(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 5 });
}
