import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PriceChart from "./PriceChart";
import { Panel, Seg, SliderField, Toggle, Led, IconPlay, IconStop, fmtPct } from "./ui";
import { TradingEngine, testConnection, type TradingCfg, type TradeRec } from "../lib/trading";
import type { Params, StratCfg, Trade } from "../lib/backtest";
import { fmtPrice } from "../lib/backtest";
import { PAIRS, TIMEFRAMES } from "../lib/data";
import type { Candle } from "../lib/indicators";

interface Props {
  pair: string;
  tf: number;
  onPair: (s: string) => void;
  onTf: (v: number) => void;
  strat: StratCfg;
  manual: Params;
  bestParams: Params | null;
}

function timeToIdx(candles: Candle[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

function EquitySpark({ deposit, trades, equity }: { deposit: number; trades: TradeRec[]; equity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    const h = 84;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const pts = [deposit];
    let acc = deposit;
    for (const t of trades) {
      acc += t.pnl;
      pts.push(acc);
    }
    pts.push(equity);
    let yMin = Math.min(...pts);
    let yMax = Math.max(...pts);
    const pad = (yMax - yMin) * 0.15 || deposit * 0.01 || 1;
    yMin -= pad;
    yMax += pad;
    const xI = (i: number) => 4 + (i / Math.max(pts.length - 1, 1)) * (w - 8);
    const yV = (v: number) => 6 + (1 - (v - yMin) / (yMax - yMin)) * (h - 12);
    // базовая линия депозита
    ctx.strokeStyle = "rgba(94,115,152,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(4, yV(deposit));
    ctx.lineTo(w - 4, yV(deposit));
    ctx.stroke();
    ctx.setLineDash([]);
    // кривая
    const up = pts[pts.length - 1] >= deposit;
    ctx.strokeStyle = up ? "#3fdc9b" : "#f65c7a";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    pts.forEach((v, i) => {
      if (i === 0) ctx.moveTo(xI(i), yV(v));
      else ctx.lineTo(xI(i), yV(v));
    });
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.lineTo(xI(pts.length - 1), h - 4);
    ctx.lineTo(xI(0), h - 4);
    ctx.closePath();
    ctx.fillStyle = up ? "rgba(63,220,155,0.10)" : "rgba(246,92,122,0.10)";
    ctx.fill();
    // точка
    ctx.fillStyle = up ? "#3fdc9b" : "#f65c7a";
    ctx.beginPath();
    ctx.arc(xI(pts.length - 1), yV(pts[pts.length - 1]), 3, 0, Math.PI * 2);
    ctx.fill();
  }, [deposit, trades, equity]);
  return (
    <div ref={wrapRef} className="w-full">
      <canvas ref={ref} />
    </div>
  );
}

export default function TradingTab({ pair, tf, onPair, onTf, strat, manual, bestParams }: Props) {
  const [deposit, setDeposit] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);
  const [pollSec, setPollSec] = useState(20);
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [testnet, setTestnet] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [source, setSource] = useState<"manual" | "best">("manual");
  const [testing, setTesting] = useState(false);
  const [conn, setConn] = useState<{ ok: boolean; msg: string } | null>(null);

  const srcParams: Params = source === "best" && bestParams ? bestParams : manual;

  const makeCfg = (): TradingCfg => ({
    pair,
    tf,
    category: strat.mode,
    leverage: strat.leverage,
    deposit,
    riskPct,
    pollMs: pollSec * 1000,
    mode,
    testnet,
    apiKey,
    apiSecret,
    params: srcParams,
    allowShort: strat.allowShort,
    trendFilter: strat.trendFilter,
    feePct: strat.feePct,
    slipPct: strat.slipPct,
  });

  const [engine, setEngine] = useState<TradingEngine>(() => new TradingEngine(makeCfg()));
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  // синхронизация настроек с движком
  useEffect(() => {
    engine.updateCfg(makeCfg());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, pair, tf, deposit, riskPct, pollSec, mode, testnet, apiKey, apiSecret, source, bestParams, manual, strat]);

  // смена пары/таймфрейма — перезапуск движка
  useEffect(() => {
    return () => {
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  useEffect(() => {
    engine.stop();
    setEngine(new TradingEngine(makeCfg()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, tf]);

  const onTest = async () => {
    setTesting(true);
    setConn(null);
    try {
      const r = await testConnection(makeCfg());
      setConn({ ok: r.ok, msg: r.balance !== null ? `${r.msg} · ${r.balance.toFixed(2)} USDT` : r.msg });
    } catch (e) {
      setConn({ ok: false, msg: e instanceof Error ? e.message : "Сеть недоступна" });
    } finally {
      setTesting(false);
    }
  };

  const pos = snap.position;
  const upnl = pos ? pos.side * (snap.lastPrice - pos.entryP) * pos.qty : 0;
  const upnlPct = pos ? (upnl / Math.max(snap.equity, 1)) * 100 * (strat.mode === "linear" ? strat.leverage : 1) : 0;
  const totalPnl = snap.trades.reduce((s, t) => s + t.pnl, 0);
  const wins = snap.trades.filter((t) => t.pnl > 0).length;
  const rrSetup = srcParams.tpPct / Math.max(srcParams.slPct, 1e-9);

  const chartTrades: Trade[] = snap.trades.map((t) => ({
    dir: t.side,
    entryI: timeToIdx(snap.candles, t.openTime),
    exitI: timeToIdx(snap.candles, t.closeTime),
    entryP: t.entryP,
    exitP: t.exitP,
    pnlPct: t.pnlPct,
    reason: t.reason,
  }));

  const levels = pos
    ? { entry: pos.entryP, sl: pos.sl, tp: pos.tp, side: pos.side }
    : null;

  const tfLabel = TIMEFRAMES.find((t) => t.min === tf)?.label ?? "";
  const liveBlocked = mode === "live" && (!apiKey || !apiSecret);

  return (
    <div className="max-w-[1660px] mx-auto px-4 pb-6">
      {/* ---------- статусная строка ---------- */}
      <div className="qe-panel px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 reveal">
        <div className="flex items-center gap-2.5">
          <Led
            color={snap.running ? (mode === "live" ? "#f65c7a" : "#3fdc9b") : "#5e7398"}
            pulse={snap.running}
          />
          <span className="qe-num text-[11px] tracking-[0.18em] text-mut">
            {snap.running ? (mode === "live" ? "LIVE-ТОРГОВЛЯ" : "PAPER-ТОРГОВЛЯ") : "ДВИЖОК ОСТАНОВЛЕН"}
          </span>
          {mode === "live" && testnet ? (
            <span className="qe-num text-[9.5px] tracking-[0.1em] text-amber2 border border-amber/40 rounded px-1.5 py-0.5">TESTNET</span>
          ) : null}
          {mode === "live" && !testnet ? (
            <span className="qe-num text-[9.5px] tracking-[0.1em] text-red border border-red/50 rounded px-1.5 py-0.5 pulse-dot">MAINNET</span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <select className="qe-input cursor-pointer" value={pair} disabled={snap.running} onChange={(e) => onPair(e.target.value)}>
            {PAIRS.map((s) => (
              <option key={s} value={s} className="bg-panel">{s}</option>
            ))}
          </select>
          <select className="qe-input cursor-pointer" value={tf} disabled={snap.running} onChange={(e) => onTf(Number(e.target.value))}>
            {TIMEFRAMES.map((t) => (
              <option key={t.min} value={t.min} className="bg-panel">{t.label}</option>
            ))}
          </select>
          <span className="qe-num text-[10px] text-dim">{strat.mode === "linear" ? `PERP ×${strat.leverage}` : "SPOT"}</span>
        </div>

        <div className="flex items-baseline gap-3 ml-auto">
          <div className="qe-num text-[10px] text-dim tracking-[0.15em]">ПОСЛЕДНЯЯ ЦЕНА</div>
          <div className="font-disp text-[20px] font-bold text-ink leading-none">
            {snap.lastPrice > 0 ? fmtPrice(snap.lastPrice) : "—"}
          </div>
          <div className="qe-num text-[11px] text-dim">
            {snap.lastPoll > 0 ? new Date(snap.lastPoll).toLocaleTimeString("ru-RU", { hour12: false }) : "нет данных"}
          </div>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px] items-start mt-3">
        {/* ---------- левая колонка: настройки ---------- */}
        <div className="flex flex-col gap-3 reveal" style={{ animationDelay: "40ms" }}>
          <Panel title="Счёт и API-доступ" tick={mode === "live" ? "red" : "teal"}>
            <div className="p-3.5 flex flex-col gap-3">
              <div>
                <span className="block text-[12px] text-mut mb-1.5">Режим исполнения</span>
                <Seg
                  options={[
                    { v: "paper", label: "PAPER" },
                    { v: "live", label: "LIVE" },
                  ]}
                  value={mode}
                  onChange={setMode}
                  disabled={snap.running}
                />
              </div>
              <Toggle
                label="Bybit Testnet"
                hint="песочница api-testnet.bybit.com"
                checked={testnet}
                onChange={setTestnet}
                disabled={snap.running}
              />
              <label className="block">
                <span className="block text-[10.5px] text-dim mb-1">API Key</span>
                <input
                  className="qe-input w-full"
                  placeholder={mode === "paper" ? "не требуется для paper" : "ключ Bybit V5"}
                  value={apiKey}
                  disabled={snap.running}
                  onChange={(e) => setApiKey(e.target.value.trim())}
                  autoComplete="off"
                />
              </label>
              <label className="block">
                <span className="block text-[10.5px] text-dim mb-1">API Secret</span>
                <input
                  type="password"
                  className="qe-input w-full"
                  placeholder="секрет (HMAC-подпись локально)"
                  value={apiSecret}
                  disabled={snap.running}
                  onChange={(e) => setApiSecret(e.target.value.trim())}
                  autoComplete="off"
                />
              </label>
              <button type="button" className="btn-ghost px-3 py-2 text-[11.5px] qe-num font-semibold" onClick={onTest} disabled={testing}>
                {testing ? "ПРОВЕРКА…" : "ПРОВЕРИТЬ СОЕДИНЕНИЕ / БАЛАНС"}
              </button>
              {conn ? (
                <div className={`qe-num text-[10.5px] leading-relaxed ${conn.ok ? "text-green" : "text-red"}`}>
                  {conn.ok ? "✓ " : "✗ "}{conn.msg}
                </div>
              ) : (
                <p className="text-[10px] leading-relaxed text-dim">
                  Ключи не покидают браузер: подпись запросов выполняется локально (Web Crypto). Для ключей с
                  правом торговли используйте отдельный subaccount.
                </p>
              )}
              <label className="block">
                <span className="block text-[10.5px] text-dim mb-1">Начальный депозит, USDT</span>
                <input
                  type="number"
                  className="qe-input w-full"
                  min={10}
                  step={100}
                  value={deposit}
                  disabled={snap.running}
                  onChange={(e) => setDeposit(Math.max(10, Number(e.target.value) || 10))}
                />
              </label>
              <SliderField
                label="Риск на сделку"
                value={riskPct}
                min={0.1}
                max={5}
                step={0.1}
                disabled={snap.running}
                fmt={(v) => `${v.toFixed(1)}%`}
                onChange={setRiskPct}
              />
              <SliderField
                label="Интервал опроса рынка"
                value={pollSec}
                min={10}
                max={120}
                step={5}
                disabled={snap.running}
                fmt={(v) => `${v} с`}
                onChange={setPollSec}
              />
            </div>
          </Panel>

          <Panel title="Параметры стратегии">
            <div className="p-3.5 flex flex-col gap-3">
              <div>
                <span className="block text-[12px] text-mut mb-1.5">Источник генома</span>
                <Seg
                  options={[
                    { v: "manual", label: "ФИКС. ГЕНОМ" },
                    { v: "best", label: bestParams ? "ЛУЧШИЙ GA" : "GA (нет)" },
                  ]}
                  value={source}
                  onChange={(v) => setSource(v === "best" && !bestParams ? "manual" : v)}
                  disabled={snap.running}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 qe-num text-[11px]">
                <div className="bg-bg1/70 border border-line rounded-md px-2 py-1.5">
                  <div className="text-[9px] text-dim tracking-[0.1em]">TP / SL</div>
                  <div className="font-bold text-ink">
                    <span className="text-green">{srcParams.tpPct.toFixed(1)}</span>
                    <span className="text-dim">/</span>
                    <span className="text-red">{srcParams.slPct.toFixed(1)}</span>
                  </div>
                </div>
                <div className="bg-bg1/70 border border-line rounded-md px-2 py-1.5">
                  <div className="text-[9px] text-dim tracking-[0.1em]">R/R СЕТАП</div>
                  <div className="font-bold text-amber2">1:{rrSetup.toFixed(2)}</div>
                </div>
                <div className="bg-bg1/70 border border-line rounded-md px-2 py-1.5">
                  <div className="text-[9px] text-dim tracking-[0.1em]">RSI</div>
                  <div className="font-bold text-ink">{srcParams.rsiPeriod}</div>
                </div>
              </div>
              <p className="text-[10px] leading-relaxed text-dim">
                Вход — по закрытому бару (без репаинта), SL/TP контролируются каждый опрос; на перпетуале
                дополнительно выставляются серверные условные ордера.
              </p>
            </div>
          </Panel>

          <div className="qe-panel p-3.5 flex flex-col gap-2.5">
            {!snap.running ? (
              <button
                type="button"
                className="btn-run w-full py-3 text-[13px] tracking-wide flex items-center justify-center gap-2"
                onClick={() => engine.start()}
                disabled={liveBlocked}
              >
                <IconPlay />
                {mode === "live" ? "ЗАПУСТИТЬ LIVE-ТОРГОВЛЮ" : "ЗАПУСТИТЬ ДВИЖОК"}
              </button>
            ) : (
              <button type="button" className="btn-stop w-full py-3 text-[13px] qe-num font-bold flex items-center justify-center gap-2" onClick={() => engine.stop()}>
                <IconStop />
                ОСТАНОВИТЬ
              </button>
            )}
            {liveBlocked ? (
              <p className="qe-num text-[10px] text-red leading-relaxed">LIVE-режим требует API Key и Secret.</p>
            ) : null}
            <button type="button" className="btn-ghost px-3 py-2 text-[11px] qe-num font-semibold" onClick={() => engine.resetEquity()} disabled={snap.running}>
              СБРОСИТЬ БАЛАНС К ДЕПОЗИТУ
            </button>
          </div>
        </div>

        {/* ---------- центр: график ---------- */}
        <div className="flex flex-col gap-3 min-w-0">
          <Panel
            title={`Рынок · ${pair} ${tfLabel} · SL/TP`}
            className="reveal"
            style={{ animationDelay: "90ms" }}
            right={
              pos ? (
                <span className={`qe-num text-[10px] font-bold px-2 py-0.5 rounded border ${pos.side === 1 ? "text-green border-green/50" : "text-red border-red/50"}`}>
                  {pos.side === 1 ? "▲ LONG" : "▼ SHORT"} ×{pos.qty.toFixed(4)}
                </span>
              ) : (
                <span className="qe-num text-[10px] text-dim">позиция не открыта</span>
              )
            }
          >
            <div className="h-[430px]">
              {snap.candles.length > 0 ? (
                <PriceChart
                  candles={snap.candles}
                  emaF={snap.emaF}
                  emaS={snap.emaS}
                  rsi={snap.rsi}
                  rsiLow={srcParams.rsiLow}
                  rsiHigh={srcParams.rsiHigh}
                  trades={chartTrades}
                  loading={false}
                  levels={levels}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
                  <svg width="46" height="46" viewBox="0 0 46 46" fill="none" aria-hidden>
                    <rect x="1" y="1" width="44" height="44" rx="10" stroke="#2a3d66" />
                    <path d="M10 30l7-8 6 5 9-12" stroke="#f2b33d" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M27 15h5v5" stroke="#3bc9c4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div>
                    <div className="qe-num text-[12px] text-mut tracking-[0.14em]">ДАННЫЕ ПОЯВЯТСЯ ПОСЛЕ ЗАПУСКА ДВИЖКА</div>
                    <p className="text-[11px] text-dim mt-1.5 leading-relaxed max-w-[340px]">
                      Движок опрашивает Bybit V5 каждые {pollSec} с, строит сигналы FibDiv и следит за SL/TP
                      в реальном времени{mode === "live" ? ", выставляя рыночные ордера" : " (виртуальный счёт)"}.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 reveal" style={{ animationDelay: "140ms" }}>
            <MiniStat label="Эквити" value={`$${snap.equity.toFixed(2)}`} tone={snap.equity >= deposit ? "green" : "red"} />
            <MiniStat
              label={mode === "live" ? "Баланс биржи" : "Свободно"}
              value={mode === "live" && snap.liveBalance !== null ? `$${snap.liveBalance.toFixed(2)}` : `$${(snap.equity - (pos ? pos.margin : 0)).toFixed(2)}`}
              tone="ink"
            />
            <MiniStat label="Открытый PnL" value={pos ? `${upnl >= 0 ? "+" : ""}${upnl.toFixed(2)}` : "—"} tone={upnl >= 0 ? "green" : "red"} sub={pos ? fmtPct(upnlPct) : undefined} />
            <MiniStat label="Сделок" value={String(snap.trades.length)} tone="amber" sub={`${wins} прибыльных`} />
            <MiniStat label="Реализовано" value={`${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}`} tone={totalPnl >= 0 ? "green" : "red"} sub="USDT net" />
            <MiniStat label="Опросов" value={String(snap.polls)} tone="mut" sub={snap.error ? "ошибка!" : "шт"} />
          </div>

          {snap.error ? (
            <div className="qe-panel border-red/50 px-4 py-2.5 qe-num text-[11px] text-red reveal">
              ⚠ {snap.error} — движок продолжит попытки. Проверьте сеть/CORS или переключите пару.
            </div>
          ) : null}
        </div>

        {/* ---------- правая колонка ---------- */}
        <div className="flex flex-col gap-3 reveal" style={{ animationDelay: "120ms" }}>
          <Panel
            title="Открытая позиция"
            tick={pos ? (pos.side === 1 ? "green" : "red") : ""}
            right={
              pos ? (
                <button
                  type="button"
                  className="qe-num text-[9.5px] tracking-[0.06em] text-red border border-red/50 rounded px-1.5 py-0.5 hover:bg-red/10 transition-colors whitespace-nowrap"
                  onClick={() => engine.closePositionManual()}
                >
                  ЗАКРЫТЬ {mode === "live" ? "(ОРДЕР)" : ""}
                </button>
              ) : undefined
            }
          >
            {pos ? (
              <div className="p-3.5 flex flex-col gap-2 qe-num text-[11.5px]">
                <PosRow label="Направление" value={pos.side === 1 ? "LONG ▲" : "SHORT ▼"} tone={pos.side === 1 ? "text-green" : "text-red"} />
                <PosRow label="Вход" value={fmtPrice(pos.entryP)} />
                <PosRow label="Текущая" value={fmtPrice(snap.lastPrice)} />
                <PosRow label="Stop-Loss" value={fmtPrice(pos.sl)} tone="text-red" sub={`${(((pos.side === 1 ? pos.entryP - pos.sl : pos.sl - pos.entryP) / pos.entryP) * 100).toFixed(2)}% от входа`} />
                <PosRow label="Take-Profit" value={fmtPrice(pos.tp)} tone="text-green" sub={`${(((pos.side === 1 ? pos.tp - pos.entryP : pos.entryP - pos.tp) / pos.entryP) * 100).toFixed(2)}% от входа`} />
                <PosRow label="Количество" value={pos.qty.toFixed(5)} sub={`нотациал $${pos.notional.toFixed(0)} · маржа $${pos.margin.toFixed(0)}`} />
                <div className="mt-1 pt-2 border-t border-line flex items-center justify-between">
                  <span className="text-dim text-[10px] tracking-[0.1em]">НЕРЕАЛИЗОВАННЫЙ PNL</span>
                  <span className={`text-[15px] font-bold ${upnl >= 0 ? "text-green" : "text-red"}`}>
                    {upnl >= 0 ? "+" : ""}{upnl.toFixed(2)} $
                  </span>
                </div>
                {/* прогресс к TP/SL */}
                <div>
                  <div className="flex justify-between text-[9.5px] text-dim mb-1">
                    <span>SL</span>
                    <span>движение цены</span>
                    <span>TP</span>
                  </div>
                  <div className="relative h-2 rounded bg-bg1 border border-line overflow-hidden">
                    <div
                      className={`absolute top-0 bottom-0 left-0 ${upnl >= 0 ? "bg-green/60" : "bg-red/60"}`}
                      style={{ width: `${Math.min(100, Math.max(0, progressToTp(pos, snap.lastPrice)))}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="px-4 py-7 text-center qe-num text-[11px] text-dim">
                {snap.running ? "Ждём сигнал FibDiv на закрытом баре…" : "Запустите движок — позиция появится по сигналу"}
              </div>
            )}
          </Panel>

          <Panel title="Капитал" tick="teal">
            <div className="p-3.5">
              <div className="flex items-baseline justify-between mb-2">
                <span className="qe-num text-[10px] text-dim tracking-[0.12em]">ДЕПОЗИТ ${deposit.toLocaleString("en-US")}</span>
                <span className={`qe-num text-[13px] font-bold ${snap.equity >= deposit ? "text-green" : "text-red"}`}>
                  {fmtPct(((snap.equity - deposit) / deposit) * 100)}
                </span>
              </div>
              <EquitySpark deposit={deposit} trades={snap.trades} equity={snap.equity} />
            </div>
          </Panel>

          <Panel title="Журнал сделок" tick="green">
            <div className="max-h-[220px] overflow-y-auto">
              {snap.trades.length === 0 ? (
                <div className="px-4 py-6 text-center qe-num text-[11px] text-dim">Сделок пока нет</div>
              ) : (
                <table className="w-full text-[10.5px] qe-num">
                  <thead>
                    <tr className="text-dim text-[9.5px] uppercase tracking-[0.08em] border-b border-line">
                      <th className="text-left font-medium px-3 py-1.5">Время</th>
                      <th className="text-left font-medium px-1 py-1.5">Сторона</th>
                      <th className="text-right font-medium px-1 py-1.5">Выход</th>
                      <th className="text-right font-medium px-3 py-1.5">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...snap.trades].reverse().map((t, i) => (
                      <tr key={i} className="border-b border-line/40 row-hover">
                        <td className="px-3 py-1.5 text-dim">{new Date(t.closeTime).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                        <td className={`px-1 py-1.5 font-bold ${t.side === 1 ? "text-green" : "text-red"}`}>
                          {t.side === 1 ? "L" : "S"}·{t.reason}
                        </td>
                        <td className="px-1 py-1.5 text-right text-mut">{fmtPrice(t.exitP)}</td>
                        <td className={`px-3 py-1.5 text-right font-bold ${t.pnl >= 0 ? "text-green" : "text-red"}`}>
                          {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>

          <Panel title="Журнал движка" className="flex-1">
            <div className="h-[200px] overflow-y-auto px-3 py-2 qe-num text-[10.5px] leading-[1.8]">
              {snap.log.length === 0 ? (
                <div className="text-dim">ожидание событий…</div>
              ) : (
                snap.log.map((l, i) => (
                  <div key={i} className="log-line flex gap-2">
                    <span className="text-dim flex-none">{new Date(l.t).toLocaleTimeString("ru-RU", { hour12: false })}</span>
                    <span className={l.kind === "ok" ? "text-green" : l.kind === "warn" ? "text-amber2" : l.kind === "err" ? "text-red" : "text-teal"}>
                      {l.kind === "ok" ? "+" : l.kind === "warn" ? "!" : l.kind === "err" ? "×" : ">"}
                    </span>
                    <span className="text-mut">{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>

      <p className="qe-num text-[10px] text-dim mt-3 leading-relaxed">
        Сигналы строятся по тем же правилам, что и бэктест (Такенс+EKF → FibDiv → RSI → EMA), вход — на закрытом баре.
        {mode === "live"
          ? " LIVE: рыночные ордера исполняются на бирже — начните с Testnet и минимальных объёмов."
          : " Paper-режим не отправляет ордеры: сделки виртуальные, на реальных котировках."}{" "}
        Не является инвестиционной рекомендацией.
      </p>
    </div>
  );
}

function progressToTp(pos: { side: 1 | -1; entryP: number; sl: number; tp: number }, price: number): number {
  if (pos.side === 1) {
    const span = pos.tp - pos.sl;
    return ((price - pos.sl) / span) * 100;
  }
  const span = pos.sl - pos.tp;
  return ((pos.sl - price) / span) * 100;
}

function MiniStat({ label, value, tone, sub }: { label: string; value: string; tone: "green" | "red" | "ink" | "amber" | "mut"; sub?: string }) {
  const cls = { green: "text-green", red: "text-red", ink: "text-ink", amber: "text-amber2", mut: "text-mut" }[tone];
  return (
    <div className="qe-panel px-3 py-2.5">
      <div className="text-[9.5px] uppercase tracking-[0.12em] text-dim">{label}</div>
      <div className={`qe-num text-[15px] font-bold ${cls}`}>{value}</div>
      {sub ? <div className="qe-num text-[9.5px] text-dim">{sub}</div> : null}
    </div>
  );
}

function PosRow({ label, value, tone = "text-ink", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dim text-[10px] tracking-[0.08em] uppercase">{label}</span>
      <span className="text-right">
        <span className={`font-bold ${tone}`}>{value}</span>
        {sub ? <span className="block text-[9.5px] text-dim">{sub}</span> : null}
      </span>
    </div>
  );
}
