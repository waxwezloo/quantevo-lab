// ============================================================
// QuantEvo Lab — данные: Bybit V5 public API (kline, пагинация)
// с детерминированным синтетическим фолбэком (режимы + кластеризация волатильности)
// ============================================================

import type { Candle } from "./indicators";

export const PAIRS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "TONUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "ARBUSDT",
];

export const TIMEFRAMES = [
  { min: 60, label: "1Ч", interval: "60" },
  { min: 240, label: "4Ч", interval: "240" },
];

export const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 97400,
  ETHUSDT: 3480,
  SOLUSDT: 216,
  BNBUSDT: 642,
  XRPUSDT: 2.31,
  DOGEUSDT: 0.327,
  TONUSDT: 5.42,
  LINKUSDT: 21.6,
  AVAXUSDT: 38.4,
  ARBUSDT: 0.92,
};

const API = "https://api.bybit.com/v5/market/kline";

export type DataSource = "bybit" | "synthetic";

export async function loadKlines(
  symbol: string,
  intervalMin: number,
  days: number
): Promise<{ candles: Candle[]; source: DataSource }> {
  try {
    const candles = await fetchBybit(symbol, intervalMin, days);
    if (candles.length > 400) return { candles, source: "bybit" };
    throw new Error("insufficient data");
  } catch {
    return { candles: syntheticCandles(symbol, intervalMin, days), source: "synthetic" };
  }
}

async function fetchBybit(
  symbol: string,
  intervalMin: number,
  days: number
): Promise<Candle[]> {
  const end = Date.now();
  const start = end - days * 86400000;
  const all: Candle[] = [];
  let cursor = end;
  let guard = 0;
  while (cursor > start && guard < 30) {
    guard++;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const url =
      `${API}?category=spot&symbol=${symbol}&interval=${intervalMin}` +
      `&start=${start}&end=${cursor}&limit=1000`;
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      retCode: number;
      result?: { list?: string[][] };
    };
    if (json.retCode !== 0 || !json.result?.list) throw new Error("bad response");
    const list = json.result.list;
    if (list.length === 0) break;
    for (const k of list) {
      all.push({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
      });
    }
    const minT = Math.min(...list.map((k) => Number(k[0])));
    if (list.length < 1000 || minT <= start) break;
    cursor = minT - 1;
    await new Promise((r) => setTimeout(r, 130));
  }
  all.sort((a, b) => a.t - b.t);
  const seen = new Set<number>();
  const dedup: Candle[] = [];
  for (const c of all) {
    if (!seen.has(c.t)) {
      seen.add(c.t);
      dedup.push(c);
    }
  }
  return dedup.filter((c) => c.t >= start);
}

// ---------- синтетический фолбэк ----------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticCandles(
  symbol: string,
  intervalMin: number,
  days: number
): Candle[] {
  const n = Math.floor((days * 24 * 60) / intervalMin);
  const rng = mulberry32(hashStr(symbol) + intervalMin * 7 + days);
  const gauss = () => {
    const u = Math.max(rng(), 1e-9);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const base = BASE_PRICE[symbol] ?? 100;
  const scale = Math.sqrt(intervalMin / 60);
  const candles: Candle[] = [];
  let price = base * (0.72 + rng() * 0.2);
  let drift = 0;
  let vol = 0.006 * scale;
  let regimeLeft = 0;
  const stepMs = intervalMin * 60000;
  const t0 = Date.now() - n * stepMs;
  for (let i = 0; i < n; i++) {
    if (regimeLeft <= 0) {
      regimeLeft = 40 + Math.floor(rng() * 160);
      const r = rng();
      drift = r < 0.38 ? 0.0009 * scale * (0.4 + rng()) : r < 0.76 ? -0.0009 * scale * (0.4 + rng()) : 0;
      vol = (0.0035 + rng() * 0.0075) * scale;
    }
    regimeLeft--;
    const shock = rng() < 0.012 ? gauss() * 3.2 : gauss();
    const ret = drift + vol * shock;
    const o = price;
    const c = Math.max(o * (1 + ret), base * 0.05);
    const wickU = Math.abs(gauss()) * vol * 0.55;
    const wickD = Math.abs(gauss()) * vol * 0.55;
    const h = Math.max(o, c) * (1 + wickU);
    const l = Math.min(o, c) * (1 - wickD);
    candles.push({
      t: t0 + i * stepMs,
      o,
      h,
      l,
      c,
      v: (0.4 + rng()) * 1000 * (1 + Math.abs(ret) * 140),
    });
    price = c;
  }
  return candles;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
