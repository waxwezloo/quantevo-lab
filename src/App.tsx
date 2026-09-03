import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TickerTape from "./components/TickerTape";
import ControlPanel, { type DataState } from "./components/ControlPanel";
import PriceChart from "./components/PriceChart";
import EquityChart from "./components/EquityChart";
import FitnessChart from "./components/FitnessChart";
import PopulationTable from "./components/PopulationTable";
import CodePanel from "./components/CodePanel";
import { Panel, Stat, Led, IconHelix, IconFlask, IconCode, fmtPct, fmtNum } from "./components/ui";
import { loadKlines, TIMEFRAMES } from "./lib/data";
import type { Candle } from "./lib/indicators";
import { ema, rsiWilder } from "./lib/indicators";
import type { StratCfg, BacktestResult, Params } from "./lib/backtest";
import { runBacktest, decodeGenome, fmtPrice, defaultParams, sanitizeParams } from "./lib/backtest";
import { DEFAULT_GA, evolve, type GAConfig, type GenInfo, type PopRow } from "./lib/ga";

interface LogLine {
  id: number;
  time: string;
  msg: string;
  kind: "info" | "ok" | "warn";
}

let logId = 0;

export default function App() {
  const [tab, setTab] = useState<"lab" | "code">("lab");
  const [pair, setPair] = useState("BTCUSDT");
  const [tf, setTf] = useState(60);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataState, setDataState] = useState<DataState>({ loading: true, source: null, count: 0 });

  const [ga, setGa] = useState<GAConfig>(DEFAULT_GA);
  const [strat, setStrat] = useState<StratCfg>({
    allowShort: true,
    trendFilter: true,
    feePct: 0.055,
    slipPct: 0.03,
    minTrades: 8,
  });

  const [manual, setManual] = useState<Params>(() => defaultParams());
  const [manualResult, setManualResult] = useState<BacktestResult | null>(null);
  const [baseline, setBaseline] = useState<BacktestResult | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ gen: number; total: number } | null>(null);
  const [history, setHistory] = useState<GenInfo[]>([]);
  const [popRows, setPopRows] = useState<PopRow[]>([]);
  const [best, setBest] = useState<{ row: PopRow; result: BacktestResult } | null>(null);
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [previewResult, setPreviewResult] = useState<BacktestResult | null>(null);

  const [log, setLog] = useState<LogLine[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const stopRef = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);

  const pushLog = useCallback((msg: string, kind: LogLine["kind"] = "info") => {
    setLog((prev) =>
      [...prev, { id: ++logId, time: new Date().toLocaleTimeString("ru-RU", { hour12: false }), msg, kind }].slice(-60)
    );
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const tfLabel = TIMEFRAMES.find((t) => t.min === tf)?.label ?? "1Ч";

  // ---------- загрузка данных ----------
  useEffect(() => {
    let cancelled = false;
    setDataState((s) => ({ ...s, loading: true, count: 0 }));
    setBest(null);
    setHistory([]);
    setPopRows([]);
    setPreviewIdx(-1);
    setPreviewResult(null);
    pushLog(`Загрузка ${pair} · ${tfLabel} · 365 дней…`);
    loadKlines(pair, tf, 365).then(({ candles: cs, source }) => {
      if (cancelled) return;
      setCandles(cs);
      setDataState({ loading: false, source, count: cs.length });
      if (source === "bybit") pushLog(`Bybit API: получено ${cs.length.toLocaleString("en-US")} свечей`, "ok");
      else pushLog(`API недоступен из браузера — синтетические данные, ${cs.length.toLocaleString("en-US")} свечей`, "warn");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, tf, reloadKey]);

  // ---------- индикаторы для отображения ----------
  const view = useMemo(() => {
    if (candles.length === 0) return null;
    const close = candles.map((c) => c.c);
    return { emaF: ema(close, 21), emaS: ema(close, 100), rsi: rsiWilder(close, 14) };
  }, [candles]);

  const bench = useMemo(() => {
    if (candles.length < 2) return null;
    const c0 = candles[0].c;
    return candles.map((c) => (10000 * c.c) / c0);
  }, [candles]);

  const times = useMemo(() => candles.map((c) => c.t), [candles]);

  // ---------- базовый бэктест (геном по умолчанию, сразу после загрузки) ----------
  useEffect(() => {
    if (candles.length === 0) {
      setBaseline(null);
      return;
    }
    const t0 = performance.now();
    const res = runBacktest(candles, tf, defaultParams(), strat);
    setBaseline(res);
    setManualResult(null);
    pushLog(
      `Базовый бэктест (геном по умолчанию): ${res.metrics.trades} сделок, доход ${fmtPct(res.metrics.returnPct)} · ${Math.round(performance.now() - t0)} мс`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, tf]);

  // ---------- ручной бэктест с фиксированным геномом ----------
  const runManual = useCallback(() => {
    if (running || candles.length === 0) return;
    const res = runBacktest(candles, tf, sanitizeParams(manual), strat);
    setManualResult(res);
    setBest(null);
    setHistory([]);
    setPopRows([]);
    setPreviewIdx(-1);
    setPreviewResult(null);
    pushLog(
      `Ручной бэктест: ${res.metrics.trades} сделок, доход ${fmtPct(res.metrics.returnPct)}, Sharpe ${fmtNum(res.metrics.sharpe)}`,
      res.metrics.returnPct >= 0 ? "ok" : "warn"
    );
  }, [running, candles, tf, manual, strat, pushLog]);

  // ---------- эволюция ----------
  const runEvolution = useCallback(async () => {
    if (running || candles.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setHistory([]);
    setPopRows([]);
    setPreviewIdx(-1);
    setPreviewResult(null);
    setBest(null);
    setProgress({ gen: 0, total: ga.gens });
    pushLog(
      `Эволюция: ${pair} ${tfLabel}, популяция ${ga.pop}, поколений ${ga.gens}, сид ${ga.seed}, мутация ${(ga.mutRate * 100).toFixed(0)}%`
    );
    const t0 = performance.now();
    const outcome = await evolve(candles, tf, strat, ga, {
      onGen: (info, top) => {
        setHistory((h) => [...h, info]);
        setPopRows(top);
        setProgress({ gen: info.gen, total: ga.gens });
        if (info.gen === 1 || info.gen % 5 === 0) {
          pushLog(`Поколение ${info.gen}: best ${info.best.toFixed(2)} · avg ${info.avg.toFixed(2)}`);
        }
      },
      onLog: (m, k) => pushLog(m, k ?? "info"),
      isStopped: () => stopRef.current,
      yielder: () => new Promise((r) => setTimeout(r, 0)),
    });
    setRunning(false);
    setProgress(null);
    if (outcome) {
      setBest({ row: outcome.best, result: outcome.result });
      const m = outcome.result.metrics;
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      pushLog(
        `Готово за ${secs} с · ${outcome.evals} бэктестов · фитнес ${outcome.best.fit.toFixed(2)}`,
        "ok"
      );
      pushLog(
        `Лучший: доход ${fmtPct(m.returnPct)}, Sharpe ${fmtNum(m.sharpe)}, MaxDD ${fmtPct(-m.maxDD * 100, false)}, ${m.trades} сделок, win ${fmtNum(m.winRate, 0)}%`,
        m.returnPct >= 0 ? "ok" : "warn"
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, candles, tf, strat, ga, pair, tfLabel, pushLog]);

  const onPreview = useCallback(
    (i: number) => {
      if (previewIdx === i) {
        setPreviewIdx(-1);
        setPreviewResult(null);
        return;
      }
      const row = popRows[i];
      if (!row || candles.length === 0) return;
      const res = runBacktest(candles, tf, decodeGenome(row.genome), strat);
      setPreviewResult(res);
      setPreviewIdx(i);
      pushLog(`Предпросмотр особи #${i + 1}: доход ${fmtPct(res.metrics.returnPct)}, сделок ${res.metrics.trades}`);
    },
    [previewIdx, popRows, candles, tf, strat, pushLog]
  );

  const shown = previewResult ?? best?.result ?? manualResult ?? baseline ?? null;
  const shownFit = previewIdx >= 0 ? popRows[previewIdx]?.fit : best?.row.fit;
  const shownSource =
    previewIdx >= 0
      ? `ОСОБЬ #${previewIdx + 1}`
      : best
        ? "GA · ЛУЧШИЙ ГЕНОМ"
        : manualResult
          ? "ФИКС. ПАРАМЕТРЫ"
          : "БАЗОВЫЙ";
  const m = shown?.metrics;

  const lastC = candles.length ? candles[candles.length - 1].c : null;
  const yearPct = candles.length > 1 ? (candles[candles.length - 1].c / candles[0].c - 1) * 100 : 0;

  return (
    <div className="min-h-screen relative font-body text-ink">
      {/* ambient background */}
      <div className="qe-bg">
        <div className="qe-grid" />
        <div className="qe-glow qe-glow-a" />
        <div className="qe-glow qe-glow-b" />
        <div className="qe-noise" />
      </div>

      <div className="relative z-10">
        {/* ---------- header ---------- */}
        <header className="px-4 pt-4 pb-3 max-w-[1660px] mx-auto flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-3">
            <IconHelix size={38} />
            <div>
              <h1 className="font-disp text-[17px] font-bold tracking-[0.06em] leading-none">
                QUANT<span className="text-amber">EVO</span>
              </h1>
              <p className="qe-num text-[10px] text-dim tracking-[0.22em] mt-1">ГЕНЕТИЧЕСКАЯ ЛАБОРАТОРИЯ · BYBIT</p>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 ml-auto">
            {lastC !== null ? (
              <div className="qe-num text-right">
                <div className="text-[10px] text-dim tracking-[0.15em]">
                  {pair} · {tfLabel}
                </div>
                <div className="text-[15px] font-bold text-ink leading-tight">
                  {fmtPrice(lastC)}{" "}
                  <span className={`text-[11px] font-semibold ${yearPct >= 0 ? "text-green" : "text-red"}`}>
                    {fmtPct(yearPct)} / год
                  </span>
                </div>
              </div>
            ) : null}
            <div className="flex items-center gap-2 border border-line rounded-lg px-3 py-2 bg-bg1/60">
              <Led
                color={dataState.loading ? "#3bc9c4" : dataState.source === "bybit" ? "#3fdc9b" : "#f2b33d"}
                pulse={dataState.loading}
              />
              <span className="qe-num text-[10.5px] text-mut">
                {dataState.loading ? "ПОДКЛЮЧЕНИЕ…" : dataState.source === "bybit" ? "BYBIT V5 · LIVE DATA" : "СИНТЕТИЧЕСКИЙ РЕЖИМ"}
              </span>
            </div>
          </div>
        </header>

        <TickerTape active={pair} onSelect={(s) => setPair(s)} />

        {/* ---------- tabs ---------- */}
        <nav className="max-w-[1660px] mx-auto px-4 mt-3 flex items-center gap-1.5">
          {(
            [
              { k: "lab", label: "Лаборатория", icon: <IconFlask /> },
              { k: "code", label: "Python-код", icon: <IconCode /> },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className={`relative flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-[13px] font-semibold transition-all duration-200 ${
                tab === t.k ? "text-amber2 bg-panel border border-b-0 border-line" : "text-dim hover:text-mut border border-transparent"
              }`}
            >
              {t.icon}
              {t.label}
              {tab === t.k ? <span className="absolute left-3 right-3 -bottom-px h-px bg-panel" /> : null}
            </button>
          ))}
          <span className="ml-auto qe-num hidden sm:block text-[10.5px] text-dim">
            Такенс + EKF · FibDiv · RSI · EMA · бэктест 365 дней
          </span>
        </nav>

        {/* ---------- content ---------- */}
        {tab === "lab" ? (
          <main key="lab" className="max-w-[1660px] mx-auto px-4 pb-6 reveal">
            <div className="grid gap-3 grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)] xl:grid-cols-[290px_minmax(0,1fr)_308px] items-start">
              <div className="reveal" style={{ animationDelay: "40ms" }}>
                <ControlPanel
                  pair={pair}
                  tf={tf}
                  onPair={setPair}
                  onTf={setTf}
                  data={dataState}
                  onReload={() => setReloadKey((k) => k + 1)}
                  ga={ga}
                  onGa={(patch) => setGa((g) => ({ ...g, ...patch }))}
                  strat={strat}
                  onStrat={(patch) => setStrat((s) => ({ ...s, ...patch }))}
                  manual={manual}
                  onManual={(patch) => setManual((mm) => ({ ...mm, ...patch }) as Params)}
                  onRunManual={runManual}
                  running={running}
                  progress={progress}
                  onRun={runEvolution}
                  onStop={() => {
                    stopRef.current = true;
                  }}
                />
              </div>

              <div className="flex flex-col gap-3 min-w-0">
                <Panel
                  title={`Цена и сигналы · ${pair} ${tfLabel}`}
                  className="reveal"
                  style={{ animationDelay: "90ms" }}
                  right={
                    <span className="qe-num text-[10px] text-dim flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-amber inline-block" />EMA 21</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-teal inline-block" />EMA 100</span>
                      <span className="flex items-center gap-1"><span className="w-0 h-0 inline-block border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-green" />вход</span>
                      <span className="text-red font-bold">× выход</span>
                    </span>
                  }
                >
                  <div className="h-[420px]">
                    <PriceChart
                      candles={candles}
                      emaF={view?.emaF ?? []}
                      emaS={view?.emaS ?? []}
                      rsi={view?.rsi ?? []}
                      rsiLow={30}
                      rsiHigh={70}
                      trades={shown?.trades ?? []}
                      loading={dataState.loading}
                    />
                  </div>
                </Panel>

                <Panel
                  title="Кривая капитала · бэктест 365 дней"
                  tick="teal"
                  className="reveal"
                  style={{ animationDelay: "140ms" }}
                  right={
                    <span className="qe-num text-[10px] text-dim flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-amber inline-block" />стратегия</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-0.5 bg-dim inline-block" />buy&hold</span>
                    </span>
                  }
                >
                  <div className="h-[252px]">
                    <EquityChart equity={shown?.equity ?? null} bench={bench} times={times} loading={running && !shown} />
                  </div>
                </Panel>

                <Panel
                  title={previewIdx >= 0 ? `Популяция · предпросмотр особи #${previewIdx + 1}` : "Популяция · топ-12"}
                  tick="green"
                  className="reveal"
                  style={{ animationDelay: "190ms" }}
                  right={
                    <span className="qe-num text-[10px] text-dim">клик по строке — кривая капитала особи</span>
                  }
                >
                  <PopulationTable rows={popRows} activeIdx={previewIdx} onPreview={onPreview} previewMode={previewIdx >= 0} />
                </Panel>
              </div>

              <div className="flex flex-col gap-3 lg:col-span-2 xl:col-span-1">
                <Panel
                  title="Метрики бэктеста"
                  className="reveal"
                  style={{ animationDelay: "120ms" }}
                  right={
                    <span className="qe-num text-[9.5px] tracking-[0.08em] text-teal border border-teal/40 rounded px-1.5 py-0.5 whitespace-nowrap">
                      {shownSource}
                    </span>
                  }
                >
                  <div className="p-3 grid grid-cols-2 gap-2">
                    <Stat label="Доходность" value={m ? fmtPct(m.returnPct) : "—"} tone={m ? (m.returnPct >= 0 ? "green" : "red") : "mut"} sub={m ? `CAGR ${fmtPct(m.cagr)}` : "нет результата"} />
                    <Stat label="Sharpe" value={m ? fmtNum(m.sharpe) : "—"} tone={m && m.sharpe >= 1 ? "green" : "ink"} sub={m ? `Sortino ${fmtNum(m.sortino)}` : undefined} />
                    <Stat label="Max Drawdown" value={m ? fmtPct(-m.maxDD * 100, false) : "—"} tone={m ? (m.maxDD > 0.35 ? "red" : "amber") : "mut"} sub="пик → впадина" />
                    <Stat label="Win rate" value={m ? `${fmtNum(m.winRate, 0)}%` : "—"} tone="ink" sub={m ? `ср. сделка ${fmtPct(m.avgPct)}` : undefined} />
                    <Stat label="Profit factor" value={m ? fmtNum(m.pf) : "—"} tone={m && m.pf >= 1.3 ? "green" : "ink"} sub="прибыль / убыток" />
                    <Stat label="Сделок" value={m ? String(m.trades) : "—"} tone="amber" sub={m ? `экспозиция ${(m.exposure * 100).toFixed(0)}%` : undefined} />
                    <Stat label="Фитнес" value={shownFit !== undefined && shownFit !== null ? fmtNum(shownFit) : "—"} tone="amber" sub={previewIdx >= 0 ? `особь #${previewIdx + 1}` : "лучший геном"} />
                    <Stat label="Капитал" value={m ? `$${(10000 * (1 + m.returnPct / 100)).toFixed(0)}` : "—"} tone="ink" sub="со стартовых $10 000" />
                  </div>
                </Panel>

                <Panel title="Эволюция фитнеса" tick="teal" className="reveal" style={{ animationDelay: "160ms" }}>
                  <div className="h-[190px]">
                    <FitnessChart history={history} running={running} />
                  </div>
                </Panel>

                <Panel title="Журнал терминала" tick="green" className="reveal flex-1" style={{ animationDelay: "200ms" }}>
                  <div ref={logRef} className="h-[210px] overflow-y-auto px-3 py-2 qe-num text-[10.5px] leading-[1.8]">
                    {log.length === 0 ? (
                      <div className="text-dim">ожидание событий…</div>
                    ) : (
                      log.map((l) => (
                        <div key={l.id} className="log-line flex gap-2">
                          <span className="text-dim flex-none">{l.time}</span>
                          <span className={l.kind === "ok" ? "text-green" : l.kind === "warn" ? "text-amber2" : "text-teal"}>
                            {l.kind === "ok" ? "+" : l.kind === "warn" ? "!" : ">"}
                          </span>
                          <span className="text-mut">{l.msg}</span>
                        </div>
                      ))
                    )}
                  </div>
                </Panel>
              </div>
            </div>
          </main>
        ) : (
          <main key="code" className="reveal">
            <CodePanel />
          </main>
        )}

        {/* ---------- footer ---------- */}
        <footer className="border-t border-line/70 bg-bg0/70">
          <div className="max-w-[1660px] mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-1 qe-num text-[10px] text-dim">
            <span>QuantEvo Lab · метод Такенса (delay-embedding) + расширенный фильтр Калмана</span>
            <span className="hidden md:inline">FibDiv: зоны 0.382–0.618 + RSI-дивергенции · EMA-фильтр тренда</span>
            <span className="ml-auto text-dim/80">Не является инвестиционной рекомендацией. Бэктест ≠ гарантия доходности.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
