import type { GAConfig } from "../lib/ga";
import type { StratCfg, Params, GeneDef } from "../lib/backtest";
import { GENES } from "../lib/backtest";
import { PAIRS, TIMEFRAMES, type DataSource } from "../lib/data";
import { Panel, SliderField, Toggle, Seg, Led, IconPlay, IconStop, IconDice } from "./ui";

export interface DataState {
  loading: boolean;
  source: DataSource | null;
  count: number;
}

interface Props {
  pair: string;
  tf: number;
  onPair: (s: string) => void;
  onTf: (v: number) => void;
  data: DataState;
  onReload: () => void;
  ga: GAConfig;
  onGa: (patch: Partial<GAConfig>) => void;
  strat: StratCfg;
  onStrat: (patch: Partial<StratCfg>) => void;
  manual: Params;
  onManual: (patch: Partial<Params>) => void;
  onRunManual: () => void;
  running: boolean;
  progress: { gen: number; total: number } | null;
  onRun: () => void;
  onStop: () => void;
}

// Лог-слайдер для генов с логарифмической шкалой (Калман Q)
function LogSlider({
  def,
  value,
  disabled,
  onChange,
}: {
  def: GeneDef;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const ratio = def.max / def.min;
  const u = Math.log(Math.max(value, def.min) / def.min) / Math.log(ratio);
  const ui = Math.round(Math.min(1, Math.max(0, u)) * 1000);
  return (
    <label className="block col-span-2">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12px] text-mut">{def.label}</span>
        <span className="qe-num text-[12px] font-semibold text-teal">{value.toExponential(1)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={5}
        value={ui}
        disabled={disabled}
        style={{ ["--fill" as string]: `${(ui / 1000) * 100}%` }}
        onChange={(e) => onChange(def.min * Math.pow(ratio, Number(e.target.value) / 1000))}
      />
    </label>
  );
}

export default function ControlPanel(p: Props) {
  const { ga, strat } = p;
  const busy = p.running || p.data.loading;
  const pct = p.progress && p.progress.total > 0 ? (p.progress.gen / p.progress.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* ---- РЫНОК ---- */}
      <Panel
        title="Рынок и данные"
        right={
          p.data.source ? (
            <span className="flex items-center gap-1.5 qe-num text-[10px]">
              <Led color={p.data.source === "bybit" ? "#3fdc9b" : "#f2b33d"} pulse={p.data.loading} />
              <span className={p.data.source === "bybit" ? "text-green" : "text-amber2"}>
                {p.data.loading ? "…" : p.data.source === "bybit" ? "BYBIT API" : "СИНТЕТИКА"}
              </span>
            </span>
          ) : (
            <Led color="#5e7398" />
          )
        }
      >
        <div className="p-3.5 flex flex-col gap-3">
          <label className="block">
            <span className="block text-[12px] text-mut mb-1.5">Торговая пара</span>
            <div className="relative">
              <select
                className="qe-input w-full appearance-none pr-8 cursor-pointer"
                value={p.pair}
                disabled={busy}
                onChange={(e) => p.onPair(e.target.value)}
              >
                {PAIRS.map((s) => (
                  <option key={s} value={s} className="bg-panel">
                    {s.replace("USDT", "")} / USDT · spot
                  </option>
                ))}
              </select>
              <svg
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"
                width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </div>
          </label>

          <div>
            <span className="block text-[12px] text-mut mb-1.5">Таймфрейм</span>
            <Seg
              options={TIMEFRAMES.map((t) => ({ v: t.min, label: t.label }))}
              value={p.tf}
              onChange={p.onTf}
              disabled={busy}
            />
          </div>

          <div className="flex items-center justify-between qe-num text-[10.5px] text-dim">
            <span>Глубина: 365 дней</span>
            <span>{p.data.count > 0 ? `${p.data.count.toLocaleString("en-US")} свечей` : "нет данных"}</span>
          </div>

          <button type="button" className="btn-ghost px-3 py-2 text-[12px] qe-num font-semibold flex items-center justify-center gap-2" onClick={p.onReload} disabled={busy}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" />
            </svg>
            Перезагрузить данные
          </button>
        </div>
      </Panel>

      {/* ---- ГЕНЕТИЧЕСКИЙ АЛГОРИТМ ---- */}
      <Panel title="Генетический алгоритм" tick="teal">
        <div className="p-3.5 flex flex-col gap-3.5">
          <SliderField label="Размер популяции" value={ga.pop} min={20} max={120} step={4} disabled={p.running}
            onChange={(v) => p.onGa({ pop: v })} />
          <SliderField label="Поколений" value={ga.gens} min={10} max={80} step={5} disabled={p.running}
            onChange={(v) => p.onGa({ gens: v })} />
          <SliderField label="Мутация" value={ga.mutRate} min={0.02} max={0.5} step={0.02} disabled={p.running}
            fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => p.onGa({ mutRate: v })} />
          <div className="grid grid-cols-2 gap-3">
            <SliderField label="Элитизм" value={ga.elite} min={1} max={10} step={1} disabled={p.running}
              onChange={(v) => p.onGa({ elite: v })} />
            <SliderField label="Турнир" value={ga.tournament} min={2} max={6} step={1} disabled={p.running}
              onChange={(v) => p.onGa({ tournament: v })} />
          </div>
          <div>
            <span className="block text-[12px] text-mut mb-1.5">Сид случайности</span>
            <div className="flex gap-2">
              <input
                type="number"
                className="qe-input w-full"
                value={ga.seed}
                min={1}
                max={999999}
                disabled={p.running}
                onChange={(e) => p.onGa({ seed: Math.max(1, Math.min(999999, Number(e.target.value) || 1)) })}
              />
              <button
                type="button"
                title="Случайный сид"
                className="btn-ghost px-2.5 flex items-center"
                disabled={p.running}
                onClick={() => p.onGa({ seed: 1 + Math.floor(Math.random() * 99998) })}
              >
                <IconDice />
              </button>
            </div>
          </div>
        </div>
      </Panel>

      {/* ---- ВЕСА ФИТНЕСА ---- */}
      <Panel title="Веса фитнес-функции" tick="green">
        <div className="p-3.5 flex flex-col gap-3.5">
          <SliderField label="Sharpe" value={ga.weights.sharpe} min={0} max={3} step={0.1} disabled={p.running}
            fmt={(v) => v.toFixed(1)} onChange={(v) => p.onGa({ weights: { ...ga.weights, sharpe: v } })} />
          <SliderField label="Profit Factor" value={ga.weights.pf} min={0} max={3} step={0.1} disabled={p.running}
            fmt={(v) => v.toFixed(1)} onChange={(v) => p.onGa({ weights: { ...ga.weights, pf: v } })} />
          <SliderField label="Доходность" value={ga.weights.ret} min={0} max={3} step={0.1} disabled={p.running}
            fmt={(v) => v.toFixed(1)} onChange={(v) => p.onGa({ weights: { ...ga.weights, ret: v } })} />
          <SliderField label="Штраф за просадку" value={ga.weights.dd} min={0} max={3} step={0.1} disabled={p.running}
            fmt={(v) => v.toFixed(1)} onChange={(v) => p.onGa({ weights: { ...ga.weights, dd: v } })} />
        </div>
      </Panel>

      {/* ---- СТРАТЕГИЯ ---- */}
      <Panel title="Стратегия FibDiv">
        <div className="p-3.5 flex flex-col gap-2">
          <Toggle label="Разрешить шорт-сигналы" hint="медвежьи дивергенции в зоне" checked={strat.allowShort} disabled={p.running}
            onChange={(v) => p.onStrat({ allowShort: v })} />
          <Toggle label="Трендовый фильтр EMA" hint="long только над EMA медленной" checked={strat.trendFilter} disabled={p.running}
            onChange={(v) => p.onStrat({ trendFilter: v })} />
          <div className="grid grid-cols-3 gap-2 mt-1">
            <label className="block">
              <span className="block text-[10.5px] text-dim mb-1">Комиссия %</span>
              <input type="number" step="0.005" min="0" max="0.5" className="qe-input w-full" value={strat.feePct} disabled={p.running}
                onChange={(e) => p.onStrat({ feePct: Number(e.target.value) || 0 })} />
            </label>
            <label className="block">
              <span className="block text-[10.5px] text-dim mb-1">Слиппедж %</span>
              <input type="number" step="0.01" min="0" max="0.5" className="qe-input w-full" value={strat.slipPct} disabled={p.running}
                onChange={(e) => p.onStrat({ slipPct: Number(e.target.value) || 0 })} />
            </label>
            <label className="block">
              <span className="block text-[10.5px] text-dim mb-1">Мин. сделок</span>
              <input type="number" step="1" min="1" max="100" className="qe-input w-full" value={strat.minTrades} disabled={p.running}
                onChange={(e) => p.onStrat({ minTrades: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </div>
        </div>
      </Panel>

      {/* ---- ФИКСИРОВАННЫЙ ГЕНОМ ---- */}
      <Panel title="Фиксированный геном · ручной бэктест" tick="teal">
        <div className="p-3.5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {GENES.map((d) =>
              d.log ? (
                <LogSlider
                  key={d.key}
                  def={d}
                  value={p.manual[d.key]}
                  disabled={p.running}
                  onChange={(v) => p.onManual({ [d.key]: v })}
                />
              ) : (
                <SliderField
                  key={d.key}
                  label={d.label}
                  value={p.manual[d.key]}
                  min={d.min}
                  max={d.max}
                  step={d.int ? 1 : 0.01}
                  disabled={p.running}
                  fmt={(v) => (d.int ? String(Math.round(v)) : v.toFixed(2))}
                  onChange={(v) => p.onManual({ [d.key]: v })}
                />
              )
            )}
          </div>
          <button
            type="button"
            className="w-full py-2.5 rounded-lg border border-teal/50 text-teal text-[12px] qe-num font-bold tracking-wide flex items-center justify-center gap-2 transition-all duration-150 hover:bg-teal/10 hover:border-teal hover:-translate-y-px disabled:opacity-45 disabled:cursor-not-allowed"
            onClick={p.onRunManual}
            disabled={p.running || p.data.loading || p.data.count === 0}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 12.5 6 8l2.5 2.5L13.5 4" />
              <path d="M10 4h3.5v3.5" />
            </svg>
            БЭКТЕСТ С ЭТИМИ ПАРАМЕТРАМИ
          </button>
          <p className="text-[10px] leading-relaxed text-dim">
            Мгновенный прогон без эволюции — удобно проверять гипотезы. GA ищет optimum по всем 15 генам одновременно.
          </p>
        </div>
      </Panel>

      {/* ---- ЗАПУСК ---- */}
      <div className="qe-panel p-3.5 flex flex-col gap-3">
        {!p.running ? (
          <button
            type="button"
            className="btn-run w-full py-3 text-[13px] tracking-wide flex items-center justify-center gap-2"
            onClick={p.onRun}
            disabled={p.data.loading || p.data.count === 0}
          >
            <IconPlay />
            ЗАПУСТИТЬ ЭВОЛЮЦИЮ
          </button>
        ) : (
          <button type="button" className="btn-stop w-full py-3 text-[13px] qe-num font-bold flex items-center justify-center gap-2" onClick={p.onStop}>
            <IconStop />
            ОСТАНОВИТЬ
          </button>
        )}
        {p.running && p.progress ? (
          <div>
            <div className="flex justify-between qe-num text-[10.5px] text-mut mb-1">
              <span>Поколение {p.progress.gen} / {p.progress.total}</span>
              <span className="text-amber2">{pct.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded bg-bg1 border border-line overflow-hidden">
              <div className="stripes h-full bg-amber transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
        <p className="text-[10.5px] leading-relaxed text-dim">
          Геном — 15 генов: RSI, EMA, Такенс (τ, m), Калман Q, Фибо-зона, дивергенции, TP/SL. Отбор — турнир, кроссовер BLX-α, элитизм.
        </p>
      </div>
    </div>
  );
}
