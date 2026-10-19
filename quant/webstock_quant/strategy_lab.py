from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import numpy as np
import pandas as pd


MAIN_BOARD_PREFIXES = ("000", "001", "002", "003", "600", "601", "603", "605")
STRATEGY_RULES = {
    "moving-average-crossover": {
        "label": "均线交叉",
        "entryRule": "short MA crosses above long MA at close; buy next executable open",
        "exitRule": "short MA crosses below long MA at close; sell next executable open after T+1",
    },
    "macd-crossover": {
        "label": "MACD交叉",
        "entryRule": "MACD line crosses above signal line at close; buy next executable open",
        "exitRule": "MACD line crosses below signal line at close; sell next executable open after T+1",
    },
    "rsi-rebound": {
        "label": "RSI超卖反弹",
        "entryRule": "RSI crosses upward through the oversold threshold; buy next executable open",
        "exitRule": "RSI reaches the exit threshold; sell next executable open after T+1",
    },
    "volume-breakout": {
        "label": "放量突破",
        "entryRule": "close breaks the prior N-day high with required volume; buy next executable open",
        "exitRule": "close crosses below the N-day moving average; sell next executable open after T+1",
    },
    "low-position-volume-stagnation": {
        "label": "低位放量滞涨",
        "entryRule": "daily close meets low-position, high-volume, low-return, bounded-range and close-quality conditions; observe no earlier than next executable open",
        "exitRule": "close crosses below the volume-window moving average after T+1; signal-day low remains the research invalidation reference",
    },
}


@dataclass(frozen=True)
class ExecutionAssumptions:
    commission_bps: float = 2.5
    minimum_commission: float = 5.0
    stamp_duty_bps: float = 5.0
    slippage_bps: float = 2.0
    capital_per_symbol: float = 100_000.0
    board_lot: int = 100
    price_limit_rate: float = 0.10
    t_plus_one: bool = True

    def to_contract(self):
        value = asdict(self)
        return {
            "commissionBps": float(value["commission_bps"]),
            "minimumCommission": float(value["minimum_commission"]),
            "stampDutyBps": float(value["stamp_duty_bps"]),
            "slippageBps": float(value["slippage_bps"]),
            "capitalPerSymbol": float(value["capital_per_symbol"]),
            "boardLot": int(value["board_lot"]),
            "priceLimitRate": float(value["price_limit_rate"]),
            "tPlusOne": bool(value["t_plus_one"]),
            "signalTiming": "close-signal-next-open-execution",
            "suspensionPolicy": "zero-volume-or-missing-session-not-executable",
        }


def _normalise_code(value):
    digits = "".join(character for character in str(value or "") if character.isdigit())
    return digits[-6:].zfill(6) if digits else ""


def is_main_board_code(value):
    code = _normalise_code(value)
    return len(code) == 6 and code.startswith(MAIN_BOARD_PREFIXES)


def filter_main_board_panel(panel):
    required = {"date", "code", "name", "open", "high", "low", "close", "volume"}
    missing = required.difference(panel.columns)
    if missing:
        raise ValueError("missing panel columns: " + ", ".join(sorted(missing)))

    frame = panel.copy()
    frame["code"] = frame["code"].map(_normalise_code)
    frame["name"] = frame["name"].fillna("").astype(str)
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in ("open", "high", "low", "close", "volume"):
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame.dropna(subset=["date", "open", "high", "low", "close", "volume"])

    requested_codes = set(frame["code"])
    board_codes = {code for code in requested_codes if is_main_board_code(code)}
    st_codes = set(frame.loc[
        frame["name"].str.upper().str.contains("ST", regex=False), "code"
    ]).intersection(board_codes)
    included_codes = board_codes.difference(st_codes)
    board_frame = frame[frame["code"].isin(included_codes)].copy()
    suspended_rows = int((board_frame["volume"] <= 0).sum())
    board_frame = board_frame[
        (board_frame["open"] > 0)
        & (board_frame["high"] > 0)
        & (board_frame["low"] > 0)
        & (board_frame["close"] > 0)
    ].sort_values(["code", "date"], kind="stable").reset_index(drop=True)

    return board_frame, {
        "requested": len(requested_codes),
        "included": len(set(board_frame["code"])),
        "excludedByBoard": len(requested_codes.difference(board_codes)),
        "excludedSt": len(st_codes),
        "suspendedRows": suspended_rows,
        "policy": "main-board-a-share-ex-st",
    }


def generate_parameter_grid(short_windows, long_windows):
    shorts = sorted({int(value) for value in short_windows if int(value) > 0})
    longs = sorted({int(value) for value in long_windows if int(value) > 0})
    grid = [(short, long) for short in shorts for long in longs if short < long]
    if not grid:
        raise ValueError("at least one moving-average pair must satisfy short < long")
    if len(grid) > 64:
        raise ValueError("moving-average rule card is limited to 64 parameter combinations")
    return grid


def _unique_positive_integers(values, field):
    parsed = sorted({int(value) for value in values if int(value) > 0})
    if not parsed:
        raise ValueError(f"{field} must contain a positive integer")
    return parsed


def _unique_positive_numbers(values, field):
    parsed = sorted({float(value) for value in values if float(value) > 0})
    if not parsed:
        raise ValueError(f"{field} must contain a positive number")
    return parsed


def _display_number(value):
    number = float(value)
    return str(int(number)) if number.is_integer() else format(number, "g")


def _bounded_strategy_grid(grid):
    if not grid:
        raise ValueError("strategy rule card has no valid parameter combinations")
    if len(grid) > 64:
        raise ValueError("strategy rule card is limited to 64 parameter combinations")
    return grid


