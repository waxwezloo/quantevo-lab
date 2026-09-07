import { useEffect, useMemo, useRef, useState } from "react";
import type { Leader } from "../lib/leaders";
import { leaderRR, fmtDur, fmtDateTime, tfLabel, marketLabel } from "../lib/leaders";
import { GENES } from "../lib/backtest";
import { Panel, Led, IconHelix, IconDownload, fmtPct, fmtNum } from "./ui";

type SortKey = "date" | "return" | "winRate" | "maxDD" | "trades" | "rr" | "fitness" | "liveMs" | "liveProfit";
type MarketFilter = "all" | "spot" | "linear";

const SORT_LABELS: Record<SortKey, string> = {
  date: "Дате эволюции",
  return: "Доходу",
  winRate: "Винрейту",
  maxDD: "Макс. просадке",
  trades: "Кол-ву сделок",
  rr: "Риск/награде",
  fitness: "Фитнесу",
  liveMs: "Времени в live",
  liveProfit: "Live-профиту",
};

interface Props {
  leaders: Leader[];
  tradingMarket: "spot" | "linear";
  tradingRunning: boolean;
  onDelete: (ids: string[]) => void;
  onDeploy: (l: Leader, switchMarket: boolean) => void;
  onImportLeaders: (f: File) => void;
}

