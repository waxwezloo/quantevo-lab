#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QuantEvo Lab — генетический алгоритм для торговли на Bybit.

Стратегия FibDiv (час / 4 часа — основные таймфреймы):
  1. Метод Такенса: delay-embedding лог-цены (лаг tau, размерность m),
     PCA степенной итерацией — главная компонента фазовой траектории.
  2. Расширенный фильтр Калмана (EKF): состояние [уровень, скорость],
     нелинейное наблюдение h(x) = x0 + 0.1*tanh(x1), якобиан
     H = [1, 0.1*(1-tanh^2)]. Импульс = нормированная скорость.
  3. Сигнал LONG: цена в Фибо-зоне ретрейсмента (fibLo..fibHi плеча
     L->H) + бычья RSI-дивергенция + импульс выше порога + EMA-фильтр.
     SHORT — зеркально.
  4. Вход на открытии следующего бара, TP/SL внутри бара,
     комиссия taker + проскальзывание, реверс-выход.
  5. Спот или USDT-перпетуал (category), кредитное плечо,
     фандинг за 8ч, модель ликвидации (~90% маржи).
  6. Риск/награда: сетап TP/SL и реализованный (ср. прибыль /
     ср. убыток) — в отчёте и в JSON. Геном можно экспортировать
     из веб-лаборатории и прогнать через --import-params.

Установка:
    pip install -r requirements.txt
    cp .env.example .env   # заполните BYBIT_API_KEY / BYBIT_API_SECRET

Запуск (бэктест за последний год, таймфрейм 1Ч):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 60
    python ga_bybit_trader.py --symbol BTCUSDT --interval 240 --pop 64 --gens 40

Перпетуал с плечом x5 (USDT Perpetual, комиссия 0.055%):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 240 --category linear --leverage 5

