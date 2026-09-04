// ============================================================
// QuantEvo Lab — индикаторы:
// EMA, RSI(Wilder), свинг-пивоты, метод Такенса (delay-embedding
// + PCA) и расширенный фильтр Калмана, RSI-дивергенции, Фибо-зоны
// ============================================================

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export function ema(src: number[], period: number): number[] {
  const k = 2 / (Math.max(1, Math.round(period)) + 1);
  const out = new Array<number>(src.length);
  let prev = src[0] ?? 0;
  for (let i = 0; i < src.length; i++) {
    prev = i === 0 ? src[i] : src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiWilder(src: number[], period: number): number[] {
  const p = Math.max(2, Math.round(period));
  const n = src.length;
  const out = new Array<number>(n).fill(50);
  if (n <= p) return out;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= p; i++) {
    const d = src[i] - src[i - 1];
    if (d >= 0) ag += d;
    else al -= d;
  }
  ag /= p;
  al /= p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p;
    al = (al * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export interface Pivot {
  i: number;
  p: number;
}

export function findPivots(high: number[], low: number[], length: number): { lows: Pivot[]; highs: Pivot[] } {
  const L = Math.max(2, Math.round(length));
  const n = high.length;
  const lows: Pivot[] = [];
  const highs: Pivot[] = [];
  for (let i = L; i < n - L; i++) {
    let isLow = true;
    let isHigh = true;
    for (let j = i - L; j <= i + L; j++) {
      if (low[j] < low[i]) isLow = false;
      if (high[j] > high[i]) isHigh = false;
      if (!isLow && !isHigh) break;
    }
    if (isLow) lows.push({ i, p: low[i] });
    if (isHigh) highs.push({ i, p: high[i] });
  }
  return { lows, highs };
}

function varianceFrom(s: number[], off: number): number {
  let m = 0;
  let m2 = 0;
  let cnt = 0;
  for (let i = off; i < s.length; i++) {
    m += s[i];
    m2 += s[i] * s[i];
    cnt++;
  }
  if (cnt === 0) return 1;
  m /= cnt;
  return Math.max(m2 / cnt - m * m, 1e-12);
}

// ------------------------------------------------------------
// Метод Такенса: delay-embedding лог-цены (лаг tau, размерность m),
// PCA степенной итерацией, затем РАСШИРЕННЫЙ ФИЛЬТР КАЛМАНА:
// состояние [уровень, скорость], нелинейное наблюдение
// h(x) = x0 + 0.1*tanh(x1), якобиан H = [1, 0.1*(1-tanh^2)].
// На выходе — z-score скорости (Такенс-импульс).
// ------------------------------------------------------------
export function takensMomentum(close: number[], tau: number, m: number, q: number): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(0);
  const tauR = Math.max(1, Math.round(tau));
  const mR = Math.max(2, Math.round(m));
  const off = (mR - 1) * tauR;
  if (n < off + 60) return out;

  const logp = close.map((v) => Math.log(Math.max(v, 1e-12)));

  // --- embedding (сэмплируем до 1200 векторов для PCA) ---
  const step = Math.max(1, Math.floor((n - off) / 1200));
  const rows: number[][] = [];
  for (let i = off; i < n; i += step) {
    const row = new Array<number>(mR);
    for (let k = 0; k < mR; k++) row[k] = logp[i - k * tauR];
    rows.push(row);
  }
  const mean = new Array<number>(mR).fill(0);
  const std = new Array<number>(mR).fill(0);
  for (const r of rows) for (let k = 0; k < mR; k++) mean[k] += r[k];
  for (let k = 0; k < mR; k++) mean[k] /= rows.length;
  for (const r of rows) for (let k = 0; k < mR; k++) std[k] += (r[k] - mean[k]) ** 2;
  for (let k = 0; k < mR; k++) std[k] = Math.sqrt(std[k] / rows.length) + 1e-12;

  // --- ковариация + степенная итерация ---
  const C: number[][] = Array.from({ length: mR }, () => new Array<number>(mR).fill(0));
  for (const r of rows) {
    const z = r.map((v, k) => (v - mean[k]) / std[k]);
    for (let a = 0; a < mR; a++) for (let b = 0; b < mR; b++) C[a][b] += z[a] * z[b];
  }
  for (let a = 0; a < mR; a++) for (let b = 0; b < mR; b++) C[a][b] /= rows.length;
  let w = new Array<number>(mR).fill(1 / Math.sqrt(mR));
  for (let it = 0; it < 60; it++) {
    const nw = new Array<number>(mR).fill(0);
    for (let a = 0; a < mR; a++) for (let b = 0; b < mR; b++) nw[a] += C[a][b] * w[b];
    const norm = Math.sqrt(nw.reduce((s, v) => s + v * v, 0)) + 1e-12;
    w = nw.map((v) => v / norm);
  }
  if (w[0] < 0) w = w.map((v) => -v);

  // --- проекция ряда на главную компоненту ---
  const s = new Array<number>(n).fill(0);
  for (let t = off; t < n; t++) {
    let acc = 0;
    for (let k = 0; k < mR; k++) acc += w[k] * ((logp[t - k * tauR] - mean[k]) / std[k]);
    s[t] = acc;
  }

  // --- расширенный фильтр Калмана ---
  const varS = varianceFrom(s, off);
  const Q = Math.max(1e-9, q) * varS;
  const R = 0.5 * varS;
  let x0 = s[off];
  let x1 = 0;
  let p00 = varS;
  let p01 = 0;
  let p10 = 0;
  let p11 = varS;
  const vel = new Array<number>(n).fill(0);
  for (let t = off; t < n; t++) {
    // predict: x' = F*x, F = [[1,1],[0,1]]
    x0 = x0 + x1;
    p00 = p00 + p01 + p10 + p11 + Q;
    p01 = p01 + p11;
    p10 = p10 + p11;
    p11 = p11 + Q;
    // update: h(x) = x0 + 0.1*tanh(x1), H = [1, 0.1*(1-tanh^2)]
    const th = Math.tanh(x1);
    const h = x0 + 0.1 * th;
    const h1 = 0.1 * (1 - th * th);
    const yv = s[t] - h;
    const S = p00 + h1 * (p01 + p10) + h1 * h1 * p11 + R;
    const k0 = (p00 + p01 * h1) / S;
    const k1 = (p10 + p11 * h1) / S;
    x0 += k0 * yv;
    x1 += k1 * yv;
    const n00 = p00 - k0 * (p00 + p10 * h1);
    const n01 = p01 - k0 * (p01 + p11 * h1);
    const n10 = p10 - k1 * (p00 + p10 * h1);
    const n11 = p11 - k1 * (p01 + p11 * h1);
    p00 = n00;
    p01 = n01;
    p10 = n10;
    p11 = n11;
    vel[t] = x1;
  }

  // --- нормировка: скользящий z-score скорости ---
  const a = 0.02;
  let mm = vel[off];
  let m2 = vel[off] * vel[off];
  for (let t = off; t < n; t++) {
    mm += a * (vel[t] - mm);
    m2 += a * (vel[t] * vel[t] - m2);
    const sd = Math.sqrt(Math.max(m2 - mm * mm, 1e-12));
    out[t] = t > off + 30 ? (vel[t] - mm) / sd : 0;
  }
  return out;
}

// ------------------------------------------------------------
// Дивергенции RSI: бычья — цена ниже, RSI выше (по свинг-лоям),
// медвежья — зеркально. Флаг живёт lookback баров после
// подтверждения свинга (confirmLag = плечо свинга)
// ------------------------------------------------------------
export function divergenceFlags(
  pivots: Pivot[],
  rsi: number[],
  lookback: number,
  n: number,
  kind: "bull" | "bear",
  confirmLag: number
): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 1; i < pivots.length; i++) {
    const p1 = pivots[i - 1];
    const p2 = pivots[i];
    let cond: boolean;
    if (kind === "bull") {
      cond = p2.p < p1.p && rsi[p2.i] > rsi[p1.i] && rsi[p2.i] < 56;
    } else {
      cond = p2.p > p1.p && rsi[p2.i] < rsi[p1.i] && rsi[p2.i] > 44;
    }
    if (cond) {
      const start = p2.i + confirmLag;
      const end = Math.min(n, start + Math.round(lookback));
      for (let t = start; t < end; t++) out[t] = 1;
    }
  }
  return out;
}

