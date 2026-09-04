// ============================================================
// QuantEvo Lab — live/paper торговый движок
// Публичные kline (Bybit V5), сигналы computeSignals на закрытых
// барах, SL/TP-мониторинг, рыночные ордера (Web Crypto HMAC-SHA256),
// серверные условные SL/TP на перпетуале, мониторинг баланса.
// ============================================================

import type { Candle } from "./indicators";
import type { Params } from "./backtest";
import { computeSignals } from "./backtest";
import { fetchBybitKlines, bybitBase } from "./data";

export type EngineMode = "paper" | "live";

export interface TradingCfg {
  pair: string;
  tf: number;
  category: "spot" | "linear";
  leverage: number;
  deposit: number;
  riskPct: number; // % эквити на сделку
  pollMs: number;
  mode: EngineMode;
  testnet: boolean;
  apiKey: string;
  apiSecret: string;
  params: Params;
  allowShort: boolean;
  trendFilter: boolean;
  feePct: number;
  slipPct: number;
}

export interface PositionInfo {
  side: 1 | -1;
  entryP: number;
  qty: number;
  entryTime: number;
  sl: number;
  tp: number;
  notional: number;
  margin: number;
}

export interface TradeRec {
  openTime: number;
  closeTime: number;
  side: 1 | -1;
  entryP: number;
  exitP: number;
  qty: number;
  pnl: number; // в USD (net)
  pnlPct: number; // к эквити на момент входа
  reason: string;
}

export interface LogRec {
  t: number;
  kind: "info" | "ok" | "warn" | "err";
  msg: string;
}

export interface Snapshot {
  running: boolean;
  equity: number;
  cash: number;
  lastPrice: number;
  lastPoll: number;
  polls: number;
  position: PositionInfo | null;
  trades: TradeRec[];
  log: LogRec[];
  candles: Candle[];
  emaF: number[];
  emaS: number[];
  rsi: number[];
  warm: number;
  error: string | null;
  liveBalance: number | null;
}

