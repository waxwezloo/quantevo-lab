import { useState, useRef, useEffect, useCallback } from "react";
import { FAQ, CATEGORY_LABELS, type FaqEntry } from "../lib/faq";

interface Props {
  onClose: () => void;
}

export default function FaqPanel({ onClose }: Props) {
  const [pos, setPos] = useState({ x: 100, y: 100 });
  const [dragging, setDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Перетаскивание
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      setPos({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y });
    };
    const handleUp = () => setDragging(false);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, dragOffset]);

  // Закрытие по Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Фильтрация по поиску
  const filtered = FAQ.filter((f) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return f.term.toLowerCase().includes(q) || f.short.toLowerCase().includes(q) || f.full.toLowerCase().includes(q);
  });

  // Группировка по категориям
  const grouped: Partial<Record<FaqEntry["category"], FaqEntry[]>> = {};
  for (const f of filtered) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category]!.push(f);
  }

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <div
        ref={panelRef}
        className="absolute w-[600px] max-w-[90vw] max-h-[80vh] bg-panel border border-line rounded-lg shadow-2xl flex flex-col pointer-events-auto"
        style={{ left: pos.x, top: pos.y }}
      >
        {/* Заголовок (перетаскиваемый) */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-line cursor-move select-none bg-panel2 rounded-t-lg"
          onMouseDown={handleMouseDown}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
          <div className="flex-1">
            <div className="font-disp text-[14px] font-bold text-ink">FAQ · Справочник терминов</div>
            <div className="qe-num text-[10px] text-dim">Перетащите за заголовок · Esc для закрытия</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-md border border-line2 bg-bg1 text-dim hover:text-red hover:border-red transition-colors flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Поиск */}
        <div className="px-4 py-3 border-b border-line bg-bg1/60">
          <input
            type="text"
            placeholder="Поиск по терминам…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="qe-input w-full"
          />
        </div>

        {/* Содержимое */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {Object.keys(grouped).length === 0 ? (
            <div className="text-center text-dim text-[12px] py-8">Ничего не найдено</div>
          ) : (
            (Object.keys(grouped) as FaqEntry["category"][]).map((cat) => (
              <div key={cat}>
                <div className="qe-num text-[11px] font-bold text-teal tracking-[0.1em] uppercase mb-2">
                  {CATEGORY_LABELS[cat]}
                </div>
                <div className="space-y-1.5">
                  {grouped[cat]!.map((f) => (
                    <div key={f.id} className="border border-line rounded-md bg-bg1/40">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-panel/50 transition-colors"
                      >
                        <span className="text-[11.5px] font-semibold text-ink">{f.term}</span>
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          className={`text-dim transition-transform ${expandedId === f.id ? "rotate-180" : ""}`}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      {expandedId === f.id ? (
                        <div className="px-3 pb-3 text-[10.5px] text-mut leading-relaxed border-t border-line pt-2">
                          {f.full}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
