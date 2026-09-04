// ============================================================
// QuantEvo Lab — данные Bybit V5 (kline, пагинация) + синтетика
// ============================================================
import type { Candle } from "./indicators";

export const PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT",
  "DOTUSDT", "LINKUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "ATOMUSDT", "UNIUSDT", "XLMUSDT",
  "NEARUSDT", "ETCUSDT", "FILUSDT", "TRXUSDT", "APTUSDT", "ARBUSDT", "OPUSDT", "INJUSDT",
  "SUIUSDT", "SEIUSDT", "TIAUSDT", "PEPEUSDT", "SHIBUSDT", "WIFUSDT", "ORDIUSDT", "RUNEUSDT",
  "AAVEUSDT", "MKRUSDT", "GRTUSDT", "ALGOUSDT", "FLOWUSDT", "IMXUSDT", "STXUSDT", "ENAUSDT",
];

export const BASE_PRICE: Record<string, number> = {
  BTCUSDT: 97000, ETHUSDT: 3550, SOLUSDT: 210, BNBUSDT: 640, XRPUSDT: 2.3, ADAUSDT: 0.92,
  DOGEUSDT: 0.32, AVAXUSDT: 41, DOTUSDT: 7.4, LINKUSDT: 22.5, MATICUSDT: 0.52, LTCUSDT: 105,
  BCHUSDT: 470, ATOMUSDT: 7.1, UNIUSDT: 13.4, XLMUSDT: 0.42, NEARUSDT: 5.6, ETCUSDT: 27,
  FILUSDT: 5.4, TRXUSDT: 0.24, APTUSDT: 9.3, ARBUSDT: 0.82, OPUSDT: 1.9, INJUSDT: 24,
  SUIUSDT: 4.4, SEIUSDT: 0.46, TIAUSDT: 5.2, PEPEUSDT: 0.000019, SHIBUSDT: 0.000022,
  WIFUSDT: 2.1, ORDIUSDT: 21, RUNEUSDT: 5.3, AAVEUSDT: 300, MKRUSDT: 1650, GRTUSDT: 0.21,
  ALGOUSDT: 0.34, FLOWUSDT: 0.78, IMXUSDT: 1.35, STXUSDT: 1.6, ENAUSDT: 0.95,
};

// Все таймфреймы Bybit V5 kline
export const TIMEFRAMES = [
  { label: "1м", min: 1 }, { label: "3м", min: 3 }, { label: "5м", min: 5 },
  { label: "15м", min: 15 }, { label: "30м", min: 30 }, { label: "1Ч", min: 60 },
  { label: "2Ч", min: 120 }, { label: "4Ч", min: 240 }, { label: "6Ч", min: 360 },
  { label: "12Ч", min: 720 }, { label: "1Д", min: 1440 }, { label: "1Н", min: 10080 },
];

export function daysForTf(tfMin: number): number {
  if (tfMin >= 240) return 365;
  if (tfMin >= 60) return 365;
  return Math.max(3, Math.min(365, Math.floor(26000 / (1440 / tfMin))));
}

export type DataSource = "bybit" | "synthetic";

const INTERVAL_MAP: Record<number, string> = {
  1: "1", 3: "3", 5: "5", 15: "15", 30: "30", 60: "60", 120: "120", 240: "240",
  360: "360", 720: "720", 1440: "D", 10080: "W",
};

export function bybitBase(testnet = false): string {
  return testnet ? "https://api-testnet.bybit.com" : "https://api.bybit.com";
}

export async function fetchBybitKlines(
  symbol: string,
  tfMinutes: number,
  days: number,
  category: "spot" | "linear" = "spot",
  testnet = false,
  onProgress?: (count: number) => void
): Promise<Candle[]> {
  const interval = INTERVAL_MAP[tfMinutes];
  if (!interval) throw new Error(`Неподдерживаемый таймфрейм: ${tfMinutes}`);
  const end = Date.now();
  const start = end - days * 86400000;
  const all: Candle[] = [];
  let cursor = end;
  let pages = 0;
  while (cursor > start && pages < 60) {
    const url =
      `${bybitBase(testnet)}/v5/market/kline?category=${category}&symbol=${symbol}` +
      `&interval=${interval}&start=${start}&end=${cursor}&limit=1000`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.retCode !== 0) throw new Error(String(json.retMsg ?? "Bybit error"));
    const list: string[][] = json.result?.list ?? [];
    if (list.length === 0) break;
    for (const k of list) {
      all.push({ t: Number(k[0]), o: Number(k[1]), h: Number(k[2]), l: Number(k[3]), c: Number(k[4]), v: Number(k[5]) });
    }
    onProgress?.(all.length);
    const oldest = Math.min(...list.map((k) => Number(k[0])));
    if (list.length < 1000 || oldest <= start) break;
    cursor = oldest - 1;
    pages++;
    await new Promise((r) => setTimeout(r, 120));
  }
  all.sort((a, b) => a.t - b.t);
  const seen = new Set<number>();
  const out: Candle[] = [];
  for (const c of all) {
    if (!seen.has(c.t)) {
      seen.add(c.t);
      out.push(c);
    }
  }
  return out;
}

// ------------------------------------------------------------
// Синтетический фолбэк: GBM со сменой режимов (тренд/флэт/шоки)
// детерминирован по паре+таймфрейму
// ------------------------------------------------------------
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

function gaussFrom(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function synthKlines(symbol: string, tfMinutes: number, days: number): Candle[] {
  const seed = hashStr(symbol + ":" + tfMinutes);
  const rng = mulberry32(seed);
  const gauss = () => gaussFrom(rng);
  const base = BASE_PRICE[symbol] ?? 100;
  const n = Math.max(120, Math.floor((days * 1440) / tfMinutes));
  const stepMs = tfMinutes * 60000;
  const t0 = Date.now() - n * stepMs;
  const candles: Candle[] = [];
  let price = base * (0.55 + rng() * 0.5);
  let drift = 0;
  let vol = 0.011 * Math.sqrt(tfMinutes / 60);
  let regimeLeft = 0;
  for (let i = 0; i < n; i++) {
    if (regimeLeft <= 0) {
      regimeLeft = 40 + Math.floor(rng() * 240);
      drift = (rng() - 0.44) * 0.0011 * (tfMinutes / 60);
      vol = (0.004 + rng() * 0.013) * Math.sqrt(tfMinutes / 60);
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
      o, h, l, c,
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

export async function loadKlines(
  symbol: string,
  tfMinutes: number,
  days: number,
  category: "spot" | "linear" = "spot",
  onProgress?: (count: number) => void
): Promise<{ candles: Candle[]; source: DataSource }> {
  try {
    const cs = await fetchBybitKlines(symbol, tfMinutes, days, category, false, onProgress);
    if (cs.length < 100) throw new Error("слишком мало данных");
    return { candles: cs, source: "bybit" };
  } catch {
    return { candles: synthKlines(symbol, tfMinutes, days), source: "synthetic" };
  }
}