// ---------- подпись Bybit V5 (HMAC-SHA256, Web Crypto) ----------
async function hmacSha256(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface ApiResult {
  retCode: number;
  retMsg: string;
  result?: Record<string, unknown>;
}

async function signedRequest(
  cfg: Pick<TradingCfg, "apiKey" | "apiSecret" | "testnet">,
  method: "GET" | "POST",
  path: string,
  query?: Record<string, string>,
  body?: Record<string, unknown>
): Promise<ApiResult> {
  const ts = String(Date.now());
  const recv = "5000";
  let url = bybitBase(cfg.testnet) + path;
  let payload = "";
  if (method === "GET" && query) {
    payload = new URLSearchParams(query).toString();
    if (payload) url += "?" + payload;
  }
  if (method === "POST" && body) payload = JSON.stringify(body);
  const sign = await hmacSha256(cfg.apiSecret, ts + cfg.apiKey + recv + payload);
  const resp = await fetch(url, {
    method,
    headers: {
      "X-BAPI-API-KEY": cfg.apiKey,
      "X-BAPI-SIGN": sign,
      "X-BAPI-TIMESTAMP": ts,
      "X-BAPI-RECV-WINDOW": recv,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? payload : undefined,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const j = (await resp.json()) as ApiResult;
  if (j.retCode !== 0) throw new Error(`Bybit ${j.retCode}: ${j.retMsg}`);
  return j;
}

export function trimQty(qty: number, price: number): string {
  // разумная точность количества под типичные фильтры Bybit
  const digits = qty >= 1000 ? 2 : qty >= 100 ? 3 : qty >= 1 ? 4 : price < 0.01 ? 0 : 5;
  return qty.toFixed(digits);
}

async function placeMarketOrder(
  cfg: TradingCfg,
  side: "Buy" | "Sell",
  qty: number,
  price: number,
  reduceOnly: boolean
): Promise<string> {
  const body: Record<string, unknown> = {
    category: cfg.category,
    symbol: cfg.pair,
    side,
    orderType: "Market",
    qty: trimQty(qty, price),
  };
  if (reduceOnly) body.reduceOnly = true;
  await signedRequest(cfg, "POST", "/v5/order/create", undefined, body);
  return `Market ${side} ${body.qty}`;
}

async function placeConditional(
  cfg: TradingCfg,
  side: "Buy" | "Sell",
  qty: number,
  triggerPrice: number,
  direction: 1 | 2
): Promise<void> {
  if (cfg.category !== "linear") return; // tpsl-фильтр спота отличается — локальный мониторинг
  await signedRequest(cfg, "POST", "/v5/order/create", undefined, {
    category: cfg.category,
    symbol: cfg.pair,
    side,
    orderType: "Market",
    qty: trimQty(qty, triggerPrice),
    triggerPrice: triggerPrice.toFixed(6),
    triggerDirection: direction,
    reduceOnly: true,
  });
}

export async function fetchAccountBalance(cfg: TradingCfg): Promise<number> {
  if (cfg.category === "linear") {
    const j = await signedRequest(cfg, "GET", "/v5/account/wallet-balance", { category: "linear" });
    const list = (j.result?.list ?? []) as Array<{ totalEquity?: string }>;
    return Number(list[0]?.totalEquity ?? 0);
  }
  const j = await signedRequest(cfg, "GET", "/v5/asset/coin", { coin: "USDT" });
  const rows = (j.result?.rows ?? []) as Array<{ walletBalance?: string }>;
  return Number(rows[0]?.walletBalance ?? 0);
}

export async function testConnection(cfg: TradingCfg): Promise<{ ok: boolean; msg: string; balance: number | null }> {
  const resp = await fetch(`${bybitBase(cfg.testnet)}/v5/market/time`);
  if (!resp.ok) return { ok: false, msg: `API недоступен (HTTP ${resp.status})`, balance: null };
  if (!cfg.apiKey || !cfg.apiSecret) return { ok: true, msg: "Публичное API доступно. Ключи не заданы.", balance: null };
  try {
    const bal = await fetchAccountBalance(cfg);
    return { ok: true, msg: "Ключи валидны, баланс получен", balance: bal };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "Ошибка подписи", balance: null };
  }
}

// ============================================================
// Движок
// ============================================================
export class TradingEngine {
  private cfg: TradingCfg;
  private snap: Snapshot;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastBarT = 0;
  private listeners = new Set<() => void>();
  private livePosSynced = false;

  constructor(cfg: TradingCfg) {
    this.cfg = cfg;
    this.snap = {
      running: false,
      equity: cfg.deposit,
      cash: cfg.deposit,
      lastPrice: 0,
      lastPoll: 0,
      polls: 0,
      position: null,
      trades: [],
      log: [],
      candles: [],
      emaF: [],
      emaS: [],
      rsi: [],
      warm: 0,
      error: null,
      liveBalance: null,
    };
    this.log("info", `Движок создан: ${cfg.pair} · ${cfg.tf}м · режим ${cfg.mode === "live" ? "LIVE" : "PAPER"}`);
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    fn();
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): Snapshot => this.snap;

  private emit() {
    this.snap = { ...this.snap };
    for (const fn of this.listeners) fn();
  }

  private log(kind: LogRec["kind"], msg: string) {
    this.snap.log = [...this.snap.log.slice(-90), { t: Date.now(), kind, msg }];
  }

  updateCfg(patch: Partial<TradingCfg>) {
    this.cfg = { ...this.cfg, ...patch };
  }

  get config(): TradingCfg {
    return this.cfg;
  }

  resetEquity() {
    this.snap.cash = this.cfg.deposit;
    this.snap.equity = this.cfg.deposit;
    this.snap.trades = [];
    this.snap.position = null;
    this.log("info", `Баланс сброшен к депозиту $${this.cfg.deposit.toFixed(2)}`);
    this.emit();
  }

  start() {
    if (this.timer) return;
    if (this.cfg.mode === "live" && (!this.cfg.apiKey || !this.cfg.apiSecret)) {
      this.log("err", "LIVE-режим требует API-ключ и секрет");
      this.emit();
      return;
    }
    this.snap.running = true;
    this.snap.error = null;
    this.lastBarT = 0;
    this.livePosSynced = false;
    this.log("ok", `Запуск · ${this.cfg.pair} · опрос каждые ${Math.round(this.cfg.pollMs / 1000)} с`);
    if (this.cfg.mode === "live") {
      this.log("warn", `LIVE на ${this.cfg.testnet ? "TESTNET" : "MAINNET"}: рыночные ордера реальны!`);
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.cfg.pollMs);
    this.emit();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.snap.running = false;
    this.log("warn", "Движок остановлен");
    this.emit();
  }

  closePositionManual() {
    const pos = this.snap.position;
    if (!pos) return;
    const px = this.snap.lastPrice || pos.entryP;
    this.closeAt(pos, px, "MANUAL", Date.now());
    this.emit();
  }

  // ---------- опрос рынка ----------
  private async poll() {
    if (this.busy) return;
    this.busy = true;
    const cfg = this.cfg;
    try {
      const days = Math.max(2, Math.ceil((320 * cfg.tf) / 1440) + 1);
      const candles = await fetchBybitKlines(cfg.pair, cfg.tf, days, cfg.category, cfg.testnet);
      if (candles.length < 120) throw new Error("Недостаточно свечей от Bybit");
      const sig = computeSignals(candles, cfg.params, cfg);
      this.snap.candles = candles;
      this.snap.emaF = sig.emaF;
      this.snap.emaS = sig.emaS;
      this.snap.rsi = sig.rsi;
      this.snap.warm = sig.warm;
      this.snap.lastPrice = candles[candles.length - 1].c;
      this.snap.lastPoll = Date.now();
      this.snap.polls++;
      this.snap.error = null;

      this.process(candles, sig.longSig, sig.shortSig, sig.rsi, sig.warm);
      this.updateEquity();

      if (cfg.mode === "live" && cfg.apiKey && cfg.apiSecret) {
        try {
          this.snap.liveBalance = await fetchAccountBalance(cfg);
        } catch {
          /* баланс — не критично */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (this.snap.error !== msg) this.log("err", `Опрос не удался: ${msg}`);
      this.snap.error = msg;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private updateEquity() {
    const pos = this.snap.position;
    if (!pos) {
      this.snap.equity = this.snap.cash;
      return;
    }
    const fee = this.cfg.feePct / 100;
    const upnl = pos.side * (this.snap.lastPrice - pos.entryP) * pos.qty;
    this.snap.equity = this.snap.cash + upnl - pos.notional * fee;
  }

  // ---------- обработка баров ----------
  private process(
    candles: Candle[],
    longSig: Uint8Array,
    shortSig: Uint8Array,
    rsi: number[],
    warm: number
  ) {
    const cfg = this.cfg;
    const n = candles.length;

    for (let i = warm; i < n; i++) {
      const bar = candles[i];
      const isForming = i === n - 1;

      if (isForming) {
        // формирующийся бар: только контроль SL/TP/ликвидации открытой позиции
        if (this.snap.position) this.checkIntrabar(bar, true);
        continue;
      }
      if (bar.t <= this.lastBarT) continue;
      this.lastBarT = bar.t;

      const pos = this.snap.position;
      if (pos) {
        const closed = this.checkIntrabar(bar, false);
        if (!closed) {
          // выходы по закрытию бара
          const rev = pos.side === 1 ? shortSig[i] : longSig[i];
          if (rev) {
            this.closeAt(pos, bar.c, "REV", bar.t);
          } else if (pos.side === 1 && rsi[i] > cfg.params.rsiHigh + 6) {
            this.closeAt(pos, bar.c, "RSI", bar.t);
          } else if (pos.side === -1 && rsi[i] < cfg.params.rsiLow - 6) {
            this.closeAt(pos, bar.c, "RSI", bar.t);
          }
        }
      } else if (longSig[i]) {
        this.open(1, bar.c, bar.t);
      } else if (shortSig[i]) {
        this.open(-1, bar.c, bar.t);
      }
    }
  }

  private checkIntrabar(bar: Candle, isForming: boolean): boolean {
    const pos = this.snap.position;
    if (!pos) return false;
    const lev = this.cfg.category === "linear" ? Math.max(1, this.cfg.leverage) : 1;
    const liqMove = lev > 1 ? 0.9 / lev : Infinity;
    const adv = pos.side === 1 ? (pos.entryP - bar.l) / pos.entryP : (bar.h - pos.entryP) / pos.entryP;
    if (adv >= liqMove) {
      const px = pos.side === 1 ? pos.entryP * (1 - liqMove) : pos.entryP * (1 + liqMove);
      this.liquidate(pos, px, bar.t);
      return true;
    }
    if (pos.side === 1) {
      if (bar.l <= pos.sl) {
        this.closeAt(pos, pos.sl, isForming ? "SL*" : "SL", bar.t);
        return true;
      }
      if (bar.h >= pos.tp) {
        this.closeAt(pos, pos.tp, isForming ? "TP*" : "TP", bar.t);
        return true;
      }
    } else {
      if (bar.h >= pos.sl) {
        this.closeAt(pos, pos.sl, isForming ? "SL*" : "SL", bar.t);
        return true;
      }
      if (bar.l <= pos.tp) {
        this.closeAt(pos, pos.tp, isForming ? "TP*" : "TP", bar.t);
        return true;
      }
    }
    return false;
  }

  // ---------- открытие ----------
  private open(side: 1 | -1, priceRef: number, time: number) {
    const cfg = this.cfg;
    const lev = cfg.category === "linear" ? Math.max(1, cfg.leverage) : 1;
    const slip = cfg.slipPct / 100;
    const fee = cfg.feePct / 100;
    const entryP = priceRef * (1 + slip * side);
    const equity = this.snap.equity;
    const riskUsd = (equity * cfg.riskPct) / 100;
    const slPct = cfg.params.slPct / 100;
    let qty = riskUsd / (entryP * slPct);
    let notional = qty * entryP;
    const maxNotional = equity * lev;
    if (notional > maxNotional) {
      notional = maxNotional;
      qty = notional / entryP;
    }
    if (notional < 5) {
      this.log("warn", `Сигнал ${side === 1 ? "LONG" : "SHORT"} пропущен: нотациал $${notional.toFixed(2)} < $5 (минимум биржи)`);
      return;
    }
    const openFee = notional * fee;
    if (openFee >= this.snap.cash) {
      this.log("warn", "Сигнал пропущен: недостаточно средств на комиссию");
      return;
    }
    const sl = side === 1 ? entryP * (1 - slPct) : entryP * (1 + slPct);
    const tp = side === 1 ? entryP * (1 + cfg.params.tpPct / 100) : entryP * (1 - cfg.params.tpPct / 100);

    this.snap.cash -= openFee;
    this.snap.position = {
      side,
      entryP,
      qty,
      entryTime: time,
      sl,
      tp,
      notional,
      margin: notional / lev,
    };
    this.livePosSynced = false;
    this.log(
      "ok",
      `${cfg.mode === "live" ? "LIVE " : ""}${side === 1 ? "LONG" : "SHORT"} @ ${entryP.toFixed(6)} · qty ${qty.toFixed(5)} · SL ${sl.toFixed(6)} · TP ${tp.toFixed(6)}`
    );

    if (cfg.mode === "live") {
      void placeMarketOrder(cfg, side === 1 ? "Buy" : "Sell", qty, entryP, false)
        .then((m) => {
          this.log("ok", `Ордер принят: ${m}`);
          this.livePosSynced = true;
          if (cfg.category === "linear") {
            return Promise.all([
              placeConditional(cfg, side === 1 ? "Sell" : "Buy", qty, sl, side === 1 ? 2 : 1),
              placeConditional(cfg, side === 1 ? "Sell" : "Buy", qty, tp, side === 1 ? 1 : 2),
            ]).then(() => this.log("ok", "Серверные SL/TP выставлены (условные ордера)"));
          }
        })
        .catch((e) => {
          this.log("err", `Ордер отклонён: ${e instanceof Error ? e.message : e}`);
          this.snap.position = null; // не держим фантомную позицию
        });
    }
  }

  // ---------- закрытие ----------
  private closeAt(pos: PositionInfo, exitP: number, reason: string, time: number) {
    const cfg = this.cfg;
    const fee = cfg.feePct / 100;
    const gross = pos.side * (exitP - pos.entryP) * pos.qty;
    const fees = (pos.entryP * pos.qty + exitP * pos.qty) * fee;
    const net = gross - fees;
    this.snap.cash += gross - fees;
    const equityBefore = this.snap.equity;
    this.snap.position = null;
    this.snap.trades = [
      ...this.snap.trades.slice(-49),
      {
        openTime: pos.entryTime,
        closeTime: time,
        side: pos.side,
        entryP: pos.entryP,
        exitP,
        qty: pos.qty,
        pnl: net,
        pnlPct: equityBefore > 0 ? (net / equityBefore) * 100 : 0,
        reason,
      },
    ];
    this.log(
      net >= 0 ? "ok" : "warn",
      `Закрыто [${reason}] @ ${exitP.toFixed(6)} · PnL ${net >= 0 ? "+" : ""}${net.toFixed(2)} USDT`
    );

    if (cfg.mode === "live" && this.livePosSynced) {
      void placeMarketOrder(cfg, pos.side === 1 ? "Sell" : "Buy", pos.qty, exitP, true).catch((e) =>
        this.log("err", `Закрывающий ордер: ${e instanceof Error ? e.message : e}`)
      );
      this.livePosSynced = false;
    }
  }

  private liquidate(pos: PositionInfo, exitP: number, time: number) {
    const loss = 0.9 * pos.margin;
    this.snap.cash -= loss;
    this.snap.position = null;
    this.snap.trades = [
      ...this.snap.trades.slice(-49),
      {
        openTime: pos.entryTime,
        closeTime: time,
        side: pos.side,
        entryP: pos.entryP,
        exitP,
        qty: pos.qty,
        pnl: -loss,
        pnlPct: this.snap.equity > 0 ? (-loss / this.snap.equity) * 100 : 0,
        reason: "LIQ",
      },
    ];
    this.log("err", `ЛИКВИДАЦИЯ @ ${exitP.toFixed(6)} · потеряно $${loss.toFixed(2)} (90% маржи)`);
    if (this.cfg.mode === "live" && this.livePosSynced) {
      void placeMarketOrder(this.cfg, pos.side === 1 ? "Sell" : "Buy", pos.qty, exitP, true).catch(() => undefined);
      this.livePosSynced = false;
    }
  }
}
