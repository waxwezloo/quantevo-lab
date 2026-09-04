import { useEffect, useRef, useState } from "react";
import { PAIRS, BASE_PRICE } from "../lib/data";
import { fmtPrice } from "../lib/backtest";

interface Quote {
  p: number;
  chg: number;
  dir: 1 | -1 | 0;
  tick: number;
}

// Живая лента котировок: локальная симуляция тиков (обновление ~1.6 c)
export default function TickerTape({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (s: string) => void;
}) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>(() => {
    const q: Record<string, Quote> = {};
    PAIRS.forEach((s, i) => {
      const base = BASE_PRICE[s] ?? 100;
      q[s] = { p: base, chg: ((i * 37) % 9) - 4.2, dir: 0, tick: 0 };
    });
    return q;
  });
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const id = setInterval(() => {
      setQuotes((prev) => {
        const next: Record<string, Quote> = {};
        for (const s of PAIRS) {
          const q = prev[s];
          const drift = (Math.random() - 0.5) * 0.0022;
          const p = q.p * (1 + drift);
          const chg = q.chg + drift * 100 * 0.6 + (Math.random() - 0.5) * 0.05;
          next[s] = {
            p,
            chg,
            dir: drift > 0.00005 ? 1 : drift < -0.00005 ? -1 : 0,
            tick: q.tick + 1,
          };
        }
        return next;
      });
    }, 1600);
    return () => clearInterval(id);
  }, []);

  const items = [...PAIRS, ...PAIRS];

  return (
    <div className="tape relative overflow-hidden border-y border-line bg-[#0a111f]/90 h-9 flex items-center select-none">
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3 bg-[#0a111f] border-r border-line">
        <span className="qe-num text-[10px] tracking-[0.18em] text-dim">BYBIT·SPOT</span>
      </div>
      <div className="tape-track pl-28">
        {items.map((s, i) => {
          const q = quotes[s];
          const isActive = s === active;
          return (
            <button
              key={`${s}-${i}`}
              type="button"
              onClick={() => onSelect(s)}
              className={`flex items-center gap-2 px-5 h-9 border-r border-line/60 transition-colors whitespace-nowrap group ${
                isActive ? "bg-panel2/70" : "hover:bg-panel/70"
              }`}
            >
              <span
                className={`text-[11.5px] font-semibold tracking-wide ${
                  isActive ? "text-amber2" : "text-mut group-hover:text-ink"
                } transition-colors`}
              >
                {s.replace("USDT", "")}
                <span className="text-dim font-normal">/USDT</span>
              </span>
              <span
                key={`${s}-${q.tick}`}
                className={`qe-num text-[11.5px] text-ink ${
                  q.dir === 1 ? "flash-up" : q.dir === -1 ? "flash-down" : ""
                }`}
              >
                {fmtPrice(q.p)}
              </span>
              <span className={`qe-num text-[10.5px] ${q.chg >= 0 ? "text-green" : "text-red"}`}>
                {q.chg >= 0 ? "▲" : "▼"} {Math.abs(q.chg).toFixed(2)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