def generate_strategy_parameter_grid(
    strategy_family,
    short_windows=(5, 10, 20),
    long_windows=(20, 40, 60),
    fast_windows=(8, 12),
    slow_windows=(26,),
    signal_windows=(9,),
    rsi_periods=(6, 14),
    entry_thresholds=(30,),
    exit_thresholds=(70,),
    breakout_windows=(20, 40),
    volume_multipliers=(1.5, 2.0),
    breakout_margins=(0.005,),
    breakout_min_close_locations=(0.7,),
    position_lookback_windows=(120,),
    max_range_positions=(0.35,),
    volume_windows=(20,),
    max_abs_returns=(0.02,),
    max_intraday_ranges=(0.06,),
    min_close_locations=(0.5,),
):
    family = str(strategy_family or "moving-average-crossover")
    if family == "moving-average-crossover":
        return [{
            "strategyFamily": family,
            "parameterId": f"ma-{short}-{long}",
            "label": f"MA{short} / MA{long}",
            "settings": {"shortWindow": short, "longWindow": long},
            "warmup": long + 1,
        } for short, long in generate_parameter_grid(short_windows, long_windows)]
    if family == "macd-crossover":
        fasts = _unique_positive_integers(fast_windows, "fast windows")
        slows = _unique_positive_integers(slow_windows, "slow windows")
        signals = _unique_positive_integers(signal_windows, "signal windows")
        return _bounded_strategy_grid([{
            "strategyFamily": family,
            "parameterId": f"macd-{fast}-{slow}-{signal}",
            "label": f"MACD {fast}/{slow}/{signal}",
            "settings": {"fastWindow": fast, "slowWindow": slow, "signalWindow": signal},
            "warmup": slow + signal,
        } for fast in fasts for slow in slows for signal in signals if fast < slow])
    if family == "rsi-rebound":
        periods = _unique_positive_integers(rsi_periods, "RSI periods")
        entries = _unique_positive_integers(entry_thresholds, "RSI entry thresholds")
        exits = _unique_positive_integers(exit_thresholds, "RSI exit thresholds")
        return _bounded_strategy_grid([{
            "strategyFamily": family,
            "parameterId": f"rsi-{period}-{entry}-{exit_value}",
            "label": f"RSI {period} · {entry}/{exit_value}",
            "settings": {"rsiPeriod": period, "entryThreshold": entry, "exitThreshold": exit_value},
            "warmup": period + 1,
        } for period in periods for entry in entries for exit_value in exits if entry < exit_value <= 100])
    if family == "volume-breakout":
        windows = _unique_positive_integers(breakout_windows, "breakout windows")
        multipliers = _unique_positive_numbers(volume_multipliers, "volume multipliers")
        margins = _unique_positive_numbers(breakout_margins, "breakout margins")
        close_locations = _unique_positive_numbers(
            breakout_min_close_locations, "breakout minimum close locations"
        )
        return _bounded_strategy_grid([{
            "strategyFamily": family,
            "parameterId": "breakout-{}-{}-{}-{}".format(
                window,
                _display_number(multiplier),
                _display_number(margin),
                _display_number(close_location),
            ),
            "label": f"{window}日放量突破 · {_display_number(multiplier)}倍",
            "settings": {
                "breakoutWindow": window,
                "volumeMultiplier": multiplier,
                "breakoutMargin": margin,
                "minCloseLocation": close_location,
            },
            "warmup": window + 1,
        } for window in windows for multiplier in multipliers for margin in margins
          for close_location in close_locations
          if multiplier >= 1.0 and 0 < margin <= 1 and 0 < close_location <= 1])
    if family == "low-position-volume-stagnation":
        lookbacks = _unique_positive_integers(position_lookback_windows, "position lookback windows")
        positions = _unique_positive_numbers(max_range_positions, "maximum range positions")
        volume_periods = _unique_positive_integers(volume_windows, "volume windows")
        multipliers = _unique_positive_numbers(volume_multipliers, "volume multipliers")
        returns = _unique_positive_numbers(max_abs_returns, "maximum absolute returns")
        ranges = _unique_positive_numbers(max_intraday_ranges, "maximum intraday ranges")
        close_locations = _unique_positive_numbers(min_close_locations, "minimum close locations")
        grid = []
        for lookback in lookbacks:
            for position in positions:
                for volume_window in volume_periods:
                    for multiplier in multipliers:
                        for max_return in returns:
                            for max_range in ranges:
                                for close_location in close_locations:
                                    if not (0 < position <= 1 and multiplier >= 1 and 0 < max_return <= 1
                                            and 0 < max_range <= 1 and 0 < close_location <= 1):
                                        continue
                                    grid.append({
                                        "strategyFamily": family,
                                        "parameterId": "stagnation-{}-{}-{}-{}-{}-{}-{}".format(
                                            lookback,
                                            _display_number(position),
                                            volume_window,
                                            _display_number(multiplier),
                                            _display_number(max_return),
                                            _display_number(max_range),
                                            _display_number(close_location),
                                        ),
                                        "label": f"{lookback}日低位放量滞涨 · {_display_number(multiplier)}倍量",
                                        "settings": {
                                            "positionLookbackWindow": lookback,
                                            "maxRangePosition": position,
                                            "volumeWindow": volume_window,
                                            "volumeMultiplier": multiplier,
                                            "maxAbsReturn": max_return,
                                            "maxIntradayRange": max_range,
                                            "minCloseLocation": close_location,
                                        },
                                        "warmup": max(lookback, volume_window) + 1,
                                    })
        return _bounded_strategy_grid(grid)
    raise ValueError("unsupported strategy family")


def select_bounded_liquid_universe(panel, eligible_codes, training_end, max_instruments):
    limit = int(max_instruments)
    if limit < 1:
        raise ValueError("max_instruments must be positive")
    cutoff = pd.Timestamp(training_end)
    frame = panel[
        panel["code"].astype(str).isin({str(code) for code in eligible_codes})
        & (pd.to_datetime(panel["date"], errors="coerce") <= cutoff)
    ].copy()
    frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce")
    frame = frame.dropna(subset=["volume"])
    if frame.empty:
        return []
    ranking = frame.groupby("code", sort=False).agg(
        coverage=("date", "count"),
        medianVolume=("volume", "median"),
    ).reset_index()
    ranking["code"] = ranking["code"].astype(str)
    ranking = ranking.sort_values(
        ["coverage", "medianVolume", "code"],
        ascending=[False, False, True],
        kind="stable",
    )
    return ranking.head(limit)["code"].tolist()


