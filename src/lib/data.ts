// ============================================================
// QuantEvo Lab — данные: Bybit V5 public API (kline, пагинация),
// спот и USDT-перпетуал, все таймфреймы Bybit (1м — 1Н),
// детерминированный синтетический фолбэк
// ============================================================

import type { Candle } from "./indicators";

export type MarketMode = "spot" | "linear";

export const PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "TONUSDT", "LINKUSDT", "AVAXUSDT", "ARBUSDT",
  "OPUSDT", "ADAUSDT", "LTCUSDT", "BCHUSDT", "DOTUSDT",
  "NEARUSDT", "APTUSDT", "SUIUSDT", "SEIUSDT", "INJUSDT",
  "TIAUSDT", "PEPEUSDT", "WIFUSDT", "BONKUSDT", "FLOKIUSDT",
  "SHIBUSDT", "UNIUSDT", "AAVEUSDT", "FILUSDT", "ATOMUSDT",
  "ETCUSDT", "XLMUSDT", "TRXUSDT", "POLUSDT", "RENDERUSDT",
  "TAOUSDT", "ORDIUSDT", "JUPUSDT", "WLDUSDT", "ENAUSDT",
];

export const TIMEFRAMES = [
  { min: 1, label: "1М", interval: "1" },
  { min: 3, label: "3М", interval: "3" },
  { min: 5, label: "5М", interval: "5" },
  { min: 15, label: "15М", interval: "15" },
  { min: 30, label: "30М", interval: "30" },
  { min: 60, label: "1Ч", interval: "60" },
  { min: 120, label: "2Ч", interval: "120" },
  { min: 240, label: "4Ч", interval: "240" },
  { min: 360, label: "6Ч", interval: "360" },
  { min: 720, label: "12Ч", interval: "720" },
  { min: 1440, label: "1Д", interval: "D" },
  { min: 10080, label: "1Н", interval: "W" },
];

// Максимум свечей в серии: на минутных ТФ глубина автоматически
// урезается, чтобы бэктест оставался быстрым и наглядным.
export const MAX_BARS = 26000;

export function daysForTf(intervalMin: number): number {
  return Math.max(3, Math.min(365, Math.floor((MAX_BARS * intervalMin) / 1440)));
}

export const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 97400, ETHUSDT: 3480, SOLUSDT: 216, BNBUSDT: 642, XRPUSDT: 2.31,
  DOGEUSDT: 0.327, TONUSDT: 5.42, LINKUSDT: 21.6, AVAXUSDT: 38.4, ARBUSDT: 0.92,
  OPUSDT: 1.85, ADAUSDT: 0.98, LTCUSDT: 104, BCHUSDT: 470, DOTUSDT: 7.2,
  NEARUSDT: 5.4, APTUSDT: 9.1, SUIUSDT: 4.3, SEIUSDT: 0.42, INJUSDT: 22.5,
  TIAUSDT: 10.8, PEPEUSDT: 0.000018, WIFUSDT: 1.9, BONKUSDT: 0.000028, FLOKIUSDT: 0.00016,
  SHIBUSDT: 0.000022, UNIUSDT: 12.8, AAVEUSDT: 265, FILUSDT: 5.4, ATOMUSDT: 6.8,
  ETCUSDT: 26.5, XLMUSDT: 0.42, TRXUSDT: 0.24, POLUSDT: 0.45, RENDERUSDT: 7.2,
  TAOUSDT: 430, ORDIUSDT: 35, JUPUSDT: 0.9, WLDUSDT: 2.1, ENAUSDT: 0.85,
};

const API = "https://api.bybit.com/v5/market/kline";

export type DataSource = "bybit" | "synthetic";

export async function loadKlines(
  symbol: string,
  intervalMin: number,
  days: number,
  mode: MarketMode = "spot"
): Promise<{ candles: Candle[]; source: DataSource }> {
  try {
    const candles = await fetchBybit(symbol, intervalMin, days, mode);
    if (candles.length > 40) return { candles, source: "bybit" };
    throw new Error("insufficient data");
  } catch {
    return { candles: syntheticCandles(symbol, intervalMin, days), source: "synthetic" };
  }
}

async function fetchBybit(
  symbol: string,
  intervalMin: number,
  days: number,
  mode: MarketMode
): Promise<Candle[]> {
  const tf = TIMEFRAMES.find((t) => t.min === intervalMin);
  const interval = tf?.interval ?? String(intervalMin);
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
      `${API}?category=${mode}&symbol=${symbol}&interval=${interval}` +
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
    let minT = Infinity;
    for (const k of list) {
      const t = Number(k[0]);
      if (t < minT) minT = t;
      all.push({ t, o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) });
    }
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
