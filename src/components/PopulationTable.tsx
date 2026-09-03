import type { PopRow } from "../lib/ga";
import { decodeGenome } from "../lib/backtest";
import { fmtPct } from "./ui";

interface Props {
  rows: PopRow[];
  activeIdx: number;
  onPreview: (idx: number) => void;
  previewMode: boolean;
}

export default function PopulationTable({ rows, activeIdx, onPreview, previewMode }: Props) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center qe-num text-[12px] text-dim">
        Популяция появится после первого поколения эволюции
      </div>
    );
  }
  const maxFit = Math.max(...rows.map((r) => r.fit), 0.001);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11.5px] qe-num whitespace-nowrap">
        <thead>
          <tr className="text-dim text-[10px] uppercase tracking-[0.1em] border-b border-line">
            <th className="text-left font-medium px-3 py-2">#</th>
            <th className="text-left font-medium px-2 py-2">Фитнес</th>
            <th className="text-right font-medium px-2 py-2">RSI</th>
            <th className="text-right font-medium px-2 py-2">EMA f/s</th>
            <th className="text-right font-medium px-2 py-2">τ·m</th>
            <th className="text-right font-medium px-2 py-2">Q·10⁴</th>
            <th className="text-right font-medium px-2 py-2">Фибо</th>
            <th className="text-right font-medium px-2 py-2">TP/SL %</th>
            <th className="text-right font-medium px-2 py-2">Сделки</th>
            <th className="text-right font-medium px-2 py-2">Доход</th>
            <th className="text-right font-medium px-2 py-2">MaxDD</th>
            <th className="text-right font-medium px-2 py-2">Win%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = decodeGenome(r.genome);
            const active = previewMode && i === activeIdx;
            const leader = i === 0;
            return (
              <tr
                key={i}
                onClick={() => onPreview(i)}
                className={`row-hover cursor-pointer border-b border-line/50 ${
                  active ? "bg-[rgba(242,179,61,0.07)]" : ""
                } ${leader ? "text-ink" : "text-mut"}`}
              >
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    {leader ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber shadow-[0_0_8px_rgba(242,179,61,0.8)]" />
                    ) : null}
                    <span className={leader ? "text-amber2 font-bold" : "text-dim"}>{i + 1}</span>
                  </span>
                </td>
                <td className="px-2 py-1.5 min-w-[110px]">
                  <span className="inline-flex items-center gap-2 w-full">
                    <span className="w-10 text-right font-semibold text-amber2">{r.fit.toFixed(2)}</span>
                    <span className="h-1 flex-1 bg-bg1 rounded overflow-hidden">
                      <span
                        className="block h-full rounded transition-all duration-500"
                        style={{
                          width: `${Math.max(4, Math.min(100, (r.fit / maxFit) * 100))}%`,
                          background: leader ? "#f2b33d" : "#3bc9c4",
                        }}
                      />
                    </span>
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {p.rsiPeriod}<span className="text-dim">/{p.rsiLow}-{p.rsiHigh}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {p.emaFast}<span className="text-dim">/{p.emaSlow}</span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  {p.takensDelay}<span className="text-dim">·</span>{p.takensDim}
                </td>
                <td className="px-2 py-1.5 text-right text-teal">{(p.kalmanQ * 1e4).toFixed(2)}</td>
                <td className="px-2 py-1.5 text-right">
                  {p.fibLo.toFixed(2)}<span className="text-dim">–</span>{p.fibHi.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <span className="text-green">{p.tpPct.toFixed(1)}</span>
                  <span className="text-dim">/</span>
                  <span className="text-red">{p.slPct.toFixed(1)}</span>
                </td>
                <td className="px-2 py-1.5 text-right">{r.metrics.trades}</td>
                <td className={`px-2 py-1.5 text-right font-semibold ${r.metrics.returnPct >= 0 ? "text-green" : "text-red"}`}>
                  {fmtPct(r.metrics.returnPct)}
                </td>
                <td className="px-2 py-1.5 text-right text-red">{fmtPct(-r.metrics.maxDD * 100, false)}</td>
                <td className="px-2 py-1.5 text-right">{r.metrics.winRate.toFixed(0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