def _prepare_ma_signals(panel, short_window, long_window):
    data = panel.sort_values(["code", "date"], kind="stable").copy()
    grouped_close = data.groupby("code", sort=False)["close"]
    data["shortMa"] = grouped_close.transform(
        lambda values: values.rolling(int(short_window), min_periods=int(short_window)).mean()
    )
    data["longMa"] = grouped_close.transform(
        lambda values: values.rolling(int(long_window), min_periods=int(long_window)).mean()
    )
    data["bullish"] = data["shortMa"] > data["longMa"]
    previous = data.groupby("code", sort=False)["bullish"].shift(1, fill_value=False)
    data["crossUp"] = data["bullish"] & ~previous
    data["crossDown"] = ~data["bullish"] & previous
    data["entrySignal"] = data["crossUp"]
    data["exitSignal"] = data["crossDown"]
    return data


def _prepare_macd_signals(panel, fast_window, slow_window, signal_window):
    data = panel.sort_values(["code", "date"], kind="stable").copy()
    grouped_close = data.groupby("code", sort=False)["close"]
    data["fastEma"] = grouped_close.transform(
        lambda values: values.ewm(span=int(fast_window), adjust=False, min_periods=int(slow_window)).mean()
    )
    data["slowEma"] = grouped_close.transform(
        lambda values: values.ewm(span=int(slow_window), adjust=False, min_periods=int(slow_window)).mean()
    )
    data["macdLine"] = data["fastEma"] - data["slowEma"]
    data["signalLine"] = data.groupby("code", sort=False)["macdLine"].transform(
        lambda values: values.ewm(span=int(signal_window), adjust=False, min_periods=int(signal_window)).mean()
    )
    bullish = data["macdLine"] > data["signalLine"]
    previous = bullish.groupby(data["code"], sort=False).shift(1, fill_value=False)
    data["entrySignal"] = bullish & ~previous
    data["exitSignal"] = ~bullish & previous
    data["crossUp"] = data["entrySignal"]
    data["crossDown"] = data["exitSignal"]
    return data


def _prepare_rsi_signals(panel, period, entry_threshold, exit_threshold):
    data = panel.sort_values(["code", "date"], kind="stable").copy()
    delta = data.groupby("code", sort=False)["close"].diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    data["avgGain"] = gain.groupby(data["code"], sort=False).transform(
        lambda values: values.rolling(int(period), min_periods=int(period)).mean()
    )
    data["avgLoss"] = loss.groupby(data["code"], sort=False).transform(
        lambda values: values.rolling(int(period), min_periods=int(period)).mean()
    )
    relative_strength = data["avgGain"] / data["avgLoss"].replace(0, np.nan)
    data["rsi"] = 100.0 - (100.0 / (1.0 + relative_strength))
    data.loc[(data["avgLoss"] == 0) & (data["avgGain"] > 0), "rsi"] = 100.0
    previous = data.groupby("code", sort=False)["rsi"].shift(1)
    data["entrySignal"] = (previous <= float(entry_threshold)) & (data["rsi"] > float(entry_threshold))
    data["exitSignal"] = (previous < float(exit_threshold)) & (data["rsi"] >= float(exit_threshold))
    data["crossUp"] = data["entrySignal"]
    data["crossDown"] = data["exitSignal"]
    return data


def _prepare_volume_breakout_signals(
    panel, window, volume_multiplier, breakout_margin=0.005, min_close_location=0.7
):
    data = panel.sort_values(["code", "date"], kind="stable").copy()
    grouped_close = data.groupby("code", sort=False)["close"]
    grouped_high = data.groupby("code", sort=False)["high"]
    grouped_volume = data.groupby("code", sort=False)["volume"]
    data["priorHigh"] = grouped_high.transform(
        lambda values: values.shift(1).rolling(int(window), min_periods=int(window)).max()
    )
    data["priorAverageVolume"] = grouped_volume.transform(
        lambda values: values.shift(1).rolling(int(window), min_periods=int(window)).mean()
    )
    data["exitMa"] = grouped_close.transform(
        lambda values: values.rolling(int(window), min_periods=int(window)).mean()
    )
    previous_close = grouped_close.shift(1)
    previous_ma = data.groupby("code", sort=False)["exitMa"].shift(1)
    data["volumeRatio"] = data["volume"] / data["priorAverageVolume"].replace(0, np.nan)
    data["breakoutPercent"] = data["close"] / data["priorHigh"].replace(0, np.nan) - 1.0
    day_range = (data["high"] - data["low"]).replace(0, np.nan)
    data["closeLocation"] = (data["close"] - data["low"]) / day_range
    data["entrySignal"] = (
        (data["breakoutPercent"] >= float(breakout_margin))
        & (data["volumeRatio"] >= float(volume_multiplier))
        & (data["closeLocation"] >= float(min_close_location))
    )
    data["exitSignal"] = (previous_close >= previous_ma) & (data["close"] < data["exitMa"])
    data["crossUp"] = data["entrySignal"]
    data["crossDown"] = data["exitSignal"]
    return data


def _prepare_low_position_volume_stagnation_signals(
    panel,
    position_lookback_window,
    max_range_position,
    volume_window,
    volume_multiplier,
    max_abs_return,
    max_intraday_range,
    min_close_location,
):
    data = panel.sort_values(["code", "date"], kind="stable").copy()
    grouped_close = data.groupby("code", sort=False)["close"]
    grouped_high = data.groupby("code", sort=False)["high"]
    grouped_low = data.groupby("code", sort=False)["low"]
    grouped_volume = data.groupby("code", sort=False)["volume"]
    lookback = int(position_lookback_window)
    volume_period = int(volume_window)
    data["rangeHigh"] = grouped_high.transform(
        lambda values: values.rolling(lookback, min_periods=lookback).max()
    )
    data["rangeLow"] = grouped_low.transform(
        lambda values: values.rolling(lookback, min_periods=lookback).min()
    )
    price_range = (data["rangeHigh"] - data["rangeLow"]).replace(0, np.nan)
    data["rangePosition"] = (data["close"] - data["rangeLow"]) / price_range
    data["priorAverageVolume"] = grouped_volume.transform(
        lambda values: values.shift(1).rolling(volume_period, min_periods=volume_period).mean()
    )
    data["volumeRatio"] = data["volume"] / data["priorAverageVolume"].replace(0, np.nan)
    previous_close = grouped_close.shift(1)
    data["dailyReturn"] = data["close"] / previous_close.replace(0, np.nan) - 1.0
    data["intradayRange"] = (data["high"] - data["low"]) / data["close"].replace(0, np.nan)
    day_range = (data["high"] - data["low"]).replace(0, np.nan)
    data["closeLocation"] = (data["close"] - data["low"]) / day_range
    data["exitMa"] = grouped_close.transform(
        lambda values: values.rolling(volume_period, min_periods=volume_period).mean()
    )
    previous_ma = data.groupby("code", sort=False)["exitMa"].shift(1)
    data["entrySignal"] = (
        (data["rangePosition"] <= float(max_range_position))
        & (data["volumeRatio"] >= float(volume_multiplier))
        & (data["dailyReturn"].abs() <= float(max_abs_return))
        & (data["intradayRange"] <= float(max_intraday_range))
        & (data["closeLocation"] >= float(min_close_location))
        & (data["volume"] > 0)
    )
    data["exitSignal"] = (previous_close >= previous_ma) & (data["close"] < data["exitMa"])
    data["crossUp"] = data["entrySignal"]
    data["crossDown"] = data["exitSignal"]
    return data


