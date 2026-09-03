import type { ReactNode } from "react";

// ---------- inline SVG icons ----------
const S = { w: 16, h: 16 } as const;

export function IconPlay() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M4.5 2.7c0-.63.68-1 1.22-.68l8.1 4.8a.8.8 0 0 1 0 1.37l-8.1 4.8a.8.8 0 0 1-1.22-.69V2.7Z" />
    </svg>
  );
}
export function IconStop() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.6" />
    </svg>
  );
}
export function IconDice() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="2" width="12" height="12" rx="2.6" />
      <circle cx="5.4" cy="5.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="10.6" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="10.6" cy="5.4" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="5.4" cy="10.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function IconCopy() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.6" />
      <path d="M10.5 3.4V3a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10h.4" />
    </svg>
  );
}
export function IconDownload() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v8m0 0 3-3M8 10 5 7" />
      <path d="M2.5 11.5v1A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-1" />
    </svg>
  );
}
export function IconHelix({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#14223F" stroke="#33497A" />
      <path d="M9 23c4.5-1.2 9.5-8.8 14-14M9 9c4.5 1.2 9.5 8.8 14 14" stroke="#F2B33D" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.5 12.5h9M11 16h10M11.5 19.5h9" stroke="#3BC9C4" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
export function IconFlask() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 2h4M6.8 2v4.2L3.4 12.4A1.6 1.6 0 0 0 4.8 14.7h6.4a1.6 1.6 0 0 0 1.4-2.3L9.2 6.2V2" />
      <path d="M5 10.5h6" />
    </svg>
  );
}
export function IconCode() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5" />
    </svg>
  );
}
export function IconCheck() {
  return (
    <svg {...S} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3 8.5 3.2 3.2L13 4.9" />
    </svg>
  );
}
export function IconArrow() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5" />
    </svg>
  );
}

// ---------- primitives ----------
export function Panel({
  title,
  tick = "",
  right,
  children,
  className = "",
  style,
}: {
  title: string;
  tick?: "" | "teal" | "green";
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section className={`qe-panel overflow-hidden ${className}`} style={style}>
      <header className="qe-panel-head">
        <span className={`qe-tick ${tick}`} />
        <span className="truncate">{title}</span>
        {right ? <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">{right}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  fmt,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
  disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[12px] text-mut">{label}</span>
        <span className="qe-num text-[12px] font-semibold text-amber2">
          {fmt ? fmt(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ ["--fill" as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-1 group disabled:opacity-50"
    >
      <span className="text-left">
        <span className="block text-[12px] text-mut group-hover:text-ink transition-colors">{label}</span>
        {hint ? <span className="block text-[10.5px] text-dim">{hint}</span> : null}
      </span>
      <span className={`qe-toggle ${checked ? "on" : ""}`} />
    </button>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex p-0.5 rounded-lg bg-bg1 border border-line w-full ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      {options.map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`flex-1 rounded-md px-2 py-1.5 text-[12px] qe-num font-semibold transition-all duration-150 ${
            o.v === value
              ? "bg-panel2 text-amber2 shadow-[inset_0_0_0_1px_rgba(242,179,61,0.45)]"
              : "text-dim hover:text-mut"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Led({ color, pulse }: { color: string; pulse?: boolean }) {
  return <span className={`led ${pulse ? "led-pulse" : ""}`} style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

export function Stat({
  label,
  value,
  sub,
  tone = "ink",
  delay,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "green" | "red" | "amber" | "mut";
  delay?: number;
}) {
  const toneCls: Record<string, string> = {
    ink: "text-ink",
    green: "text-green",
    red: "text-red",
    amber: "text-amber2",
    mut: "text-mut",
  };
  return (
    <div className="reveal bg-bg1/60 border border-line rounded-lg px-3 py-2.5 hover:border-line2 transition-colors" style={{ animationDelay: `${delay ?? 0}ms` }}>
      <div className="text-[10px] uppercase tracking-[0.12em] text-dim">{label}</div>
      <div className={`qe-num text-[17px] leading-6 font-bold ${toneCls[tone]}`}>{value}</div>
      {sub ? <div className="qe-num text-[10px] text-dim">{sub}</div> : null}
    </div>
  );
}

export function fmtPct(v: number, signed = true): string {
  if (!Number.isFinite(v)) return "—";
  const s = v > 0 && signed ? "+" : "";
  return `${s}${v.toFixed(2)}%`;
}
export function fmtNum(v: number, d = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
