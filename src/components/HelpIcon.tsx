import { useState, useRef, useEffect } from "react";
import { getFaqById } from "../lib/faq";

interface Props {
  faqId: string;
  className?: string;
}

export default function HelpIcon({ faqId, className = "" }: Props) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const entry = getFaqById(faqId);

  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShow(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [show]);

  if (!entry) return null;

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setShow(!show)}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => !show && setTimeout(() => setShow(false), 200)}
        className="w-4 h-4 rounded-full border border-line2 bg-bg1 text-dim hover:text-amber2 hover:border-amber2 transition-colors flex items-center justify-center text-[10px] font-bold qe-num"
        title={entry.short}
      >
        ?
      </button>
      {show ? (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 bg-panel2 border border-line rounded-lg shadow-xl pointer-events-auto">
          <div className="text-[11px] font-bold text-amber2 mb-1.5 leading-tight">{entry.term}</div>
          <div className="text-[10.5px] text-mut leading-relaxed">{entry.short}</div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px w-2 h-2 bg-panel2 border-r border-b border-line rotate-45" />
        </div>
      ) : null}
    </div>
  );
}