def prepare_strategy_signals(panel, parameter):
    family = parameter.get("strategyFamily")
    settings = parameter.get("settings") or {}
    if family == "moving-average-crossover":
        return _prepare_ma_signals(panel, settings["shortWindow"], settings["longWindow"])
    if family == "macd-crossover":
        return _prepare_macd_signals(
            panel, settings["fastWindow"], settings["slowWindow"], settings["signalWindow"]
        )
    if family == "rsi-rebound":
        return _prepare_rsi_signals(
            panel, settings["rsiPeriod"], settings["entryThreshold"], settings["exitThreshold"]
        )
    if family == "volume-breakout":
        return _prepare_volume_breakout_signals(
            panel,
            settings["breakoutWindow"],
            settings["volumeMultiplier"],
            settings.get("breakoutMargin", 0.005),
            settings.get("minCloseLocation", 0.7),
        )
    if family == "low-position-volume-stagnation":
        return _prepare_low_position_volume_stagnation_signals(
            panel,
            settings["positionLookbackWindow"],
            settings["maxRangePosition"],
            settings["volumeWindow"],
            settings["volumeMultiplier"],
            settings["maxAbsReturn"],
            settings["maxIntradayRange"],
            settings["minCloseLocation"],
        )
    raise ValueError("unsupported strategy family")


def _candidate_signal_rules(strategy_family):
    if strategy_family == "low-position-volume-stagnation":
        return (
            "未来3个交易日收盘突破信号日最高价，且未先跌破信号日最低价",
            "收盘跌破信号日最低价或放量继续下跌",
        )
    if strategy_family == "volume-breakout":
        return (
            "下一交易日仍站在此前高点上方，且成交未明显萎缩",
            "收盘重新跌回此前高点下方或跌破信号日最低价",
        )
    return (
        "下一可成交日开盘后再观察规则是否仍成立",
        "规则产生退出信号或价格触发既定退出条件",
    )


def _candidate_signal_evidence(row, strategy_family):
    fields = {
        "moving-average-crossover": ("close", "shortMa", "longMa"),
        "macd-crossover": ("close", "macd", "signalLine"),
        "rsi-rebound": ("close", "rsi"),
        "volume-breakout": (
            "close", "high", "low", "volume", "priorHigh", "breakoutPercent", "volumeRatio", "closeLocation",
        ),
        "low-position-volume-stagnation": (
            "close", "high", "low", "volume", "rangeHigh", "rangeLow", "rangePosition", "volumeRatio",
            "dailyReturn", "intradayRange", "closeLocation",
        ),
    }.get(strategy_family, ("close",))
    evidence = {"signalDate": pd.Timestamp(row["date"]).strftime("%Y-%m-%d")}
    for field in fields:
        if field in row.index:
            evidence[field] = _finite(row[field])
    return evidence


def collect_current_signal_candidates(panel, parameter_results, max_candidates=200, max_parameters=12):
    latest_date = pd.Timestamp(panel["date"].max()) if not panel.empty else None
    admitted = [
        parameter for parameter in parameter_results
        if parameter.get("admission") in {"stable", "watch"}
    ]
    admitted.sort(key=lambda parameter: (
        1 if parameter.get("admission") == "stable" else 0,
        _finite((parameter.get("metrics") or {}).get("positiveFoldRate", 0.0)),
        _finite((parameter.get("metrics") or {}).get("meanOosReturn", 0.0)),
        str(parameter.get("parameterId") or ""),
    ), reverse=True)
    parameter_limit = min(max(int(max_parameters), 1), 12)
    scanned_parameters = admitted[:parameter_limit]
    by_code = {}
    for parameter in scanned_parameters:
        prepared = prepare_strategy_signals(panel, parameter)
        current = prepared[
            (prepared["date"] == latest_date) & prepared["entrySignal"].fillna(False)
        ]
        metrics = parameter.get("metrics") or {}
        evidence_base = {
            "parameterId": str(parameter["parameterId"]),
            "label": str(parameter.get("label") or parameter["parameterId"]),
            "admission": str(parameter["admission"]),
            "positiveFoldRate": _finite(metrics.get("positiveFoldRate", 0.0)),
            "meanOosReturn": _finite(metrics.get("meanOosReturn", 0.0)),
            "medianOosReturn": _finite(metrics.get("medianOosReturn", 0.0)),
            "thresholds": {
                str(name): _finite(value)
                for name, value in (parameter.get("settings") or {}).items()
            },
        }
        confirmation_rule, invalidation_rule = _candidate_signal_rules(parameter["strategyFamily"])
        for _, row in current.iterrows():
            code = str(row["code"])
            evidence = dict(evidence_base)
            evidence["signalEvidence"] = _candidate_signal_evidence(row, parameter["strategyFamily"])
            candidate = by_code.setdefault(code, {
                "code": code,
                "name": str(row["name"]),
                "signalDate": latest_date.strftime("%Y-%m-%d"),
                "strategyFamily": str(parameter["strategyFamily"]),
                "confirmationRule": confirmation_rule,
                "invalidationRule": invalidation_rule,
                "parameterIds": [],
                "admissions": [],
                "evidence": [],
            })
            candidate["parameterIds"].append(evidence["parameterId"])
            candidate["admissions"].append(evidence["admission"])
            candidate["evidence"].append(evidence)

    candidates = []
    for candidate in by_code.values():
        candidate["parameterIds"] = sorted(set(candidate["parameterIds"]))
        candidate["admissions"] = sorted(set(candidate["admissions"]), key=lambda value: value != "stable")
        candidate["candidateStatus"] = "stable" if "stable" in candidate["admissions"] else "watch"
        candidate["evidence"].sort(key=lambda item: (
            item["admission"] != "stable", -item["positiveFoldRate"], -item["meanOosReturn"], item["parameterId"]
        ))
        candidates.append(candidate)
    candidates.sort(key=lambda candidate: (
        candidate["candidateStatus"] != "stable",
        -len(candidate["parameterIds"]),
        candidate["code"],
    ))
    candidate_limit = min(max(int(max_candidates), 1), 200)
    stored = candidates[:candidate_limit]
    return {
        "asOf": latest_date.strftime("%Y-%m-%d") if latest_date is not None else "",
        "earliestObservation": "next-executable-open",
        "admissionPolicy": "stable-or-watch-only",
        "universeScanned": int(panel["code"].nunique()) if not panel.empty else 0,
        "eligibleParameterCount": len(admitted),
        "scannedParameterCount": len(scanned_parameters),
        "parameterScanTruncated": len(admitted) > len(scanned_parameters),
        "candidateCount": len(candidates),
        "storedCount": len(stored),
        "truncated": len(candidates) > len(stored),
        "candidates": stored,
    }


