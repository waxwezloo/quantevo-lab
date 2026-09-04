// ============================================================
// QuantEvo Lab — генетический алгоритм
// Гены: числовые (в т.ч. лог-шкала для Q), турнирный отбор,
// BLX-кроссовер, гауссова мутация в нормированном пространстве, элитизм
// ============================================================

import type { Candle } from "./indicators";
import type { Genome, StratCfg, Metrics, BacktestResult, GAWeights } from "./backtest";
import { GENES, decodeGenome, runBacktest, fitness } from "./backtest";
import { mulberry32 } from "./data";

export interface GAConfig {
  pop: number;
  gens: number;
  mutRate: number;
  elite: number;
  tournament: number;
  seed: number;
  weights: GAWeights;
}

export const DEFAULT_GA: GAConfig = {
  pop: 48,
  gens: 30,
  mutRate: 0.18,
  elite: 4,
  tournament: 3,
  seed: 42,
  weights: { sharpe: 1.0, pf: 0.8, ret: 0.6, dd: 1.2 },
};

export interface GenInfo {
  gen: number;
  best: number;
  avg: number;
}

export interface PopRow {
  genome: Genome;
  fit: number;
  metrics: Metrics;
}

export interface EvolveCallbacks {
  onGen: (info: GenInfo, top: PopRow[]) => void;
  onLog: (msg: string, kind?: "info" | "ok" | "warn") => void;
  isStopped: () => boolean;
  yielder: () => Promise<void>;
}

export interface EvolveOutcome {
  best: PopRow;
  result: BacktestResult;
  history: GenInfo[];
  gensDone: number;
  evals: number;
}

function geneToU(v: number, i: number): number {
  const d = GENES[i];
  if (d.log) {
    const lo = Math.log(d.min);
    const hi = Math.log(d.max);
    return (Math.log(Math.max(v, d.min)) - lo) / (hi - lo);
  }
  return (v - d.min) / (d.max - d.min);
}

function geneFromU(u: number, i: number): number {
  const d = GENES[i];
  const cu = Math.min(1, Math.max(0, u));
  let v: number;
  if (d.log) {
    const lo = Math.log(d.min);
    const hi = Math.log(d.max);
    v = Math.exp(lo + cu * (hi - lo));
  } else {
    v = d.min + cu * (d.max - d.min);
  }
  return d.int ? Math.round(v) : v;
}

export function randomGenome(rng: () => number): Genome {
  return GENES.map((_, i) => geneFromU(rng(), i));
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function crossover(a: Genome, b: Genome, rng: () => number): Genome {
  const child = new Array<number>(GENES.length);
  for (let i = 0; i < GENES.length; i++) {
    if (rng() < 0.5) {
      child[i] = a[i];
    } else if (rng() < 0.65) {
      // BLX-blend в нормированном пространстве
      const ua = geneToU(a[i], i);
      const ub = geneToU(b[i], i);
      const lo = Math.min(ua, ub);
      const hi = Math.max(ua, ub);
      const span = Math.max(hi - lo, 0.02);
      child[i] = geneFromU(lo - 0.15 * span + rng() * (span * 1.3), i);
    } else {
      child[i] = b[i];
    }
  }
  return child;
}

function mutate(g: Genome, rate: number, rng: () => number): Genome {
  for (let i = 0; i < g.length; i++) {
    if (rng() < rate) {
      const u = geneToU(g[i], i) + gauss(rng) * 0.22;
      g[i] = geneFromU(u, i);
    }
  }
  return g;
}

function tournament(rows: PopRow[], k: number, rng: () => number): PopRow {
  let best: PopRow | null = null;
  for (let i = 0; i < k; i++) {
    const r = rows[Math.floor(rng() * rows.length)];
    if (!best || r.fit > best.fit) best = r;
  }
  return best as PopRow;
}

export async function evolve(
  candles: Candle[],
  tfMinutes: number,
  strat: StratCfg,
  ga: GAConfig,
  cb: EvolveCallbacks
): Promise<EvolveOutcome | null> {
  const rng = mulberry32(ga.seed);
  let pop: Genome[] = Array.from({ length: ga.pop }, () => randomGenome(rng));
  const history: GenInfo[] = [];
  let bestEver: PopRow | null = null;
  let evals = 0;
  let gensDone = 0;

  for (let g = 0; g < ga.gens; g++) {
    const rows: PopRow[] = [];
    for (let i = 0; i < pop.length; i++) {
      if (cb.isStopped()) {
        cb.onLog("Эволюция остановлена оператором", "warn");
        return bestEver
          ? { best: bestEver, result: finalResult(candles, tfMinutes, strat, bestEver), history, gensDone, evals }
          : null;
      }
      const genome = pop[i];
      const res = runBacktest(candles, tfMinutes, decodeGenome(genome), strat);
      const fit = fitness(res.metrics, ga.weights, strat.minTrades);
      rows.push({ genome, fit, metrics: res.metrics });
      evals++;
      if (i % 5 === 4) await cb.yielder();
    }
    rows.sort((x, y) => y.fit - x.fit);
    if (!bestEver || rows[0].fit > bestEver.fit) bestEver = rows[0];
    const avg = rows.reduce((s, r) => s + r.fit, 0) / rows.length;
    const info: GenInfo = { gen: g + 1, best: rows[0].fit, avg };
    history.push(info);
    gensDone = g + 1;
    cb.onGen(info, rows.slice(0, 12));

    // селекция + размножение
    const next: Genome[] = [];
    const elite = Math.min(ga.elite, rows.length - 1);
    for (let i = 0; i < elite; i++) next.push(rows[i].genome.slice());
    while (next.length < ga.pop) {
      const a = tournament(rows, ga.tournament, rng);
      const b = tournament(rows, ga.tournament, rng);
      next.push(mutate(crossover(a.genome, b.genome, rng), ga.mutRate, rng));
    }
    pop = next;
  }

  const result = finalResult(candles, tfMinutes, strat, bestEver as PopRow);
  return { best: bestEver as PopRow, result, history, gensDone, evals };
}

function finalResult(
  candles: Candle[],
  tfMinutes: number,
  strat: StratCfg,
  row: PopRow
): BacktestResult {
  return runBacktest(candles, tfMinutes, decodeGenome(row.genome), strat);
}