// ------------------------------------------------------------
// Фибо-зоны ретрейсмента: для long — зона между уровнями
// fibLo..fibHi коррекции восходящего плеча (L->H), активируется
// после подтверждения вершины H, живёт life баров
// ------------------------------------------------------------
interface FibLeg {
  start: number;
  end: number;
  lo: number;
  hi: number;
}

export function fibZones(
  highs: Pivot[],
  lows: Pivot[],
  fibLo: number,
  fibHi: number,
  life: number,
  confirmLag: number,
  n: number,
  kind: "long" | "short"
): { lo: number[]; hi: number[] } {
  const zoneLo = new Array<number>(n).fill(NaN);
  const zoneHi = new Array<number>(n).fill(NaN);
  const legs: FibLeg[] = [];

  if (kind === "long") {
    for (const H of highs) {
      let L: Pivot | null = null;
      for (const p of lows) {
        if (p.i < H.i) L = p;
        else break;
      }
      if (!L) continue;
      const range = H.p - L.p;
      if (range <= 0 || range / L.p < 0.008) continue;
      legs.push({
        start: H.i + confirmLag,
        end: H.i + confirmLag + life,
        lo: H.p - fibHi * range,
        hi: H.p - fibLo * range,
      });
    }
  } else {
    for (const L of lows) {
      let H: Pivot | null = null;
      for (const p of highs) {
        if (p.i < L.i) H = p;
        else break;
      }
      if (!H) continue;
      const range = H.p - L.p;
      if (range <= 0 || range / L.p < 0.008) continue;
      legs.push({
        start: L.i + confirmLag,
        end: L.i + confirmLag + life,
        lo: L.p + fibLo * range,
        hi: L.p + fibHi * range,
      });
    }
  }

  legs.sort((a, b) => a.start - b.start);
  let j = 0;
  let cur: FibLeg | null = null;
  for (let t = 0; t < n; t++) {
    while (j < legs.length && legs[j].start <= t) {
      cur = legs[j];
      j++;
    }
    if (cur && t < cur.end) {
      zoneLo[t] = cur.lo;
      zoneHi[t] = cur.hi;
    }
  }
  return { lo: zoneLo, hi: zoneHi };
}
