// ============================================================
// QuantEvo Lab — Leaderboard: персистентное хранилище лидеров
// эволюции (localStorage, история не ограничена).
// ============================================================

import type { Params, Metrics } from "./backtest";

export interface Leader {
  id: string;
  createdAt: number; // дата и время завершения эволюции
  pair: string;
  tf: number; // минуты
  market: "spot" | "linear";
  leverage: number;
  genome: Params;
  fitness: number;
  metrics: Metrics;
  // live-статистика
  liveMs: number; // суммарное время работы в live/paper торговле
  liveStartedAt: number | null; // активен прямо сейчас
  liveProfit: number; // реализованный PnL в USD, принесённый лидером
  liveTrades: number; // сделок исполнено под этим лидером
  active: boolean; // сейчас торгует
  queued: boolean; // в очереди на замену стратегии
}

// Инкрементальное обновление live-статистики лидера
export interface LeaderUpdate {
  active?: boolean;
  queued?: boolean;
  liveStartedAt?: number | null;
  addLiveMs?: number;
  addLiveProfit?: number;
  addLiveTrades?: number;
}

export function applyLeaderUpdate(l: Leader, u: LeaderUpdate): Leader {
  return {
    ...l,
    active: u.active ?? l.active,
    queued: u.queued ?? l.queued,
    liveStartedAt: u.liveStartedAt !== undefined ? u.liveStartedAt : l.liveStartedAt,
    liveMs: l.liveMs + (u.addLiveMs ?? 0),
    liveProfit: l.liveProfit + (u.addLiveProfit ?? 0),
    liveTrades: l.liveTrades + (u.addLiveTrades ?? 0),
  };
}

const KEY = "quantevo.leaders.v1";

export function loadLeaders(): Leader[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Leader[];
    if (!Array.isArray(arr)) return [];
    // лидер, помеченный активным в прошлой сессии, — больше не активен
    return arr.map((l) =>
      l.active && l.liveStartedAt
        ? { ...l, active: false, liveMs: l.liveMs + (Date.now() - l.liveStartedAt), liveStartedAt: null }
        : l
    );
  } catch {
    return [];
  }
}

export function saveLeaders(list: Leader[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* квота переполнена — молча пропускаем */
  }
}

export function newLeaderId(): string {
  return `L${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
}

// ---------- форматирование ----------
export function fmtDur(ms: number): string {
  if (ms < 1000) return "0с";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function leaderRR(l: Leader): number {
  return l.metrics.avgLossPct > 0 ? l.metrics.avgWinPct / l.metrics.avgLossPct : Number.POSITIVE_INFINITY;
}

export function tfLabel(tf: number): string {
  if (tf >= 1440) return tf >= 10080 ? "1Н" : "1Д";
  if (tf >= 60) return `${tf / 60}Ч`;
  return `${tf}м`;
}

export function marketLabel(m: Leader["market"]): string {
  return m === "spot" ? "СПОТ" : "ФЬЮЧЕРСЫ";
}