Бэктест генома из веб-лаборатории (без эволюции):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 60 --import-params quantevo_genome.json
"""

import argparse
import json
import math
import os
import random
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("BYBIT_API_KEY", "")
API_SECRET = os.getenv("BYBIT_API_SECRET", "")
BASE_URL = "https://api.bybit.com"

# ============================================================
# Bybit V5 REST (публичные klines + приватный баланс)
# ============================================================
class BybitClient:
    def __init__(self, api_key: str = API_KEY, api_secret: str = API_SECRET):
        self.key = api_key
        self.secret = api_secret
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": "QuantEvoLab/1.0"})

    def _sign(self, ts: str, params: str):
        import hmac, hashlib
        payload = ts + self.key + "5000" + params
        return hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def get_wallet_balance(self, account_type: str = "UNIFIED"):
        ts = str(int(time.time() * 1000))
        params = "accountType=" + account_type
        headers = {
            "X-BAPI-API-KEY": self.key,
            "X-BAPI-TIMESTAMP": ts,
            "X-BAPI-RECV-WINDOW": "5000",
            "X-BAPI-SIGN": self._sign(ts, params),
        }
        r = self.s.get(BASE_URL + "/v5/account/wallet-balance",
                       params={"accountType": account_type}, headers=headers, timeout=10)
        r.raise_for_status()
        body = r.json()
        if body.get("retCode") != 0:
            raise RuntimeError("Bybit: " + body.get("retMsg", "error"))
        return body["result"]

    def fetch_klines(self, symbol, interval, days=365, category="spot"):
        """Свечи с пагинацией (лимит V5 = 1000). Возвращает dict of np.array."""
        iv = {1440: "D", 10080: "W"}.get(interval, str(interval))
        # на минутках глубина урезается до ~26k свечей
        days = max(3, min(days, (26000 * interval) // 1440))
        end_ms = int(time.time() * 1000)
        start_ms = end_ms - days * 86400000
        out = []
        end = end_ms
        while end > start_ms:
            r = self.s.get(
                BASE_URL + "/v5/market/kline",
                params={
                    "category": category,
                    "symbol": symbol,
                    "interval": iv,
                    "start": start_ms,
                    "end": end,
                    "limit": 1000,
                },
                timeout=15,
            )
            r.raise_for_status()
            body = r.json()
            if body.get("retCode") != 0:
                raise RuntimeError("Bybit: " + body.get("retMsg", "kline error"))
            rows = body["result"]["list"]
            if not rows:
                break
            for row in rows:
                out.append([int(row[0]), float(row[1]), float(row[2]),
                            float(row[3]), float(row[4]), float(row[5])])
            end = int(rows[-1][0]) - 1
            time.sleep(0.12)  # rate-limit V5: 10 req/s
        if not out:
            raise RuntimeError("Bybit вернул пустую историю")
        arr = np.array(sorted(out, key=lambda x: x[0]), dtype=float)
        return {"t": arr[:, 0], "o": arr[:, 1], "h": arr[:, 2],
                "l": arr[:, 3], "c": arr[:, 4], "v": arr[:, 5]}


# ============================================================
# Индикаторы (векторизовано)
# ============================================================
def ema(src, period):
    period = max(1, int(round(period)))
    k = 2.0 / (period + 1)
    out = np.empty_like(src)
    prev = src[0]
    for i in range(len(src)):
        prev = src[i] if i == 0 else src[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def rsi_wilder(src, period):
    p = max(2, int(round(period)))
    n = len(src)
    out = np.full(n, 50.0)
    if n <= p:
        return out
    d = np.diff(src)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    ag, al = up[:p].mean(), dn[:p].mean()
    out[p] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(p + 1, n):
        ag = (ag * (p - 1) + up[i - 1]) / p
        al = (al * (p - 1) + dn[i - 1]) / p
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def find_pivots(high, low, length):
    L = max(2, int(round(length)))
    n = len(high)
    lows, highs = [], []
    for i in range(L, n - L):
        win_l = low[i - L:i + L + 1]
        win_h = high[i - L:i + L + 1]
        if low[i] == win_l.min():
            lows.append((i, low[i]))
        if high[i] == win_h.max():
            highs.append((i, high[i]))
    return lows, highs


def takens_momentum(close, tau, m, q):
    """Delay-embedding + PCA + расширенный фильтр Калмана -> z-score скорости."""
    n = len(close)
    tau, m = max(1, int(round(tau))), max(2, int(round(m)))
    off = (m - 1) * tau
    out = np.zeros(n)
    if n < off + 60:
        return out
    logp = np.log(np.maximum(close, 1e-12))

    # --- embedding (до 1200 векторов для PCA) ---
    step = max(1, (n - off) // 1200)
    idx = np.arange(off, n, step)
    emb = np.stack([logp[idx - k * tau] for k in range(m)], axis=1)
    emb = (emb - emb.mean(axis=0)) / (emb.std(axis=0) + 1e-12)

    # --- PCA: степенная итерация ---
    C = emb.T @ emb / len(emb)
    w = np.full(m, 1.0 / math.sqrt(m))
    for _ in range(60):
        w = C @ w
        w /= np.linalg.norm(w) + 1e-12
    if w[0] < 0:
        w = -w

    # --- проекция ряда на главную компоненту ---
    s = np.zeros(n)
    for k in range(m):
        seg = logp[off - k * tau: n - k * tau]
        z = (seg - seg.mean()) / (seg.std() + 1e-12)
        s[off:] += w[k] * z

    # --- расширенный фильтр Калмана ---
    var_s = s[off:].var() + 1e-12
    Q = max(1e-9, q) * var_s
    R = 0.5 * var_s
    x0, x1 = s[off], 0.0
    p00 = p11 = var_s
    p01 = p10 = 0.0
    vel = np.zeros(n)
    for t in range(off, n):
        x0 = x0 + x1                      # predict (F = [[1,1],[0,1]])
        p00 = p00 + p01 + p10 + p11 + Q
        p01 = p01 + p11
        p10 = p10 + p11
        p11 = p11 + Q
        th = math.tanh(x1)                # update: h(x) = x0 + 0.1*tanh(x1)
        h = x0 + 0.1 * th
        h1 = 0.1 * (1 - th * th)          # якобиан H = [1, h1]
        yv = s[t] - h
        S = p00 + h1 * (p01 + p10) + h1 * h1 * p11 + R
        k0 = (p00 + p01 * h1) / S
        k1 = (p10 + p11 * h1) / S
        x0 += k0 * yv
        x1 += k1 * yv
        n00 = p00 - k0 * (p00 + p10 * h1)
        n01 = p01 - k0 * (p01 + p11 * h1)
        n10 = p10 - k1 * (p00 + p10 * h1)
        n11 = p11 - k1 * (p01 + p11 * h1)
        p00, p01, p10, p11 = n00, n01, n10, n11
        vel[t] = x1

    # --- нормировка: скользящий z-score скорости ---
    a = 0.02
    mm, m2 = vel[off], vel[off] ** 2
    for t in range(off, n):
        mm += a * (vel[t] - mm)
        m2 += a * (vel[t] ** 2 - m2)
        sd = math.sqrt(max(m2 - mm * mm, 1e-12))
        if t > off + 30:
            out[t] = (vel[t] - mm) / sd
    return out


def divergence_flags(pivots, rsi, lookback, n, kind, confirm_lag):
    out = np.zeros(n, dtype=bool)
    for i in range(1, len(pivots)):
        (_, p1), (i2, p2) = pivots[i - 1], pivots[i]
        if kind == "bull":
            cond = p2 < p1 and rsi[i2] > rsi[i1] and rsi[i2] < 56
        else:
            cond = p2 > p1 and rsi[i2] < rsi[i1] and rsi[i2] > 44
        if cond:
            start = i2 + confirm_lag
            out[start: min(n, start + int(round(lookback)))] = True
    return out


def fib_zones(piv_h, piv_l, fib_lo, fib_hi, life, confirm_lag, n, kind):
    zone_lo = np.full(n, np.nan)
    zone_hi = np.full(n, np.nan)
    legs = []
    if kind == "long":
        for (ih, ph) in piv_h:
            lows_before = [p for p in piv_l if p[0] < ih]
            if not lows_before:
                continue
            il, pl = lows_before[-1]
            rng = ph - pl
            if rng <= 0 or rng / pl < 0.008:
                continue
            legs.append((ih + confirm_lag, ih + confirm_lag + life,
                         ph - fib_hi * rng, ph - fib_lo * rng))
    else:
        for (il, pl) in piv_l:
            highs_before = [p for p in piv_h if p[0] < il]
            if not highs_before:
                continue
            ih, ph = highs_before[-1]
            rng = ph - pl
            if rng <= 0 or rng / pl < 0.008:
                continue
            legs.append((il + confirm_lag, il + confirm_lag + life,
                         pl + fib_lo * rng, pl + fib_hi * rng))
    legs.sort()
    j, cur = 0, None
    for t in range(n):
        while j < len(legs) and legs[j][0] <= t:
            cur = legs[j]
            j += 1
        if cur and t < cur[1]:
            zone_lo[t], zone_hi[t] = cur[2], cur[3]
    return zone_lo, zone_hi


# ============================================================
# Сигналы + бэктест
# ============================================================
def compute_signals(c, p, allow_short=True, trend_filter=True):
    """Возвращает булевы массивы long_sig/short_sig по закрытым барам."""
    cl, high, low = c["c"], c["h"], c["l"]
    ema_f = ema(cl, p["ema_fast"])
    ema_s = ema(cl, p["ema_slow"])
    rsi = rsi_wilder(cl, p["rsi_period"])
    mom = takens_momentum(cl, p["takens_delay"], p["takens_dim"], p["kalman_q"])
    swing = int(round(p["swing_len"]))
    piv_l, piv_h = find_pivots(high, low, swing)
    bull = divergence_flags(piv_l, rsi, p["div_lookback"], len(cl), "bull", swing)
    bear = divergence_flags(piv_h, rsi, p["div_lookback"], len(cl), "bear", swing)
    life = int(round(p["div_lookback"])) * 2 + 30
    lz_lo, lz_hi = fib_zones(piv_h, piv_l, p["fib_lo"], p["fib_hi"], life, swing, len(cl), "long")
    sz_lo, sz_hi = fib_zones(piv_h, piv_l, p["fib_lo"], p["fib_hi"], life, swing, len(cl), "short")

    in_long = (cl >= lz_lo) & (cl <= lz_hi)
    in_short = (cl >= sz_lo) & (cl <= sz_hi)
    long_sig = in_long & bull & (mom > p["mom_thr"]) & (rsi < p["rsi_high"])
    short_sig = in_short & bear & (mom < -p["mom_thr"]) & (rsi > p["rsi_low"])
    if trend_filter:
        long_sig &= ema_f > ema_s
        short_sig &= ema_f < ema_s
    if not allow_short:
        short_sig[:] = False
    return long_sig, short_sig, rsi, ema_f, ema_s


def run_backtest(c, p, allow_short=True, trend_filter=True,
                 fee_pct=0.055, slip_pct=0.03, leverage=1.0,
                 funding_pct=0.01, tf_minutes=60):
    """Бэктест: вход по open следующего бара, TP/SL внутри бара.
    leverage > 1 — режим перпетуала: PnL и комиссии масштабируются,
    начисляется фандинг, при убытке ~90% маржи — ликвидация."""
    o, h, l, cl = c["o"], c["h"], c["l"], c["c"]
    long_sig, short_sig, rsi, _, _ = compute_signals(c, p, allow_short, trend_filter)
    n = len(cl)
    swing = int(round(p["swing_len"]))
    warm = max(int(p["ema_slow"]) + 5,
               int(p["rsi_period"]) + 5,
               (int(round(p["takens_dim"])) - 1) * int(round(p["takens_delay"])) + 60,
               swing * 2 + 5)

    fee = fee_pct / 100.0
    slip = slip_pct / 100.0
    lev = max(1.0, float(leverage))
    funding_bar = (funding_pct / 100.0) * (tf_minutes / 480.0) * lev
    liq_move = 0.9 / lev if lev > 1 else float("inf")

    equity = np.full(n, 10000.0)
    trades = []
    eq = 10000.0
    pos, entry_p, entry_i, tp, sl = 0, 0.0, 0, 0.0, 0.0
    pending = 0
    bars_held, worst = 0, 0.0

    for t in range(warm, n):
        if pending != 0:
            op = o[t] * (1 + slip * pending)
            entry_p, entry_i, pos, pending = op, t, pending, 0
            if pos == 1:
                tp, sl = op * (1 + p["tp_pct"] / 100), op * (1 - p["sl_pct"] / 100)
            else:
                tp, sl = op * (1 - p["tp_pct"] / 100), op * (1 + p["sl_pct"] / 100)
            bars_held, worst = 0, 0.0
        if pos != 0:
            bars_held += 1
            adv = ((entry_p - l[t]) / entry_p if pos == 1
                   else (h[t] - entry_p) / entry_p)
            if adv > worst:
                worst = adv
            exit_p, reason = 0.0, ""
            if worst >= liq_move:
                exit_p = entry_p * (1 - liq_move if pos == 1 else 1 + liq_move)
                reason = "LIQ"
            elif pos == 1:
                if l[t] <= sl:
                    exit_p, reason = sl, "SL"
                elif h[t] >= tp:
                    exit_p, reason = tp, "TP"
            else:
                if h[t] >= sl:
                    exit_p, reason = sl, "SL"
                elif l[t] <= tp:
                    exit_p, reason = tp, "TP"
            if exit_p == 0.0:
                rev = short_sig[t] if pos == 1 else long_sig[t]
                if rev:
                    exit_p, reason = cl[t], "REV"
                elif pos == 1 and rsi[t] > p["rsi_high"] + 6:
                    exit_p, reason = cl[t], "RSI"
                elif pos == -1 and rsi[t] < p["rsi_low"] - 6:
                    exit_p, reason = cl[t], "RSI"
            if exit_p > 0:
                gross = pos * (exit_p - entry_p) / entry_p
                if reason == "LIQ":
                    net = -0.9  # потеря ~90% маржи
                else:
                    net = max(lev * gross - 2 * fee * lev
                              - funding_bar * bars_held, -0.98)
                eq *= 1 + net
                trades.append({"dir": pos, "entry_i": entry_i, "exit_i": t,
                               "entry_p": entry_p, "exit_p": exit_p,
                               "pnl_pct": net * 100, "reason": reason})
                pos = 0
        if pos == 0 and pending == 0 and t + 1 < n:
            if long_sig[t]:
                pending = 1
            elif short_sig[t]:
                pending = -1
        if pos == 0:
            equity[t] = eq
        else:
            equity[t] = eq * (1 + max(lev * pos * (cl[t] - entry_p) / entry_p,
                                      -0.9) - fee * lev)

    if pos != 0:
        net = max(lev * (pos * (cl[-1] - entry_p) / entry_p) - 2 * fee * lev
                  - funding_bar * bars_held, -0.98)
        eq *= 1 + net
        trades.append({"dir": pos, "entry_i": entry_i, "exit_i": n - 1,
                       "entry_p": entry_p, "exit_p": cl[-1],
                       "pnl_pct": net * 100, "reason": "EOD"})
        equity[-1] = eq
    return equity, trades


def compute_metrics(equity, trades, tf_minutes):
    n = len(equity)
    ppy = (365 * 24 * 60) / tf_minutes
    final = equity[-1]
    ret = (final / 10000.0 - 1) * 100
    cagr = (max(final / 10000.0, 1e-6) ** (ppy / n) - 1) * 100 if n > 0 else 0.0
    rets = np.diff(equity) / equity[:-1]
    sharpe = 0.0
    sortino = 0.0
    if len(rets) > 1 and rets.std() > 0:
        sharpe = rets.mean() / rets.std(ddof=1) * math.sqrt(ppy)
        down = rets[rets < 0]
        if len(down):
            sortino = rets.mean() / math.sqrt((down ** 2).sum() / len(rets)) * math.sqrt(ppy)
    peak = np.maximum.accumulate(equity)
    max_dd = float((1 - equity / peak).max())
    wins = [t for t in trades if t["pnl_pct"] > 0]
    losses = [t for t in trades if t["pnl_pct"] <= 0]
    gw = sum(t["pnl_pct"] for t in wins)
    gl = sum(-t["pnl_pct"] for t in losses)
    pf = gw / gl if gl > 0 else (99.0 if gw > 0 else 0.0)
    return {
        "return_pct": ret, "cagr": cagr, "sharpe": sharpe, "sortino": sortino,
        "max_dd": max_dd, "win_rate": 100 * len(wins) / len(trades) if trades else 0.0,
        "profit_factor": pf, "trades": len(trades),
        "avg_pct": float(np.mean([t["pnl_pct"] for t in trades])) if trades else 0.0,
        "avg_win_pct": gw / len(wins) if wins else 0.0,
        "avg_loss_pct": gl / len(losses) if losses else 0.0,
    }


# ============================================================
# Генетический алгоритм
# ============================================================
GENE_DEFS = [
    # (ключ, min, max, int?, log?)
    ("rsi_period", 6, 36, True, False),
    ("rsi_low", 15, 42, True, False),
    ("rsi_high", 58, 85, True, False),
    ("ema_fast", 8, 60, True, False),
    ("ema_slow", 70, 260, True, False),
    ("takens_delay", 1, 12, True, False),
    ("takens_dim", 2, 6, True, False),
    ("kalman_q", 1e-5, 3e-2, False, True),
    ("mom_thr", 0.0, 1.6, False, False),
    ("div_lookback", 10, 90, True, False),
    ("swing_len", 3, 14, True, False),
    ("fib_lo", 0.20, 0.50, False, False),
    ("fib_hi", 0.55, 0.85, False, False),
    ("tp_pct", 0.6, 9.0, False, False),
    ("sl_pct", 0.4, 7.0, False, False),
]

# гены по умолчанию — середины диапазонов (для лог-генов геометрическая)
DEFAULTS = {
    k: (int(round(math.sqrt(lo * hi))) if is_int and is_log else
        int(round((lo + hi) / 2)) if is_int else
        (math.sqrt(lo * hi) if is_log else (lo + hi) / 2))
    for k, lo, hi, is_int, is_log in GENE_DEFS
}


class GAConfig:
    def __init__(self, pop=64, gens=40, mut_rate=0.18, elite=4,
                 tournament=3, seed=42,
                 weights=None):
        self.pop = pop
        self.gens = gens
        self.mut_rate = mut_rate
        self.elite = elite
        self.tournament = tournament
        self.seed = seed
        self.weights = weights or {"sharpe": 1.0, "pf": 0.8, "ret": 0.6, "dd": 1.2}


def _to_u(v, i):
    _, lo, hi, _, is_log = GENE_DEFS[i]
    if is_log:
        return (math.log(max(v, lo)) - math.log(lo)) / (math.log(hi) - math.log(lo))
    return (v - lo) / (hi - lo)


def _from_u(u, i):
    _, lo, hi, is_int, is_log = GENE_DEFS[i]
    u = min(1.0, max(0.0, u))
    if is_log:
        v = math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo)))
    else:
        v = lo + u * (hi - lo)
    return int(round(v)) if is_int else v


def decode(g):
    p = dict(zip([k for k, *_ in GENE_DEFS], g))
    if p["ema_fast"] >= p["ema_slow"]:
        p["ema_fast"] = max(8, min(p["ema_fast"], p["ema_slow"] - 12))
        p["ema_slow"] = min(260, max(p["ema_slow"], p["ema_fast"] + 12))
    if p["fib_lo"] >= p["fib_hi"]:
        mid = (p["fib_lo"] + p["fib_hi"]) / 2
        p["fib_lo"] = max(0.20, mid - 0.06)
        p["fib_hi"] = min(0.85, mid + 0.06)
    return p


def fitness(m, w, min_trades=8):
    if m["trades"] < min_trades:
        return -25 - (min_trades - m["trades"]) * 0.8
    sh = min(6.0, max(-4.0, m["sharpe"]))
    pf_t = math.log(min(30.0, max(0.05, m["profit_factor"])))
    rt = min(8.0, max(-3.0, m["return_pct"] / 100))
    score = (w["sharpe"] * sh + w["pf"] * pf_t + w["ret"] * rt
             - w["dd"] * m["max_dd"] * 10 + 0.5 * math.log10(m["trades"] + 1))
    return min(60.0, max(-60.0, score))


def _random_genome(rng):
    return [_from_u(rng.random(), i) for i in range(len(GENE_DEFS))]


def _gauss(rng):
    u = max(rng.random(), 1e-9)
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * rng.random())


def _crossover(a, b, rng):
    child = []
    for i in range(len(GENE_DEFS)):
        r = rng.random()
        if r < 0.5:
            child.append(a[i])
        elif r < 0.65:
            ua, ub = _to_u(a[i], i), _to_u(b[i], i)
            lo, hi = min(ua, ub), max(ua, ub)
            span = max(hi - lo, 0.02)
            child.append(_from_u(lo - 0.15 * span + rng.random() * span * 1.3, i))
        else:
            child.append(b[i])
    return child


def _mutate(g, rate, rng):
    for i in range(len(g)):
        if rng.random() < rate:
            g[i] = _from_u(_to_u(g[i], i) + _gauss(rng) * 0.22, i)
    return g


def _tournament(rows, k, rng):
    best = None
    for _ in range(k):
        r = rows[rng.randrange(len(rows))]
        if best is None or r[1] > best[1]:
            best = r
    return best


# аргументы для worker-процессов (глобальные, чтобы не сериализовать каждый раз)
_W_CANDLES = None
_W_ARGS = None


def _eval_genome(g):
    c, (tf, ash, tfil, fee, slip, lev, fund, w, min_trades) = _W_CANDLES, _W_ARGS
    p = decode(list(g))
    equity, trades = run_backtest(c, p, ash, tfil, fee, slip, lev, fund, tf)
    m = compute_metrics(equity, trades, tf)
    return g, fitness(m, w, min_trades), m


def _init_worker(candles, args):
    global _W_CANDLES, _W_ARGS
    _W_CANDLES, _W_ARGS = candles, args


def evolve(candles, tf_minutes, ga, allow_short=True, trend_filter=True,
           fee_pct=0.055, slip_pct=0.03, leverage=1.0, funding_pct=0.01,
           min_trades=8, workers=None):
    rng = random.Random(ga.seed)
    pop = [_random_genome(rng) for _ in range(ga.pop)]
    args = (tf_minutes, allow_short, trend_filter, fee_pct, slip_pct,
            leverage, funding_pct, ga.weights, min_trades)
    history = []
    best_ever = None
    ncpu = workers or min(8, os.cpu_count() or 2)

    with ProcessPoolExecutor(max_workers=ncpu,
                             initializer=_init_worker,
                             initargs=(candles, args)) as ex:
        for g_i in range(ga.gens):
            results = list(ex.map(_eval_genome, pop, chunksize=2))
            results.sort(key=lambda r: r[1], reverse=True)
            if best_ever is None or results[0][1] > best_ever[1]:
                best_ever = (results[0][0], results[0][2])
            avg = sum(r[1] for r in results) / len(results)
            history.append({"gen": g_i + 1, "best": results[0][1], "avg": avg})
            print("Поколение {:3d} | best {:7.2f} | avg {:7.2f}".format(
                g_i + 1, results[0][1], avg))
            elite = min(ga.elite, len(results) - 1)
            next_pop = [list(r[0]) for r in results[:elite]]
            while len(next_pop) < ga.pop:
                a = _tournament(results, ga.tournament, rng)
                b = _tournament(results, ga.tournament, rng)
                next_pop.append(_mutate(_crossover(list(a[0]), list(b[0]), rng),
                                        ga.mut_rate, rng))
            pop = next_pop
    return best_ever, history


# ============================================================
# CLI
# ============================================================
def main():
    ap = argparse.ArgumentParser(description="QuantEvo Lab — GA-оптимизация FibDiv на Bybit")
    ap.add_argument("--symbol", default=os.getenv("SYMBOL", "BTCUSDT"))
    ap.add_argument("--interval", type=int,
                    default=int(os.getenv("TIMEFRAME_MIN", "60")),
                    choices=[1, 3, 5, 15, 30, 60, 120, 240, 360, 720, 1440, 10080],
                    help="Минуты: 1..720, 1440=1Д, 10080=1Н (основные 60/240)")
    ap.add_argument("--category", default=os.getenv("MARKET_MODE", "spot"),
                    choices=["spot", "linear"],
                    help="spot или USDT-перпетуал (плечо)")
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--leverage", type=float, default=1.0,
                    help="Кредитное плечо (только --category linear)")
    ap.add_argument("--funding", type=float, default=0.01,
                    help="Фандинг %% за 8 часов (linear)")
    ap.add_argument("--pop", type=int, default=64)
    ap.add_argument("--gens", type=int, default=40)
    ap.add_argument("--mut", type=float, default=0.18)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--allow-short", action="store_true")
    ap.add_argument("--no-trend-filter", action="store_true")
    ap.add_argument("--fee", type=float, default=0.055)
    ap.add_argument("--import-params", default="",
                    help="JSON с геномом (экспорт веб-лаборатории): бэктест без GA")
    ap.add_argument("--out", default="best_params.json")
    ap.add_argument("--api-key", default=API_KEY)
    ap.add_argument("--api-secret", default=API_SECRET)
    args = ap.parse_args()

    client = BybitClient(args.api_key, args.api_secret)
    lev = max(1.0, args.leverage) if args.category == "linear" else 1.0
    tf_minutes = args.interval
    print("Загрузка {} {} ({}) с Bybit...".format(
        args.symbol, args.interval, args.category))
    candles = client.fetch_klines(args.symbol, args.interval, args.days,
                                  args.category)
    print("Свечей: {}".format(len(candles["c"])))

    def _cam(sn):  # snake_case -> camelCase (ключи веб-лаборатории)
        a = sn.split("_")
        return a[0] + "".join(w.title() for w in a[1:])

    if args.import_params:
        with open(args.import_params, "r", encoding="utf-8") as f:
            imp = json.load(f)
        src = imp.get("genome") or imp.get("params")
        if not isinstance(src, dict):
            raise SystemExit("В JSON нет поля genome/params")
        p_in = {}
        for key, lo, hi, is_int, _ in GENE_DEFS:
            v = float(src.get(key, src.get(_cam(key), float("nan"))))
            if not math.isfinite(v):
                raise SystemExit("В геноме нет ключа " + key)
            v = min(hi, max(lo, v))
            p_in[key] = int(round(v)) if is_int else v
        equity, trades = run_backtest(candles, p_in, args.allow_short,
                                      not args.no_trend_filter, args.fee,
                                      0.03, lev, args.funding, tf_minutes)
        m = compute_metrics(equity, trades, tf_minutes)
        result = {"genome": p_in, "params": p_in, "metrics": m,
                  "history": [], "trades": trades}
        print("Импортирован геном из " + args.import_params)
    else:
        ga = GAConfig(pop=args.pop, gens=args.gens, mut_rate=args.mut,
                      seed=args.seed)
        result = evolve(candles, tf_minutes, ga,
                        allow_short=args.allow_short,
                        trend_filter=not args.no_trend_filter,
                        fee_pct=args.fee, leverage=lev,
                        funding_pct=args.funding)
        (g_best, m_best), hist = result
        equity, trades = run_backtest(candles, decode(list(g_best)),
                                      args.allow_short,
                                      not args.no_trend_filter, args.fee,
                                      0.03, lev, args.funding, tf_minutes)
        m = compute_metrics(equity, trades, tf_minutes)
        result = {"genome": decode(list(g_best)), "params": decode(list(g_best)),
                  "metrics": m, "history": hist, "trades": trades}

    m = result["metrics"]
    print("\n=== ЛУЧШИЙ ГЕНОМ ===")
    for k, v in result["params"].items():
        print("  {:<15s} {}".format(k, v))
    print("\n=== МЕТРИКИ ({} дней, {} мин) ===".format(args.days, tf_minutes))
    print("  Доходность      {:+.2f}%".format(m["return_pct"]))
    print("  CAGR            {:+.2f}%".format(m["cagr"]))
    print("  Sharpe          {:.2f}".format(m["sharpe"]))
    print("  Sortino         {:.2f}".format(m["sortino"]))
    print("  Max Drawdown    {:.2f}%".format(m["max_dd"] * 100))
    print("  Win rate        {:.1f}%".format(m["win_rate"]))
    print("  Profit factor   {:.2f}".format(m["profit_factor"]))
    print("  Сделок          {}".format(m["trades"]))
    rr_set = result["params"]["tp_pct"] / max(result["params"]["sl_pct"], 1e-9)
    rr_real = (m["avg_win_pct"] / m["avg_loss_pct"]
               if m["avg_loss_pct"] > 0 else float("inf"))
    print("  R/R сетап (TP/SL)   1 : {:.2f}".format(rr_set))
    print("  R/R реализованный   1 : {:.2f}".format(rr_real))

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"app": "QuantEvo Lab", "symbol": args.symbol,
                   "interval": args.interval, "category": args.category,
                   "leverage": lev,
                   "params": result["params"], "metrics": m},
                  f, indent=2, ensure_ascii=False)
    print("\nСохранено в " + args.out)


if __name__ == "__main__":
    main()
