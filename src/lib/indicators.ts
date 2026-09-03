// ============================================================
// QuantEvo Lab — индикаторный слой
// RSI (Wilder), EMA, метод Такенса (delay-embedding + PCA),
// расширенный фильтр Калмана, свинги, Фибо-зоны, дивергенции
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
  const n = src.length;
  const out = new Array<number>(n);
  const k = 2 / (Math.max(1, period) + 1);
  let prev = n > 0 ? src[0] : 0;
  for (let i = 0; i < n; i++) {
    prev = i === 0 ? src[i] : src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsiWilder(close: number[], period: number): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(50);
  if (n <= period + 1) return out;
  let ag = 0;
  let al = 0;
  for (let i = 1; i <= period; i++) {
    const d = close[i] - close[i - 1];
    if (d >= 0) ag += d;
    else al -= d;
  }
  ag /= period;
  al /= period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < n; i++) {
    const d = close[i] - close[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

export interface Pivot {
  i: number;
  p: number;
}

// Фрактальные экстремумы: len баров слева и справа
export function findPivots(
  high: number[],
  low: number[],
  len: number
): { lows: Pivot[]; highs: Pivot[] } {
  const lows: Pivot[] = [];
  const highs: Pivot[] = [];
  const L = Math.max(2, Math.round(len));
  for (let i = L; i < high.length - L; i++) {
    let isL = true;
    let isH = true;
    for (let j = 1; j <= L; j++) {
      if (low[i] > low[i - j] || low[i] > low[i + j]) isL = false;
      if (high[i] < high[i - j] || high[i] < high[i + j]) isH = false;
      if (!isL && !isH) break;
    }
    if (isL) lows.push({ i, p: low[i] });
    if (isH) highs.push({ i, p: high[i] });
  }
  return { lows, highs };
}

function varianceFrom(arr: number[], from: number): number {
  let m = 0;
  let c = 0;
  for (let i = from; i < arr.length; i++) {
    m += arr[i];
    c++;
  }
  if (c === 0) return 1;
  m /= c;
  let v = 0;
  for (let i = from; i < arr.length; i++) v += (arr[i] - m) * (arr[i] - m);
  return v / c + 1e-12;
}

// ------------------------------------------------------------
// Метод Такенса: реконструкция фазового пространства
// V_t = (x_t, x_{t-τ}, ..., x_{t-(m-1)τ}), x = ln(close)
// Проекция на первую главную компоненту (степенная итерация),
// затем расширенный фильтр Калмана (состояние [уровень, скорость],
// нелинейное наблюдение h(x) = x0 + 0.1·tanh(x1), якобиан аналитически)
// Возвращает z-score скорости — «Такенс-импульс»
// ------------------------------------------------------------
export function takensMomentum(
  close: number[],
  delay: number,
  dim: number,
  q: number
): number[] {
  const n = close.length;
  const out = new Array<number>(n).fill(0);
  const tau = Math.max(1, Math.round(delay));
  const m = Math.max(2, Math.round(dim));
  const off = (m - 1) * tau;
  if (n < off + 60) return out;

  const logp = new Array<number>(n);
  for (let i = 0; i < n; i++) logp[i] = Math.log(close[i]);

  // --- обучающая выборка для PCA ---
  const step = Math.max(1, Math.floor((n - off) / 1200));
  const mean = new Array<number>(m).fill(0);
  let cnt = 0;
  for (let t = off; t < n; t += step) {
    for (let k = 0; k < m; k++) mean[k] += logp[t - k * tau];
    cnt++;
  }
  for (let k = 0; k < m; k++) mean[k] /= cnt;
  const std = new Array<number>(m).fill(0);
  for (let t = off; t < n; t += step) {
    for (let k = 0; k < m; k++) {
      const d = logp[t - k * tau] - mean[k];
      std[k] += d * d;
    }
  }
  for (let k = 0; k < m; k++) std[k] = Math.sqrt(std[k] / cnt) + 1e-12;

  // --- ковариация + степенная итерация ---
  const C: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let t = off; t < n; t += step) {
    for (let a = 0; a < m; a++) {
      const za = (logp[t - a * tau] - mean[a]) / std[a];
      for (let b = 0; b < m; b++) {
        const zb = (logp[t - b * tau] - mean[b]) / std[b];
        C[a][b] += (za * zb) / cnt;
      }
    }
  }
  let w = new Array<number>(m).fill(1 / Math.sqrt(m));
  for (let it = 0; it < 60; it++) {
    const nw = new Array<number>(m).fill(0);
    for (let a = 0; a < m; a++) {
      let s = 0;
      for (let b = 0; b < m; b++) s += C[a][b] * w[b];
      nw[a] = s;
    }
    let norm = 0;
    for (let a = 0; a < m; a++) norm += nw[a] * nw[a];
    norm = Math.sqrt(norm) + 1e-12;
    for (let a = 0; a < m; a++) w[a] = nw[a] / norm;
  }
  if (w[0] < 0) for (let a = 0; a < m; a++) w[a] = -w[a];

  // --- проекция ряда на главную компоненту ---
  const s = new Array<number>(n).fill(0);
  for (let t = off; t < n; t++) {
    let acc = 0;
    for (let k = 0; k < m; k++) acc += w[k] * ((logp[t - k * tau] - mean[k]) / std[k]);
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
    // predict: x' = F·x, F = [[1,1],[0,1]]
    x0 = x0 + x1;
    p00 = p00 + p01 + p10 + p11 + Q;
    p01 = p01 + p11;
    p10 = p10 + p11;
    p11 = p11 + Q;
    // update: h(x) = x0 + 0.1·tanh(x1), H = [1, 0.1·(1−tanh²)]
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
// fibLo..fibHi коррекции восходящего плеча (L→H), активируется
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