def _limit_price(previous_close, rate, direction):
    multiplier = Decimal("1") + (Decimal(str(rate)) * Decimal(str(direction)))
    return float((Decimal(str(previous_close)) * multiplier).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _commission(gross_value, assumptions):
    if gross_value <= 0:
        return 0.0
    variable = gross_value * max(float(assumptions.commission_bps), 0.0) / 10000.0
    return max(variable, max(float(assumptions.minimum_commission), 0.0))


def _estimated_exit_value(shares, close, assumptions):
    if shares <= 0:
        return 0.0
    price = float(close) * (1.0 - max(float(assumptions.slippage_bps), 0.0) / 10000.0)
    gross = shares * price
    tax = gross * max(float(assumptions.stamp_duty_bps), 0.0) / 10000.0
    return gross - _commission(gross, assumptions) - tax


def _max_drawdown(equity_values):
    if not equity_values:
        return 0.0
    values = np.asarray(equity_values, dtype=float)
    peaks = np.maximum.accumulate(values)
    return float(np.min(values / np.where(peaks > 0, peaks, 1.0) - 1.0))


def _simulate_single_symbol(frame, short_window, long_window, start_date, end_date, assumptions):
    if {"crossUp", "crossDown"}.issubset(frame.columns):
        data = frame
    else:
        data = _prepare_ma_signals(frame, short_window, long_window)

    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    eligible_indices = data.index[(data["date"] >= start) & (data["date"] <= end)].tolist()
    initial_capital = max(float(assumptions.capital_per_symbol), 1.0)
    cash = initial_capital
    shares = 0
    buy_date = None
    buy_outlay = 0.0
    pending_sell = False
    blocked_buys = 0
    blocked_sells = 0
    buy_count = 0
    sell_count = 0
    trades = []
    equity = []

    for index in eligible_indices:
        row = data.loc[index]
        previous_index = data.index.get_loc(index) - 1
        previous = data.iloc[previous_index] if previous_index >= 0 else None
        if previous is not None and shares > 0 and bool(previous["crossDown"]):
            pending_sell = True

        if shares > 0 and pending_sell:
            can_sell_t1 = not assumptions.t_plus_one or pd.Timestamp(row["date"]) > pd.Timestamp(buy_date)
            suspended = float(row["volume"]) <= 0
            lower_limit = _limit_price(previous["close"], assumptions.price_limit_rate, -1) if previous is not None else -np.inf
            limit_blocked = previous is not None and float(row["open"]) <= lower_limit + 1e-9
            if not can_sell_t1 or suspended or limit_blocked:
                blocked_sells += 1
            else:
                execution_price = float(row["open"]) * (1.0 - max(float(assumptions.slippage_bps), 0.0) / 10000.0)
                gross = shares * execution_price
                sell_cost = _commission(gross, assumptions) + gross * max(float(assumptions.stamp_duty_bps), 0.0) / 10000.0
                proceeds = gross - sell_cost
                cash += proceeds
                trades.append({
                    "buyDate": pd.Timestamp(buy_date).strftime("%Y-%m-%d"),
                    "sellDate": pd.Timestamp(row["date"]).strftime("%Y-%m-%d"),
                    "shares": int(shares),
                    "netPnl": float(proceeds - buy_outlay),
                })
                shares = 0
                buy_date = None
                buy_outlay = 0.0
                pending_sell = False
                sell_count += 1

        if shares == 0 and previous is not None and bool(previous["crossUp"]):
            suspended = float(row["volume"]) <= 0
            upper_limit = _limit_price(previous["close"], assumptions.price_limit_rate, 1)
            limit_blocked = float(row["open"]) >= upper_limit - 1e-9
            if suspended or limit_blocked:
                blocked_buys += 1
            else:
                execution_price = float(row["open"]) * (1.0 + max(float(assumptions.slippage_bps), 0.0) / 10000.0)
                board_lot = max(int(assumptions.board_lot), 1)
                candidate = int(cash / execution_price / board_lot) * board_lot
                while candidate > 0:
                    gross = candidate * execution_price
                    cost = _commission(gross, assumptions)
                    if gross + cost <= cash + 1e-9:
                        break
                    candidate -= board_lot
                if candidate > 0:
                    gross = candidate * execution_price
                    cost = _commission(gross, assumptions)
                    cash -= gross + cost
                    shares = candidate
                    buy_date = pd.Timestamp(row["date"])
                    buy_outlay = gross + cost
                    buy_count += 1

        marked_value = cash + _estimated_exit_value(shares, row["close"], assumptions)
        equity.append(marked_value)

    final_equity = equity[-1] if equity else initial_capital
    realised_wins = sum(1 for trade in trades if trade["netPnl"] > 0)
    return {
        "netReturn": float(final_equity / initial_capital - 1.0),
        "maxDrawdown": _max_drawdown(equity),
        "tradeCount": int(sell_count),
        "winRate": float(realised_wins / sell_count) if sell_count else 0.0,
        "buyCount": int(buy_count),
        "sellCount": int(sell_count),
        "blockedBuys": int(blocked_buys),
        "blockedSells": int(blocked_sells),
        "unclosedPositions": int(shares > 0),
        "trades": trades,
        "equity": equity,
    }


def simulate_ma_parameter(panel, short_window, long_window, start_date, end_date, assumptions=None):
    if int(short_window) >= int(long_window):
        raise ValueError("short moving average must be smaller than long moving average")
    prepared = panel if {"crossUp", "crossDown"}.issubset(panel.columns) else _prepare_ma_signals(
        panel, int(short_window), int(long_window)
    )
    return simulate_prepared_parameter(prepared, start_date, end_date, assumptions)


def simulate_prepared_parameter(panel, start_date, end_date, assumptions=None):
    if not {"crossUp", "crossDown"}.issubset(panel.columns):
        raise ValueError("prepared strategy panel is missing entry or exit signals")
    assumptions = assumptions or ExecutionAssumptions()
    results = [
        _simulate_single_symbol(group, 1, 2, start_date, end_date, assumptions)
        for _, group in panel.groupby("code", sort=True)
    ]
    if not results:
        return {
            "netReturn": 0.0, "maxDrawdown": 0.0, "tradeCount": 0, "winRate": 0.0,
            "buyCount": 0, "sellCount": 0, "blockedBuys": 0, "blockedSells": 0,
            "unclosedPositions": 0, "trades": [],
        }
    trade_count = sum(result["tradeCount"] for result in results)
    wins = sum(sum(1 for trade in result["trades"] if trade["netPnl"] > 0) for result in results)
    return {
        "netReturn": float(np.mean([result["netReturn"] for result in results])),
        "maxDrawdown": float(min(result["maxDrawdown"] for result in results)),
        "tradeCount": int(trade_count),
        "winRate": float(wins / trade_count) if trade_count else 0.0,
        "buyCount": int(sum(result["buyCount"] for result in results)),
        "sellCount": int(sum(result["sellCount"] for result in results)),
        "blockedBuys": int(sum(result["blockedBuys"] for result in results)),
        "blockedSells": int(sum(result["blockedSells"] for result in results)),
        "unclosedPositions": int(sum(result["unclosedPositions"] for result in results)),
        "trades": [trade for result in results for trade in result["trades"]],
    }


def summarize_parameter_stability(fold_results):
    returns = [float(result.get("netReturn") or 0.0) for result in fold_results]
    trade_count = sum(int(result.get("tradeCount") or 0) for result in fold_results)
    fold_count = len(returns)
    positive_rate = float(np.mean([value > 0 for value in returns])) if returns else 0.0
    mean_return = float(np.mean(returns)) if returns else 0.0
    median_return = float(np.median(returns)) if returns else 0.0
    worst_return = float(min(returns)) if returns else 0.0
    max_drawdown = float(min([float(result.get("maxDrawdown") or 0.0) for result in fold_results], default=0.0))
    wins = sum(float(result.get("winRate") or 0.0) * int(result.get("tradeCount") or 0) for result in fold_results)
    win_rate = float(wins / trade_count) if trade_count else 0.0
    reasons = []
    if fold_count < 3:
        reasons.append("样本外窗口少于3个")
    if positive_rate < 0.6:
        reasons.append("正收益窗口占比低于60%")
    if median_return <= 0:
        reasons.append("样本外收益中位数不为正")
    if mean_return <= 0:
        reasons.append("样本外平均收益不为正")
    if trade_count < fold_count:
        reasons.append("样本外成交次数不足")
    if not reasons:
        admission = "stable"
        reasons = ["通过当前探索性稳定门槛，仍需更长历史和正式数据复核"]
    elif fold_count >= 3 and positive_rate >= 0.5 and median_return >= 0:
        admission = "watch"
    else:
        admission = "rejected"
    return {
        "foldCount": int(fold_count),
        "meanOosReturn": mean_return,
        "medianOosReturn": median_return,
        "worstOosReturn": worst_return,
        "positiveFoldRate": positive_rate,
        "maxDrawdown": max_drawdown,
        "tradeCount": int(trade_count),
        "winRate": win_rate,
        "admission": admission,
        "reasons": reasons,
    }


def _finite(value):
    number = float(value)
    return number if np.isfinite(number) else 0.0


def _compact_metrics(result):
    return {
        "netReturn": _finite(result.get("netReturn", 0.0)),
        "maxDrawdown": _finite(result.get("maxDrawdown", 0.0)),
        "tradeCount": int(result.get("tradeCount") or 0),
        "winRate": _finite(result.get("winRate", 0.0)),
        "buyCount": int(result.get("buyCount") or 0),
        "sellCount": int(result.get("sellCount") or 0),
        "blockedBuys": int(result.get("blockedBuys") or 0),
        "blockedSells": int(result.get("blockedSells") or 0),
        "unclosedPositions": int(result.get("unclosedPositions") or 0),
    }


def _parameter_rank(parameter):
    metrics = parameter["metrics"]
    return (
        _finite(metrics["medianOosReturn"]),
        _finite(metrics["positiveFoldRate"]),
        _finite(metrics["worstOosReturn"]),
        -abs(_finite(metrics["maxDrawdown"])),
        int(metrics["tradeCount"]),
    )


def run_strategy_lab(
    dataset_dir,
    workspace,
    run_id,
    strategy_family="moving-average-crossover",
    short_windows=(5, 10, 20),
    long_windows=(20, 40, 60),
    fast_windows=(8, 12),
    slow_windows=(26,),
    signal_windows=(9,),
    rsi_periods=(6, 14),
    entry_thresholds=(30,),
    exit_thresholds=(70,),
    breakout_windows=(20, 40),
    volume_multipliers=(1.5, 2.0),
    breakout_margins=(0.005,),
    breakout_min_close_locations=(0.7,),
    position_lookback_windows=(120,),
    max_range_positions=(0.35,),
    volume_windows=(20,),
    max_abs_returns=(0.02,),
    max_intraday_ranges=(0.06,),
    min_close_locations=(0.5,),
    train_days=252,
    validation_days=63,
    test_days=63,
    step_days=63,
    max_folds=4,
    min_history_days=120,
    max_instruments=600,
    assumptions=None,
    emit=None,
):
    from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic
    from .model import _load_panel, _runtime_versions
    from .pipeline import build_rolling_folds

    dataset_root = Path(dataset_dir)
    workspace_root = Path(workspace)
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest_sha256(manifest) != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")
    assumptions = assumptions or ExecutionAssumptions()
    grid = generate_strategy_parameter_grid(
        strategy_family,
        short_windows=short_windows,
        long_windows=long_windows,
        fast_windows=fast_windows,
        slow_windows=slow_windows,
        signal_windows=signal_windows,
        rsi_periods=rsi_periods,
        entry_thresholds=entry_thresholds,
        exit_thresholds=exit_thresholds,
        breakout_windows=breakout_windows,
        volume_multipliers=volume_multipliers,
        breakout_margins=breakout_margins,
        breakout_min_close_locations=breakout_min_close_locations,
        position_lookback_windows=position_lookback_windows,
        max_range_positions=max_range_positions,
        volume_windows=volume_windows,
        max_abs_returns=max_abs_returns,
        max_intraday_ranges=max_intraday_ranges,
        min_close_locations=min_close_locations,
    )
    if int(max_folds) < 3:
        raise ValueError("strategy stability research requires at least three out-of-sample folds")

    if emit:
        emit({"stage": "strategy-prepare", "message": "校验数据并筛选沪深主板股票池"})
    raw_panel = _load_panel(dataset_root, manifest)
    panel, universe = filter_main_board_panel(raw_panel)
    dates = pd.DatetimeIndex(panel["date"].unique()).sort_values()
    folds = build_rolling_folds(
        dates,
        train_days=int(train_days),
        validation_days=int(validation_days),
        test_days=int(test_days),
        step_days=int(step_days),
        label_horizon=1,
        max_folds=int(max_folds),
    )
    if len(folds) < 3:
        required = int(train_days) + int(validation_days) + int(test_days) + 2
        raise ValueError(f"not enough trading dates for three-fold strategy lab; each rolling origin needs at least {required} dates")

    required_history = max(int(min_history_days), max(item["warmup"] for item in grid))
    first_test_start = pd.Timestamp(folds[0].test_start)
    history_counts = panel[panel["date"] < first_test_start].groupby("code", sort=False).size()
    eligible_codes = set(history_counts[history_counts >= required_history].index.astype(str))
    all_main_board_codes = set(panel["code"].astype(str))
    universe["excludedInsufficientHistory"] = len(all_main_board_codes.difference(eligible_codes))
    screening_panel = panel[panel["code"].isin(eligible_codes)].copy()
    bounded_codes = select_bounded_liquid_universe(
        panel, eligible_codes, folds[0].train_end, max_instruments
    )
    universe["eligibleBeforeLiquidityCap"] = len(eligible_codes)
    universe["excludedByLiquidityCap"] = max(len(eligible_codes) - len(bounded_codes), 0)
    universe["liquiditySelectionBasis"] = "first-fold-training-coverage-and-median-volume"
    panel = panel[panel["code"].isin(bounded_codes)].copy()
    universe["included"] = len(bounded_codes)
    universe["candidateScanIncluded"] = int(screening_panel["code"].nunique())
    universe["minimumHistoryDays"] = required_history
    if panel.empty:
        raise ValueError("no main-board securities have enough history for the requested rule card")

    parameters = []
    validation_results = {index: {} for index in range(len(folds))}
    test_results = {index: {} for index in range(len(folds))}
    for parameter_index, parameter in enumerate(grid, start=1):
        parameter_id = parameter["parameterId"]
        prepared_panel = prepare_strategy_signals(panel, parameter)
        fold_evidence = []
        for fold_index, fold in enumerate(folds):
            validation = simulate_prepared_parameter(
                prepared_panel, fold.validation_start, fold.validation_end, assumptions
            )
            test = simulate_prepared_parameter(
                prepared_panel, fold.test_start, fold.test_end, assumptions
            )
            validation_results[fold_index][parameter_id] = validation
            test_results[fold_index][parameter_id] = test
            fold_evidence.append({
                "fold": fold_index + 1,
                "validation": _compact_metrics(validation),
                "test": _compact_metrics(test),
            })
        stability = summarize_parameter_stability([item["test"] for item in fold_evidence])
        stability["validationMeanReturn"] = _finite(np.mean([
            item["validation"]["netReturn"] for item in fold_evidence
        ]))
        parameter_result = {
            "strategyFamily": parameter["strategyFamily"],
            "parameterId": parameter_id,
            "label": parameter["label"],
            "settings": parameter["settings"],
            "admission": stability.pop("admission"),
            "reasons": stability.pop("reasons"),
            "metrics": stability,
            "folds": fold_evidence,
        }
        if strategy_family == "moving-average-crossover":
            parameter_result["shortWindow"] = int(parameter["settings"]["shortWindow"])
            parameter_result["longWindow"] = int(parameter["settings"]["longWindow"])
        parameters.append(parameter_result)
        if emit:
            emit({
                "stage": "strategy-evaluate",
                "current": parameter_index,
                "total": len(grid),
                "message": f"参数 {parameter['label']} 的滚动样本外检查已完成",
            })

    selections = []
    selected_test_results = []
    for fold_index, fold in enumerate(folds):
        selected_id = max(
            validation_results[fold_index],
            key=lambda parameter_id: (
                validation_results[fold_index][parameter_id]["netReturn"],
                validation_results[fold_index][parameter_id]["maxDrawdown"],
                validation_results[fold_index][parameter_id]["tradeCount"],
                parameter_id,
            ),
        )
        validation = _compact_metrics(validation_results[fold_index][selected_id])
        test = _compact_metrics(test_results[fold_index][selected_id])
        selected_test_results.append(test)
        selections.append({
            "fold": fold_index + 1,
            "selectedParameterId": selected_id,
            "selectedFrom": "validation-only",
            "validation": validation,
            "test": test,
        })

    ranked = sorted(parameters, key=_parameter_rank, reverse=True)
    best_parameter = ranked[0]
    worst_parameter = ranked[-1]
    stable_parameter_ids = [item["parameterId"] for item in parameters if item["admission"] == "stable"]
    selected_walk_forward = summarize_parameter_stability(selected_test_results)
    current_signals = collect_current_signal_candidates(screening_panel, parameters)

    run_dir = workspace_root / "strategy-runs" / str(run_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    table_path = run_dir / "parameter_stability.csv"
    pd.DataFrame([{
        "parameterId": item["parameterId"],
        "label": item["label"],
        **item["settings"],
        "admission": item["admission"],
        **item["metrics"],
    } for item in parameters]).to_csv(table_path, index=False, encoding="utf-8-sig")

    warnings = list(manifest.get("warnings") or [])
    warnings.extend([
        "This is an exploratory rule-card backtest and does not place or recommend orders.",
        "Signals use close information and can execute no earlier than the next trading-day open.",
        "Price-limit, suspension, T+1, lot size, fees, tax and slippage are modeled assumptions, not broker fills.",
        "Current-list and unadjusted public data can contain survivorship and corporate-action bias.",
        "The highest-ranked parameter is historical sample-out evidence, not a future-profit claim.",
    ])
    rule_definition = STRATEGY_RULES[str(strategy_family)]
    rule_card = {
        "strategyFamily": str(strategy_family),
        "label": rule_definition["label"],
        "entryRule": rule_definition["entryRule"],
        "exitRule": rule_definition["exitRule"],
        "parameterCount": len(grid),
    }
    if strategy_family == "moving-average-crossover":
        rule_card.update({
            "shortWindows": sorted({item["settings"]["shortWindow"] for item in grid}),
            "longWindows": sorted({item["settings"]["longWindow"] for item in grid}),
        })
    elif strategy_family == "macd-crossover":
        rule_card.update({
            "fastWindows": sorted({item["settings"]["fastWindow"] for item in grid}),
            "slowWindows": sorted({item["settings"]["slowWindow"] for item in grid}),
            "signalWindows": sorted({item["settings"]["signalWindow"] for item in grid}),
        })
    elif strategy_family == "rsi-rebound":
        rule_card.update({
            "rsiPeriods": sorted({item["settings"]["rsiPeriod"] for item in grid}),
            "entryThresholds": sorted({item["settings"]["entryThreshold"] for item in grid}),
            "exitThresholds": sorted({item["settings"]["exitThreshold"] for item in grid}),
        })
    elif strategy_family == "volume-breakout":
        rule_card.update({
            "breakoutWindows": sorted({item["settings"]["breakoutWindow"] for item in grid}),
            "volumeMultipliers": sorted({item["settings"]["volumeMultiplier"] for item in grid}),
            "breakoutMargins": sorted({item["settings"]["breakoutMargin"] for item in grid}),
            "minCloseLocations": sorted({item["settings"]["minCloseLocation"] for item in grid}),
            "confirmationRule": "下一交易日仍站在此前高点上方，且成交未明显萎缩",
            "invalidationRule": "收盘重新跌回此前高点下方或跌破信号日最低价",
        })
    elif strategy_family == "low-position-volume-stagnation":
        rule_card.update({
            "positionLookbackWindows": sorted({item["settings"]["positionLookbackWindow"] for item in grid}),
            "maxRangePositions": sorted({item["settings"]["maxRangePosition"] for item in grid}),
            "volumeWindows": sorted({item["settings"]["volumeWindow"] for item in grid}),
            "volumeMultipliers": sorted({item["settings"]["volumeMultiplier"] for item in grid}),
            "maxAbsReturns": sorted({item["settings"]["maxAbsReturn"] for item in grid}),
            "maxIntradayRanges": sorted({item["settings"]["maxIntradayRange"] for item in grid}),
            "minCloseLocations": sorted({item["settings"]["minCloseLocation"] for item in grid}),
            "confirmationRule": "未来3个交易日收盘突破信号日最高价，且未先跌破信号日最低价",
            "invalidationRule": "收盘跌破信号日最低价或放量继续下跌",
        })

    result = {
        "schema": "webstock.quant.strategy-lab.v1",
        "runId": str(run_id),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "validationStatus": "exploratory",
        "automaticTrading": False,
        "asOf": pd.Timestamp(panel["date"].max()).strftime("%Y-%m-%d"),
        "dataManifest": {
            "datasetId": manifest["datasetId"],
            "sha256": manifest["manifestSha256"],
            "path": manifest_path.resolve().relative_to(workspace_root.resolve()).as_posix(),
        },
        "runtime": _runtime_versions(),
        "ruleCard": rule_card,
        "executionAssumptions": assumptions.to_contract(),
        "windowParameters": {
            "trainDays": int(train_days),
            "validationDays": int(validation_days),
            "testDays": int(test_days),
            "stepDays": int(step_days),
            "maxFolds": int(max_folds),
            "minimumHistoryDays": required_history,
            "maxInstruments": int(max_instruments),
        },
        "universe": universe,
        "folds": [fold.to_contract() for fold in folds],
        "selections": selections,
        "selectedWalkForward": selected_walk_forward,
        "currentSignals": current_signals,
        "parameters": parameters,
        "stableParameterIds": stable_parameter_ids,
        "bestParameter": best_parameter,
        "worstParameter": worst_parameter,
        "artifacts": [{
            "path": table_path.relative_to(run_dir).as_posix(),
            "sha256": file_sha256(table_path),
            "rows": len(parameters),
        }],
        "warnings": warnings,
    }
    result_path = run_dir / "result.json"
    write_json_atomic(result_path, result)
    if emit:
        emit({
            "stage": "strategy-complete",
            "message": f"批量策略研究完成：{len(parameters)} 组参数，{len(folds)} 个样本外窗口",
        })
    return result_path, result