export default function LeaderboardTab({
  leaders,
  tradingMarket,
  tradingRunning,
  onDelete,
  onDeploy,
  onImportLeaders,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [desc, setDesc] = useState(true);
  const [marketFilter, setMarketFilter] = useState<MarketFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string[] | null>(null);
  const [deploying, setDeploying] = useState<Leader | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // тик для длительности live-сессий
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    let list = leaders;
    if (marketFilter !== "all") list = list.filter((l) => l.market === marketFilter);
    const val = (l: Leader): number => {
      switch (sortKey) {
        case "return": return l.metrics.returnPct;
        case "winRate": return l.metrics.winRate;
        case "maxDD": return l.metrics.maxDD;
        case "trades": return l.metrics.trades;
        case "rr": { const r = leaderRR(l); return Number.isFinite(r) ? r : 1e9; }
        case "fitness": return l.fitness;
        case "liveMs": return l.liveMs + (l.active && l.liveStartedAt ? now - l.liveStartedAt : 0);
        case "liveProfit": return l.liveProfit;
        default: return l.createdAt;
      }
    };
    return [...list].sort((a, b) => (desc ? val(b) - val(a) : val(a) - val(b)));
  }, [leaders, marketFilter, sortKey, desc, now]);

  const ranked = useMemo(() => {
    const byFit = [...leaders].sort((a, b) => b.fitness - a.fitness);
    return new Map(byFit.map((l, i) => [l.id, i + 1]));
  }, [leaders]);

  const allChecked = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const totalLive = leaders.reduce((s, l) => s + l.liveProfit, 0);
  const activeCount = leaders.filter((l) => l.active).length;

  const liveMsOf = (l: Leader) => l.liveMs + (l.active && l.liveStartedAt ? now - l.liveStartedAt : 0);

  const toggleAll = () => {
    setSelected((prev) => {
      if (allChecked) {
        const next = new Set(prev);
        filtered.forEach((l) => next.delete(l.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((l) => next.add(l.id));
      return next;
    });
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ app: "QuantEvo Lab", leaders }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quantevo_leaders_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="max-w-[1660px] mx-auto px-4 pb-6 flex flex-col gap-3">
      {/* ---------- шапка зала славы ---------- */}
      <div className="qe-panel reveal p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-panel2 border border-amber/40 flex items-center justify-center shadow-[0_0_18px_rgba(242,179,61,0.18)]">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f2b33d" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
              <path d="M7 5H4a1 1 0 0 0-1 1c0 2.2 1.6 4 4 4.4M17 5h3a1 1 0 0 1 1 1c0 2.2-1.6 4-4 4.4" />
              <path d="M12 14v3M8.5 20h7M10 17h4v3h-4z" />
            </svg>
          </div>
          <div>
            <h2 className="font-disp text-[15px] font-bold tracking-[0.05em] leading-none">
              ЗАЛ СЛАВЫ <span className="text-amber">ЭВОЛЮЦИИ</span>
            </h2>
            <p className="qe-num text-[10.5px] text-dim mt-1 flex items-center gap-2">
              <span>
                {leaders.length} лидеров · история хранится бессрочно · live-профит{" "}
                <span className={totalLive >= 0 ? "text-green" : "text-red"}>{totalLive >= 0 ? "+" : ""}${totalLive.toFixed(2)}</span>
              </span>
              {tradingRunning ? (
                <span className="flex items-center gap-1.5 text-green">
                  <span className="relative flex w-2 h-2">
                    <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-green" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green" />
                  </span>
                  движок в работе
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {selected.size > 0 ? (
            <>
              <span className="qe-num text-[11px] text-mut">выбрано: {selected.size}</span>
              <button
                type="button"
                className="btn-ghost px-3 py-2 text-[11.5px] qe-num font-semibold flex items-center gap-1.5"
                onClick={() => setSelected(new Set())}
              >
                Снять выделение
              </button>
              <button
                type="button"
                className="btn-stop px-3 py-2 text-[11.5px] qe-num font-bold flex items-center gap-1.5"
                onClick={() => setConfirmDel([...selected])}
              >
                Удалить выбранные ({selected.size})
              </button>
            </>
          ) : null}
          <button type="button" className="btn-ghost px-3 py-2 text-[11.5px] qe-num font-semibold flex items-center gap-1.5" onClick={exportAll} disabled={leaders.length === 0}>
            <IconDownload />
            Экспорт
          </button>
          <button type="button" className="btn-ghost px-3 py-2 text-[11.5px] qe-num font-semibold flex items-center gap-1.5" onClick={() => fileRef.current?.click()}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10V2m0 0 3 3M8 2 5 5" />
              <path d="M2.5 11.5v1A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-1" />
            </svg>
            Импорт
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportLeaders(f);
              e.target.value = "";
            }}
          />
          {leaders.length > 0 ? (
            <button type="button" className="btn-stop px-3 py-2 text-[11.5px] qe-num font-bold" onClick={() => setConfirmDel(leaders.map((l) => l.id))}>
              Очистить всё
            </button>
          ) : null}
        </div>
      </div>

      {/* ---------- сортировка и фильтр ---------- */}
      <div className="qe-panel reveal p-3 flex flex-wrap items-center gap-3" style={{ animationDelay: "50ms" }}>
        <span className="qe-num text-[10.5px] tracking-[0.14em] text-dim uppercase">Сортировать по</span>
        <div className="relative">
          <select
            className="qe-input appearance-none pr-8 cursor-pointer"
            value={sortKey}
            onChange={(e) => {
              const k = e.target.value as SortKey;
              setSortKey(k);
              // разумные направления по умолчанию
              setDesc(k !== "maxDD");
            }}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k} className="bg-panel">{SORT_LABELS[k]}</option>
            ))}
          </select>
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </div>
        <button
          type="button"
          className="btn-ghost px-2.5 py-2 flex items-center gap-1 qe-num text-[11px]"
          onClick={() => setDesc((d) => !d)}
          title="Направление сортировки"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: desc ? "none" : "rotate(180deg)", transition: "transform .2s" }}>
            <path d="M8 2v12M4 10l4 4 4-4" />
          </svg>
          {desc ? "по убыванию" : "по возрастанию"}
        </button>

        <span className="w-px h-5 bg-line mx-1 hidden sm:block" />

        <div className="flex p-0.5 rounded-lg bg-bg1 border border-line">
          {(
            [
              { v: "all", label: "Все" },
              { v: "spot", label: "Спот" },
              { v: "linear", label: "Фьючерсы" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => setMarketFilter(o.v)}
              className={`rounded-md px-3 py-1.5 text-[11.5px] qe-num font-semibold transition-all duration-150 ${
                marketFilter === o.v ? "bg-panel2 text-amber2 shadow-[inset_0_0_0_1px_rgba(242,179,61,0.45)]" : "text-dim hover:text-mut"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <span className="ml-auto qe-num text-[10.5px] text-dim">
          {filtered.length} из {leaders.length}
          {activeCount > 0 ? (
            <>
              {" · "}
              <span className="text-green">{activeCount} в live</span>
            </>
          ) : null}
        </span>
      </div>

      {/* ---------- таблица ---------- */}
      <Panel
        title={`Лидеры эволюции · ${filtered.length}`}
        tick="teal"
        className="reveal"
        style={{ animationDelay: "100ms" }}
        right={<span className="qe-num text-[10px] text-dim">клик по строке — отправить стратегию в торговлю</span>}
      >
        {filtered.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="opacity-60"><IconHelix size={44} /></div>
            <div className="font-disp text-[13px] font-bold text-mut">Зал славы пока пуст</div>
            <p className="qe-num text-[11px] text-dim max-w-md leading-relaxed">
              {leaders.length === 0
                ? "Запустите эволюцию на вкладке «Лаборатория» — лучший геном каждого прогона автоматически попадёт сюда и будет храниться бессрочно."
                : "Нет лидеров с выбранным фильтром рынка."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full qe-num text-[11.5px]">
              <thead>
                <tr className="text-left text-[9.5px] uppercase tracking-[0.12em] text-dim border-b border-line">
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" className="accent-amber cursor-pointer" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th className="px-2 py-2.5">Ранг</th>
                  <th className="px-2 py-2.5">Пара · ТФ · Рынок</th>
                  <th className="px-2 py-2.5">Эволюция</th>
                  <th className="px-2 py-2.5 text-right">Доход</th>
                  <th className="px-2 py-2.5 text-right">Win%</th>
                  <th className="px-2 py-2.5 text-right">MaxDD</th>
                  <th className="px-2 py-2.5 text-right">Сделки</th>
                  <th className="px-2 py-2.5 text-right">R/R</th>
                  <th className="px-2 py-2.5">Live-статистика</th>
                  <th className="px-2 py-2.5 text-right">Фитнес</th>
                  <th className="px-3 py-2.5 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const rank = ranked.get(l.id) ?? 0;
                  const rr = leaderRR(l);
                  const isSel = selected.has(l.id);
                  const isExp = expanded === l.id;
                  const marketDiff = l.market !== tradingMarket;
                  return (
                    <FragmentRow
                      key={l.id}
                      l={l}
                      rank={rank}
                      rr={rr}
                      isSel={isSel}
                      isExp={isExp}
                      marketDiff={marketDiff}
                      tradingRunning={tradingRunning}
                      liveMs={liveMsOf(l)}
                      onToggleSel={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(l.id)) next.delete(l.id);
                          else next.add(l.id);
                          return next;
                        })
                      }
                      onExpand={() => setExpanded(isExp ? null : l.id)}
                      onDeploy={() => setDeploying(l)}
                      onDelete={() => setConfirmDel([l.id])}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="qe-num text-[10.5px] text-dim reveal" style={{ animationDelay: "140ms" }}>
        Стратегия лидера заменяет текущую в торговом терминале; если сделка открыта — замена произойдёт после её закрытия.
        Отправка лидера с другим режимом рынка (спот ↔ фьючерсы) потребует подтверждения.
      </p>

      {/* ---------- модалка удаления ---------- */}
      {confirmDel ? (
        <Modal onClose={() => setConfirmDel(null)}>
          <div className="text-center">
            <div className="w-11 h-11 mx-auto rounded-xl bg-red/10 border border-red/40 flex items-center justify-center mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f65c7a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />
              </svg>
            </div>
            <h3 className="font-disp text-[14px] font-bold mb-1.5">
              Удалить {confirmDel.length === leaders.length && leaders.length > 1 ? "всех лидеров" : confirmDel.length === 1 ? "лидера" : `лидеров (${confirmDel.length})`}?
            </h3>
            <p className="qe-num text-[11px] text-mut leading-relaxed mb-5">
              Live-статистика (время работы и профит) будет потеряна безвозвратно.
            </p>
            <div className="flex gap-2 justify-center">
              <button type="button" className="btn-ghost px-5 py-2.5 text-[12px] qe-num font-semibold" onClick={() => setConfirmDel(null)}>
                Отмена
              </button>
              <button
                type="button"
                className="px-5 py-2.5 rounded-lg bg-red/90 text-white text-[12px] qe-num font-bold hover:bg-red transition-colors"
                onClick={() => {
                  onDelete(confirmDel);
                  setSelected((prev) => {
                    const next = new Set(prev);
                    confirmDel.forEach((id) => next.delete(id));
                    return next;
                  });
                  setConfirmDel(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {/* ---------- модалка отправки в торговлю ---------- */}
      {deploying ? (
        <Modal onClose={() => setDeploying(null)}>
          <DeployDialog
            l={deploying}
            tradingMarket={tradingMarket}
            tradingRunning={tradingRunning}
            onCancel={() => setDeploying(null)}
            onConfirm={(switchMarket) => {
              onDeploy(deploying, switchMarket);
              setDeploying(null);
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}

// ============================================================
function FragmentRow({
  l,
  rank,
  rr,
  isSel,
  isExp,
  marketDiff,
  tradingRunning,
  liveMs,
  onToggleSel,
  onExpand,
  onDeploy,
  onDelete,
}: {
  l: Leader;
  rank: number;
  rr: number;
  isSel: boolean;
  isExp: boolean;
  marketDiff: boolean;
  tradingRunning: boolean;
  liveMs: number;
  onToggleSel: () => void;
  onExpand: () => void;
  onDeploy: () => void;
  onDelete: () => void;
}) {
  const rankCls =
    rank === 1
      ? "bg-amber/15 text-amber2 border-amber/50 shadow-[0_0_10px_rgba(242,179,61,0.25)]"
      : rank === 2
        ? "bg-[#a8b8d0]/10 text-[#cfd9ea] border-[#a8b8d0]/40"
        : rank === 3
          ? "bg-[#c98a4b]/10 text-[#e0ac72] border-[#c98a4b]/40"
          : "bg-bg1 text-dim border-line";

  return (
    <>
      <tr
        className={`row-hover border-b border-line/70 cursor-pointer transition-colors ${isSel ? "bg-amber/[0.04]" : ""} ${isExp ? "bg-panel2/50" : ""}`}
        onClick={onDeploy}
      >
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" className="accent-amber cursor-pointer" checked={isSel} onChange={onToggleSel} />
        </td>
        <td className="px-2 py-2.5">
          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg border text-[11px] font-bold ${rankCls}`}>{rank}</span>
        </td>
        <td className="px-2 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] font-bold text-ink">{l.pair.replace("USDT", "")}<span className="text-dim font-normal">/USDT</span></span>
            <span className="px-1.5 py-0.5 rounded border border-line text-[9.5px] text-mut">{tfLabel(l.tf)}</span>
            <span
              className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold ${
                l.market === "spot" ? "border-blue/40 text-blue bg-blue/5" : "border-teal/40 text-teal bg-teal/5"
              }`}
            >
              {marketLabel(l.market)}{l.market === "linear" ? ` ×${l.leverage}` : ""}
            </span>
          </div>
        </td>
        <td className="px-2 py-2.5 text-mut whitespace-nowrap">{fmtDateTime(l.createdAt)}</td>
        <td className={`px-2 py-2.5 text-right font-bold ${l.metrics.returnPct >= 0 ? "text-green" : "text-red"}`}>{fmtPct(l.metrics.returnPct)}</td>
        <td className="px-2 py-2.5 text-right text-ink">{fmtNum(l.metrics.winRate, 0)}%</td>
        <td className={`px-2 py-2.5 text-right ${l.metrics.maxDD > 0.35 ? "text-red" : "text-mut"}`}>{fmtPct(-l.metrics.maxDD * 100, false)}</td>
        <td className="px-2 py-2.5 text-right text-ink">{l.metrics.trades}</td>
        <td className="px-2 py-2.5 text-right text-amber2 font-semibold">{Number.isFinite(rr) ? `1:${rr.toFixed(2)}` : "1:∞"}</td>
        <td className="px-2 py-2.5">
          {l.active ? (
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="relative flex w-2 h-2">
                <span className="pulse-dot absolute inline-flex h-full w-full rounded-full bg-green" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green" />
              </span>
              <span className="text-green font-bold">LIVE</span>
              <span className="text-mut">{fmtDur(liveMs)}</span>
              <span className={l.liveProfit >= 0 ? "text-green" : "text-red"}>
                {l.liveProfit >= 0 ? "+" : ""}${l.liveProfit.toFixed(2)}
              </span>
            </div>
          ) : l.queued ? (
            <span className="flex items-center gap-1.5 text-amber2 whitespace-nowrap">
              <Led color="#f2b33d" pulse /> в очереди (после сделки)
            </span>
          ) : l.liveMs > 0 || l.liveTrades > 0 ? (
            <span className="text-mut whitespace-nowrap">
              {fmtDur(liveMs)} · <span className={l.liveProfit >= 0 ? "text-green" : "text-red"}>{l.liveProfit >= 0 ? "+" : ""}${l.liveProfit.toFixed(2)}</span> · {l.liveTrades} сдел.
            </span>
          ) : (
            <span className="text-dim whitespace-nowrap">не запускался</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-right text-teal font-semibold">{fmtNum(l.fitness)}</td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1.5">
            <button
              type="button"
              title="Детали генома"
              className={`btn-ghost px-2 py-1.5 ${isExp ? "border-teal text-teal" : ""}`}
              onClick={onExpand}
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ transform: isExp ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 rounded-md border text-[10px] font-bold qe-num transition-all duration-150 whitespace-nowrap ${
                marketDiff
                  ? "border-amber/60 text-amber2 hover:bg-amber/10"
                  : "border-green/50 text-green hover:bg-green/10"
              }`}
              onClick={onDeploy}
              title={marketDiff ? "Режим рынка отличается от терминала — потребуется подтверждение" : "Отправить стратегию в торговлю"}
            >
              {marketDiff ? "В торговлю ⚠" : "В торговлю"}
            </button>
            <button type="button" title="Удалить лидера" className="btn-stop px-2 py-1.5" onClick={onDelete}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
              </svg>
            </button>
          </div>
        </td>
      </tr>
      {isExp ? (
        <tr className="border-b border-line/70 bg-bg1/50">
          <td colSpan={12} className="px-4 py-3">
            <div className="qe-num text-[9.5px] uppercase tracking-[0.14em] text-dim mb-2">
              Геном лидера · фитнес {fmtNum(l.fitness)} · бэктест за 365 дней
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-8 gap-2">
              {GENES.map((g) => (
                <div key={g.key} className="rounded-md border border-line bg-panel px-2 py-1.5">
                  <div className="text-[9px] text-dim truncate">{g.label}</div>
                  <div className="text-[11.5px] font-bold text-amber2">
                    {g.log ? l.genome[g.key].toExponential(1) : g.int ? String(Math.round(l.genome[g.key])) : l.genome[g.key].toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
            <div className="qe-num text-[10px] text-dim mt-2">
              Sharpe {fmtNum(l.metrics.sharpe)} · Sortino {fmtNum(l.metrics.sortino)} · PF {fmtNum(l.metrics.pf)} · CAGR {fmtPct(l.metrics.cagr)} · ср. сделка {fmtPct(l.metrics.avgPct)} · TP {l.genome.tpPct.toFixed(2)}% / SL {l.genome.slPct.toFixed(2)}%
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ============================================================
function DeployDialog({
  l,
  tradingMarket,
  tradingRunning,
  onCancel,
  onConfirm,
}: {
  l: Leader;
  tradingMarket: "spot" | "linear";
  tradingRunning: boolean;
  onCancel: () => void;
  onConfirm: (switchMarket: boolean) => void;
}) {
  const marketDiff = l.market !== tradingMarket;
  return (
    <div>
      <h3 className="font-disp text-[14px] font-bold mb-3 flex items-center gap-2">
        Отправить стратегию в торговлю
        {l.active ? <span className="qe-num text-[9.5px] text-green border border-green/40 rounded px-1.5 py-0.5">УЖЕ В LIVE</span> : null}
      </h3>

      <div className="qe-num text-[11.5px] text-mut leading-relaxed mb-3">
        <span className="text-ink font-bold">{l.pair.replace("USDT", "")}/USDT · {tfLabel(l.tf)} · {marketLabel(l.market)}</span>
        {l.market === "linear" ? ` ×${l.leverage}` : ""} · доход {fmtPct(l.metrics.returnPct)} · R/R 1:{Number.isFinite(leaderRR(l)) ? leaderRR(l).toFixed(2) : "∞"}
      </div>

      {marketDiff ? (
        <div className="rounded-lg border border-amber/50 bg-amber/[0.07] p-3 mb-4">
          <div className="flex items-center gap-2 text-amber2 qe-num text-[11px] font-bold mb-1.5">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 2.5 20h19L12 3Z" />
              <path d="M12 10v4M12 17.5v.5" />
            </svg>
            СМЕНА РЕЖИМА РЫНКА
          </div>
          <p className="text-[11px] text-mut leading-relaxed">
            Лидер эволюционировал на режиме <b className="text-ink">{marketLabel(l.market)}</b>, а торговый терминал сейчас в режиме{" "}
            <b className="text-ink">{marketLabel(tradingMarket)}</b>. При отправке режим терминала будет переключён на{" "}
            <b className="text-amber2">{marketLabel(l.market)}</b>
            {l.market === "linear" ? ` с плечом ×${l.leverage}` : ""}.
            {l.market === "linear"
              ? " Фьючерсы используют кредитное плечо, фандинг и могут приводить к ликвидации — убедитесь, что понимаете риски."
              : " Спот торгует без плеча и ликвидации."}
          </p>
        </div>
      ) : null}

      <div className="qe-num text-[10.5px] text-dim leading-relaxed mb-4 border border-line rounded-lg p-2.5 bg-bg1/60">
        {tradingRunning
          ? "Торговый движок запущен: стратегия будет помещена в очередь и заменит текущую сразу после закрытия открытой сделки."
          : "Движок остановлен: стратегия загрузится в терминал и активируется при запуске."}
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost px-4 py-2.5 text-[12px] qe-num font-semibold" onClick={onCancel}>
          Отмена
        </button>
        <button
          type="button"
          className={`btn-run px-5 py-2.5 text-[12px] qe-num tracking-wide flex items-center gap-2 ${marketDiff ? "!bg-none !bg-amber/90" : ""}`}
          onClick={() => onConfirm(marketDiff)}
        >
          {marketDiff ? "ПЕРЕКЛЮЧИТЬ РЕЖИМ И ОТПРАВИТЬ" : "ОТПРАВИТЬ В ТОРГОВЛЮ"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg0/80 backdrop-blur-sm" onClick={onClose}>
      <div className="qe-panel w-full max-w-md p-5 reveal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
