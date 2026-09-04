// ============================================================
// QuantEvo Lab — полный Python-источник движка (га-трейдер Bybit)
// Отдаётся как файл ga_bybit_trader.py (копирование / скачивание)
// ============================================================

export const PYTHON_FILENAME = "ga_bybit_trader.py";

export const PYTHON_SOURCE = `#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
QuantEvo · ga_bybit_trader.py
==============================================================
Генетический алгоритм подбора параметров торговой стратегии
для биржи Bybit (публичные данные V5, spot / USDT-перпетуал).

Стратегия FibDiv (основные таймфреймы 1Ч / 4Ч):
  * Метод Такенса: delay-embedding ln(close) с лагом tau и
    размерностью m, проекция на первую главную компоненту.
  * Расширенный фильтр Калмана (состояние [уровень, скорость],
    нелинейное наблюдение h(x) = x0 + 0.1*tanh(x1), якобиан
    аналитически) -> нормированный "Такенс-импульс".
  * Фибо-зоны ретрейсмента (0.382-0.618 по умолчанию, границы
    оптимизируются) от подтверждённых свингов.
  * Дивергенции RSI (бычья/медвежья) по свинг-экстремумам.
  * Трендовый фильтр EMA fast/slow, RSI (Wilder).
  * Вход на открытии следующего бара, TP/SL внутри бара,
    комиссия taker + проскальзывание, реверс-выход.
  * Спот или USDT-перпетуал (category), кредитное плечо,
    фандинг за 8ч, модель ликвидации (~90% маржи).
  * Риск/награда: сетап TP/SL и реализованный (ср. прибыль /
    ср. убыток) — в отчёте и в JSON. Геном можно экспортировать
    из веб-лаборатории и прогнать через --import-params.

Генетический алгоритм: турнирный отбор, BLX-кроссовер,
гауссова мутация в нормированном пространстве, элитизм.
Фитнес = w1*Sharpe + w2*ln(PF) + w3*Return - w4*MaxDD*10.

Зависимости:
    pip install numpy requests

Запуск (бэктест за последний год, таймфрейм 1Ч):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 60
    python ga_bybit_trader.py --symbol BTCUSDT --interval 240 --pop 64 --gens 40

Перпетуал с плечом x5 (USDT Perpetual, комиссия 0.055%):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 240 --category linear --leverage 5

Бэктест генома из веб-лаборатории (без эволюции):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 60 --import-params quantevo_genome.json

Live-режим (ОПАСНО, только для тестирования на малых объёмах):
    python ga_bybit_trader.py --symbol ETHUSDT --interval 60 --live \\
        --api-key KEY --api-secret SECRET

Не является инвестиционной рекомендацией.
"""

import argparse
import hashlib
import hmac
import json
import math
import time
from dataclasses import dataclass

import numpy as np
import requests

BASE_URL = "https://api.bybit.com"


# ============================================================
# 1. Клиент Bybit V5
# ============================================================
class BybitClient:
    def __init__(self, api_key="", api_secret=""):
        self.api_key = api_key
        self.api_secret = api_secret
        self.sess = requests.Session()

    def fetch_klines(self, symbol, interval, days=365, category="spot"):
        """Свечи с пагинацией (лимит V5 = 1000). Возвращает dict of np.array."""
        iv = {1440: "D", 10080: "W"}.get(interval, str(interval))
        # на минутках глубина урезается до ~26k свечей
        days = max(3, min(days, (26000 * interval) // 1440))
        end_ms = int(time.time() * 1000)
        start_ms = end_ms - days * 86400000
        raw = []
        cursor = end_ms
        while cursor > start_ms:
            resp = self.sess.get(
                BASE_URL + "/v5/market/kline",
                params={
                    "category": category,
                    "symbol": symbol,
                    "interval": iv,
                    "start": start_ms,
                    "end": cursor,
                    "limit": 1000,
                },
                timeout=15,
            )
            data = resp.json()
            if data.get("retCode") != 0:
                raise RuntimeError("Bybit error: " + str(data.get("retMsg")))
            lst = data["result"]["list"]
            if not lst:
                break
            for k in lst:
                raw.append([int(k[0]), float(k[1]), float(k[2]),
                            float(k[3]), float(k[4]), float(k[5])])
            oldest = min(int(k[0]) for k in lst)
            if len(lst) < 1000 or oldest <= start_ms:
                break
            cursor = oldest - 1
            time.sleep(0.15)  # уважение к лимитам API
        if not raw:
            raise RuntimeError("Нет данных по " + symbol)
        raw.sort(key=lambda r: r[0])
        arr = np.array(raw, dtype=float)
        _, idx = np.unique(arr[:, 0], return_index=True)
        arr = arr[np.sort(idx)]
        return {
            "t": arr[:, 0].astype(np.int64),
            "o": arr[:, 1], "h": arr[:, 2], "l": arr[:, 3],
            "c": arr[:, 4], "v": arr[:, 5],
        }

    def place_order(self, symbol, side, qty, order_type="Market"):
        """Market-ордер (только для live-режима, на ваш страх и риск)."""
        ts = str(int(time.time() * 1000))
        body = json.dumps({"category": "spot", "symbol": symbol,
                           "side": side, "orderType": order_type,
                           "qty": str(qty)})
        sign = hmac.new(self.api_secret.encode(),
                        (ts + self.api_key + "5000" + body).encode(),
                        hashlib.sha256).hexdigest()
        resp = self.sess.post(
            BASE_URL + "/v5/order/create",
            data=body,
            headers={"X-BAPI-API-KEY": self.api_key,
                     "X-BAPI-SIGN": sign,
                     "X-BAPI-TIMESTAMP": ts,
                     "X-BAPI-RECV-WINDOW": "5000",
                     "Content-Type": "application/json"},
            timeout=10,
        )
        return resp.json()


# ============================================================
# 2. Индикаторы
# ============================================================
def rsi_wilder(close, period):
    n = len(close)
    out = np.full(n, 50.0)
    if n <= period + 1:
        return out
    d = np.diff(close)
    up = np.clip(d, 0, None)
    dn = np.clip(-d, 0, None)
    ag, al = up[:period].mean(), dn[:period].mean()
    out[period] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    for i in range(period + 1, n):
        ag = (ag * (period - 1) + up[i - 1]) / period
        al = (al * (period - 1) + dn[i - 1]) / period
        out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def ema_series(src, period):
    k = 2.0 / (max(1, period) + 1)
    out = np.empty_like(src)
    prev = src[0]
    for i in range(len(src)):
        prev = src[i] if i == 0 else src[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def find_pivots(high, low, length):
    """Фрактальные экстремумы: length баров слева и справа."""
    n = len(high)
    lows, highs = [], []
    L = max(2, int(round(length)))
    for i in range(L, n - L):
        win_l = low[i - L:i + L + 1]
        win_h = high[i - L:i + L + 1]
        if low[i] <= win_l.min():
            lows.append((i, low[i]))
        if high[i] >= win_h.max():
            highs.append((i, high[i]))
    return lows, highs


# ============================================================
# 3. Метод Такенса + расширенный фильтр Калмана
# ============================================================
def takens_projection(logp, tau, m):
    """Delay-embedding + PCA (степенная итерация) -> скалярный ряд."""
    n = len(logp)
    off = (m - 1) * tau
    idx = np.arange(off, n, max(1, (n - off) // 1200))
    E = np.column_stack([logp[idx - k * tau] for k in range(m)])
    mu, sd = E.mean(axis=0), E.std(axis=0) + 1e-12
    Z = (E - mu) / sd
    C = Z.T @ Z / len(Z)
    w = np.ones(m) / math.sqrt(m)
    for _ in range(60):
        w = C @ w
        w /= (np.linalg.norm(w) + 1e-12)
    if w[0] < 0:
        w = -w
    S = np.zeros(n)
    for k in range(m):
        S[off:] += w[k] * (logp[off - k * tau:n - k * tau] - mu[k]) / sd[k]
    return S


def ekf_smooth(s, q):
    """
    Расширенный фильтр Калмана. Состояние x = [уровень, скорость],
    F = [[1,1],[0,1]], нелинейное наблюдение h(x) = x0 + 0.1*tanh(x1),
    якобиан H = [1, 0.1*(1 - tanh(x1)^2)] считается аналитически.
    Возвращает оценку скорости.
    """
    n = len(s)
    var_s = float(np.var(s)) + 1e-12
    Q = max(1e-9, q) * var_s
    R = 0.5 * var_s
    x = np.array([s[0], 0.0])
    P = np.eye(2) * var_s
    F = np.array([[1.0, 1.0], [0.0, 1.0]])
    vel = np.zeros(n)
    for t in range(n):
        x = F @ x
        P = F @ P @ F.T + np.eye(2) * Q
        th = math.tanh(x[1])
        h = x[0] + 0.1 * th
        H = np.array([[1.0, 0.1 * (1.0 - th * th)]])
        S = float(H @ P @ H.T) + R
        K = (P @ H.T) / S
        x = x + (K * (s[t] - h)).ravel()
        P = (np.eye(2) - K @ H) @ P
        vel[t] = x[1]
    return vel


def takens_momentum(close, tau, m, q):
    """Такенс-импульс: z-score скорости EKF над PCA-проекцией."""
    n = len(close)
    out = np.zeros(n)
    off = (m - 1) * tau
    if n < off + 60:
        return out
    logp = np.log(close)
    s = takens_projection(logp, tau, m)
    vel = ekf_smooth(s[off:], q)
    full = np.zeros(n)
    full[off:] = vel
    a = 0.02
    mean = np.zeros(n)
    mean2 = np.zeros(n)
    mean[off], mean2[off] = full[off], full[off] ** 2
    for t in range(off + 1, n):
        mean[t] = mean[t - 1] + a * (full[t] - mean[t - 1])
        mean2[t] = mean2[t - 1] + a * (full[t] ** 2 - mean2[t - 1])
    sd = np.sqrt(np.clip(mean2 - mean ** 2, 1e-12, None))
    z = (full - mean) / sd
    z[:off + 31] = 0.0
    out[off:] = z[off:]
    return out


# ============================================================
# 4. Фибо-зоны и дивергенции
# ============================================================
def fib_zone_flags(close, highs, lows, fib_lo, fib_hi, life, lag, kind):
    """1.0, если цена в зоне ретрейсмента актуального плеча."""
    n = len(close)
    ok = np.zeros(n, dtype=bool)
    legs = []
    if kind == "long":
        for (hi_i, hi_p) in highs:
            prev = [p for p in lows if p[0] < hi_i]
            if not prev:
                continue
            lo_i, lo_p = prev[-1]
            rng = hi_p - lo_p
            if rng <= 0 or rng / lo_p < 0.008:
                continue
            legs.append((hi_i + lag, hi_i + lag + life,
                         hi_p - fib_hi * rng, hi_p - fib_lo * rng))
    else:
        for (lo_i, lo_p) in lows:
            prev = [p for p in highs if p[0] < lo_i]
            if not prev:
                continue
            hi_i, hi_p = prev[-1]
            rng = hi_p - lo_p
            if rng <= 0 or rng / lo_p < 0.008:
                continue
            legs.append((lo_i + lag, lo_i + lag + life,
                         lo_p + fib_lo * rng, lo_p + fib_hi * rng))
    legs.sort(key=lambda x: x[0])
    j, cur = 0, None
    for t in range(n):
        while j < len(legs) and legs[j][0] <= t:
            cur = legs[j]
            j += 1
        if cur is not None and t < cur[1]:
            ok[t] = cur[2] <= close[t] <= cur[3]
    return ok


def divergence_flags(pivots, rsi, lookback, lag, kind):
    """Флаги дивергенции: бычья по лоям, медвежья по хаям."""
    n = len(rsi)
    out = np.zeros(n, dtype=bool)
    for i in range(1, len(pivots)):
        i1, p1 = pivots[i - 1]
        i2, p2 = pivots[i]
        if kind == "bull":
            cond = p2 < p1 and rsi[i2] > rsi[i1] and rsi[i2] < 56
        else:
            cond = p2 > p1 and rsi[i2] < rsi[i1] and rsi[i2] > 44
        if cond:
            start = i2 + lag
            out[start:min(n, start + int(round(lookback)))] = True
    return out


# ============================================================
# 5. Стратегия FibDiv + бэктест
# ============================================================
def build_signals(c, p, allow_short, trend_filter):
    """Возвращает булевы массивы long_sig / short_sig по барам."""
    close, high, low = c["c"], c["h"], c["l"]
    n = len(close)
    ema_f = ema_series(close, int(p["ema_fast"]))
    ema_s = ema_series(close, int(p["ema_slow"]))
    rsi = rsi_wilder(close, int(p["rsi_period"]))
    mom = takens_momentum(close, int(p["takens_tau"]), int(p["takens_dim"]),
                          p["kalman_q"])
    swing = int(round(p["swing_len"]))
    lows, highs = find_pivots(high, low, swing)
    bull = divergence_flags(lows, rsi, p["div_lookback"], swing, "bull")
    bear = divergence_flags(highs, rsi, p["div_lookback"], swing, "bear")
    life = int(round(p["div_lookback"])) * 2 + 30
    zl = fib_zone_flags(close, highs, lows, p["fib_lo"], p["fib_hi"], life, swing, "long")
    zs = fib_zone_flags(close, highs, lows, p["fib_lo"], p["fib_hi"], life, swing, "short")

    long_sig = (zl & bull & (mom > p["mom_thr"]) & (rsi < p["rsi_high"]))
    short_sig = (zs & bear & (mom < -p["mom_thr"]) & (rsi > p["rsi_low"]))
    if trend_filter:
        long_sig &= ema_f > ema_s
        short_sig &= ema_f < ema_s
    if not allow_short:
        short_sig[:] = False
    return long_sig, short_sig, rsi, ema_f, ema_s, mom


def run_backtest(c, p, allow_short=True, trend_filter=True,
                 fee_pct=0.055, slip_pct=0.03, leverage=1.0,
                 funding_pct=0.01, tf_minutes=60):
    """Бэктест: вход по open следующего бара, TP/SL внутри бара.
    leverage > 1 — режим перпетуала: PnL и комиссии масштабируются,
    начисляется фандинг, при убытке ~90% маржи — ликвидация."""
    o, h, l, cl = c["o"], c["h"], c["l"], c["c"]
    n = len(cl)
    long_sig, short_sig, rsi, _, _, _ = build_signals(
        c, p, allow_short, trend_filter)
    warm = max(int(p["ema_slow"]) + 5, int(p["rsi_period"]) + 5,
               (int(p["takens_dim"]) - 1) * int(p["takens_tau"]) + 60,
               int(round(p["swing_len"])) * 2 + 5)
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
    ret_pct = (equity[-1] / 10000.0 - 1) * 100
    cagr = (max(equity[-1] / 10000.0, 1e-6) ** (ppy / n) - 1) * 100
    rets = np.diff(equity) / equity[:-1]
    sd = rets.std(ddof=1) if len(rets) > 1 else 0.0
    sharpe = float(rets.mean() / sd * math.sqrt(ppy)) if sd > 0 else 0.0
    downside = rets[rets < 0]
    dd_std = math.sqrt(float((downside ** 2).sum()) / max(len(rets), 1)) if len(downside) else 0.0
    sortino = float(rets.mean() / dd_std * math.sqrt(ppy)) if dd_std > 0 else 0.0
    peak = np.maximum.accumulate(equity)
    max_dd = float((1 - equity / peak).max())
    wins = [t for t in trades if t["pnl_pct"] > 0]
    losses = [t for t in trades if t["pnl_pct"] <= 0]
    gw = sum(t["pnl_pct"] for t in wins)
    gl = -sum(t["pnl_pct"] for t in losses)
    pf = gw / gl if gl > 0 else (99.0 if gw > 0 else 0.0)
    return {
        "return_pct": ret_pct, "cagr": cagr, "sharpe": sharpe,
        "sortino": sortino, "max_dd": max_dd,
        "win_rate": 100.0 * len(wins) / len(trades) if trades else 0.0,
        "profit_factor": pf, "trades": len(trades),
        "avg_pct": float(np.mean([t["pnl_pct"] for t in trades])) if trades else 0.0,
        "avg_win_pct": gw / len(wins) if wins else 0.0,
        "avg_loss_pct": gl / len(losses) if losses else 0.0,
    }


# ============================================================
# 6. Генетический алгоритм
# ============================================================
GENE_DEFS = [
    # key,            min,     max,    is_int, is_log
    ("rsi_period",    6,       36,     True,   False),
    ("rsi_low",       15,      42,     True,   False),
    ("rsi_high",      58,      85,     True,   False),
    ("ema_fast",      8,       60,     True,   False),
    ("ema_slow",      70,      260,    True,   False),
    ("takens_tau",    1,       12,     True,   False),
    ("takens_dim",    2,       6,      True,   False),
    ("kalman_q",      1e-5,    3e-2,   False,  True),
    ("mom_thr",       0.0,     1.6,    False,  False),
    ("div_lookback",  10,      90,     True,   False),
    ("swing_len",     3,       14,     True,   False),
    ("fib_lo",        0.20,    0.50,   False,  False),
    ("fib_hi",        0.55,    0.85,   False,  False),
    ("tp_pct",        0.6,     9.0,    False,  False),
    ("sl_pct",        0.4,     7.0,    False,  False),
]


def gene_to_u(v, d):
    _, lo, hi, _, is_log = d
    if is_log:
        return (math.log(max(v, lo)) - math.log(lo)) / (math.log(hi) - math.log(lo))
    return (v - lo) / (hi - lo)


def gene_from_u(u, d):
    _, lo, hi, is_int, is_log = d
    u = min(1.0, max(0.0, u))
    if is_log:
        v = math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo)))
    else:
        v = lo + u * (hi - lo)
    return int(round(v)) if is_int else v


def decode(g):
    p = {d[0]: g[i] for i, d in enumerate(GENE_DEFS)}
    if p["ema_fast"] >= p["ema_slow"]:
        p["ema_fast"], p["ema_slow"] = min(p["ema_fast"], p["ema_slow"] - 12), max(p["ema_slow"], p["ema_fast"] + 12)
    if p["fib_lo"] >= p["fib_hi"]:
        mid = (p["fib_lo"] + p["fib_hi"]) / 2
        p["fib_lo"], p["fib_hi"] = max(0.2, mid - 0.06), min(0.85, mid + 0.06)
    return p


def fitness_fn(m, w, min_trades):
    if m["trades"] < min_trades:
        return -25 - (min_trades - m["trades"]) * 0.8
    sh = min(6.0, max(-4.0, m["sharpe"]))
    pf = math.log(min(30.0, max(0.05, m["profit_factor"])))
    rt = min(8.0, max(-3.0, m["return_pct"] / 100.0))
    score = (w["sharpe"] * sh + w["pf"] * pf + w["ret"] * rt
             - w["dd"] * m["max_dd"] * 10 + 0.5 * math.log10(m["trades"] + 1))
    return min(60.0, max(-60.0, score))


@dataclass
class GAConfig:
    pop: int = 48
    gens: int = 30
    mut_rate: float = 0.18
    elite: int = 4
    tournament: int = 3
    seed: int = 42
    weights: dict = None

    def __post_init__(self):
        if self.weights is None:
            self.weights = {"sharpe": 1.0, "pf": 0.8, "ret": 0.6, "dd": 1.2}


def evolve(candles, tf_minutes, ga, allow_short=True, trend_filter=True,
           fee_pct=0.055, slip_pct=0.03, min_trades=8, verbose=True,
           leverage=1.0, funding_pct=0.01):
    rng = np.random.default_rng(ga.seed)
    n_genes = len(GENE_DEFS)
    pop = np.array([[gene_from_u(rng.random(), d) for d in GENE_DEFS]
                    for _ in range(ga.pop)], dtype=object)
    best_ever, best_fit = None, -1e18
    history = []

    def eval_genome(g):
        m = compute_metrics(*_bt(candles, decode(list(g)), tf_minutes,
                                 allow_short, trend_filter, fee_pct, slip_pct),
                            tf_minutes)
        return fitness_fn(m, ga.weights, min_trades), m

    def _bt(c, p, tf, ash, tfil, fee, slip):
        return run_backtest(c, p, ash, tfil, fee, slip,
                            leverage, funding_pct, tf_minutes)

    for gen in range(ga.gens):
        scored = []
        for g in pop:
            fit, m = eval_genome(g)
            scored.append((fit, g, m))
        scored.sort(key=lambda x: -x[0])
        fits = np.array([s[0] for s in scored])
        if scored[0][0] > best_fit:
            best_fit, best_ever = scored[0][0], (scored[0][1], scored[0][2])
        history.append({"gen": gen + 1, "best": float(fits[0]), "avg": float(fits.mean())})
        if verbose:
            print("gen {:3d}  best {:+8.3f}  avg {:+8.3f}  trades {:3d}  ret {:+7.2f}%".format(
                gen + 1, fits[0], fits.mean(),
                scored[0][2]["trades"], scored[0][2]["return_pct"]))
        nxt = [s[1] for s in scored[:ga.elite]]
        while len(nxt) < ga.pop:
            a = _tournament(scored, ga.tournament, rng)
            b = _tournament(scored, ga.tournament, rng)
            child = np.empty(n_genes, dtype=object)
            for i, d in enumerate(GENE_DEFS):
                r = rng.random()
                if r < 0.5:
                    child[i] = a[i]
                elif r < 0.65:
                    ua, ub = gene_to_u(float(a[i]), d), gene_to_u(float(b[i]), d)
                    lo, hi = min(ua, ub), max(ua, ub)
                    span = max(hi - lo, 0.02)
                    child[i] = gene_from_u(lo - 0.15 * span + rng.random() * span * 1.3, d)
                else:
                    child[i] = b[i]
            for i, d in enumerate(GENE_DEFS):
                if rng.random() < ga.mut_rate:
                    child[i] = gene_from_u(gene_to_u(float(child[i]), d)
                                           + rng.normal() * 0.22, d)
            nxt.append(child)
        pop = np.array(nxt, dtype=object)

    g_best, m_best = best_ever
    equity, trades = run_backtest(candles, decode(list(g_best)), allow_short,
                                  trend_filter, fee_pct, slip_pct,
                                  leverage, funding_pct, tf_minutes)
    return {"genome": {d[0]: g_best[i] for i, d in enumerate(GENE_DEFS)},
            "params": decode(list(g_best)), "metrics": m_best,
            "history": history, "trades": trades}


def _tournament(scored, k, rng):
    picks = [scored[i] for i in rng.integers(0, len(scored), k)]
    return max(picks, key=lambda x: x[0])[1]


# ============================================================
# 7. CLI
# ============================================================
def main():
    ap = argparse.ArgumentParser(description="QuantEvo GA-трейдер Bybit")
    ap.add_argument("--symbol", default="ETHUSDT", help="Торговая пара, например BTCUSDT")
    ap.add_argument("--interval", type=int, default=60,
                    choices=[1, 3, 5, 15, 30, 60, 120, 240, 360, 720, 1440, 10080],
                    help="Минуты: 1..720, 1440=1Д, 10080=1Н (основные 60/240)")
    ap.add_argument("--category", default="spot", choices=["spot", "linear"],
                    help="spot или USDT-перпетуал (плечо)")
    ap.add_argument("--leverage", type=float, default=1.0,
                    help="Кредитное плечо (только --category linear)")
    ap.add_argument("--funding", type=float, default=0.01,
                    help="Фандинг %% за 8 часов (linear)")
    ap.add_argument("--import-params", default="",
                    help="JSON с геномом (экспорт веб-лаборатории): бэктест без GA")
    ap.add_argument("--days", type=int, default=365, help="Глубина истории")
    ap.add_argument("--pop", type=int, default=48, help="Размер популяции")
    ap.add_argument("--gens", type=int, default=30, help="Число поколений")
    ap.add_argument("--mut", type=float, default=0.18, help="Вероятность мутации")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--allow-short", action="store_true", help="Разрешить шорты")
    ap.add_argument("--no-trend-filter", action="store_true")
    ap.add_argument("--fee", type=float, default=0.055, help="Комиссия %% за сторону")
    ap.add_argument("--out", default="best_params.json")
    ap.add_argument("--live", action="store_true", help="Live-режим (осторожно!)")
    ap.add_argument("--api-key", default="")
    ap.add_argument("--api-secret", default="")
    args = ap.parse_args()

    client = BybitClient(args.api_key, args.api_secret)
    lev = max(1.0, args.leverage) if args.category == "linear" else 1.0
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
                                      0.03, lev, args.funding, args.interval)
        m = compute_metrics(equity, trades, args.interval)
        result = {"genome": p_in, "params": p_in, "metrics": m,
                  "history": [], "trades": trades}
        print("Импортирован геном из " + args.import_params)
    else:
        ga = GAConfig(pop=args.pop, gens=args.gens, mut_rate=args.mut,
                      seed=args.seed)
        result = evolve(candles, args.interval, ga,
                        allow_short=args.allow_short,
                        trend_filter=not args.no_trend_filter,
                        fee_pct=args.fee, leverage=lev,
                        funding_pct=args.funding)

    m = result["metrics"]
    print("")
    print("================ ЛУЧШИЙ ГЕНОМ ================")
    for k, v in result["genome"].items():
        print("  {:<14s} {}".format(k, v))
    print("==============================================")
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
                   "genome": {k: (float(v) if isinstance(v, (int, float, np.floating)) else v)
                              for k, v in result["genome"].items()},
                   "metrics": m}, f, indent=2, ensure_ascii=False)
    print("Сохранено в " + args.out)

    if args.live:
        if not args.api_key or not args.api_secret:
            raise SystemExit("Для --live нужны --api-key и --api-secret")
        print("LIVE-режим: следим за сигналами (Ctrl+C для выхода)...")
        long_sig, short_sig, *_ = build_signals(
            candles, result["params"], args.allow_short,
            not args.no_trend_filter)
        while True:
            time.sleep(args.interval * 60)
            candles = client.fetch_klines(args.symbol, args.interval, 60,
                                          args.category)
            long_sig, short_sig, *_ = build_signals(
                candles, result["params"], args.allow_short,
                not args.no_trend_filter)
            if long_sig[-2]:
                print("СИГНАЛ LONG по " + args.symbol)
            elif short_sig[-2]:
                print("СИГНАЛ SHORT по " + args.symbol)


if __name__ == "__main__":
    main()
`;

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text)
    );
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function downloadPython(): void {
  const blob = new Blob([PYTHON_SOURCE], { type: "text/x-python;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = PYTHON_FILENAME;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
