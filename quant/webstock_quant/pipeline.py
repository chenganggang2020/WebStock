from dataclasses import asdict, dataclass
from math import sqrt

import numpy as np
import pandas as pd


FEATURE_COLUMNS = [
    "feature_return_1",
    "feature_momentum_5",
    "feature_momentum_20",
    "feature_momentum_60",
    "feature_volatility_20",
    "feature_volume_ratio_5_20",
    "feature_intraday_range",
    "feature_close_position",
]


@dataclass(frozen=True)
class RollingFold:
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    validation_start: pd.Timestamp
    validation_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp
    purge_days: int

    def to_contract(self):
        def day(value):
            return pd.Timestamp(value).strftime("%Y-%m-%d")

        return {
            "train": {"start": day(self.train_start), "end": day(self.train_end)},
            "validation": {
                "start": day(self.validation_start),
                "end": day(self.validation_end),
            },
            "test": {"start": day(self.test_start), "end": day(self.test_end)},
            "purgeDays": self.purge_days,
        }

    def as_dict(self):
        return asdict(self)


def _numeric(frame, columns):
    for column in columns:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")


def build_features(panel, label_horizon=5):
    if int(label_horizon) < 1:
        raise ValueError("label_horizon must be positive")
    required = {"date", "code", "open", "high", "low", "close", "volume"}
    missing = required.difference(panel.columns)
    if missing:
        raise ValueError("missing panel columns: " + ", ".join(sorted(missing)))

    frame = panel.copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["code"] = frame["code"].astype(str).str.replace(r"\D", "", regex=True).str.zfill(6)
    _numeric(frame, ["open", "high", "low", "close", "volume"])
    frame = frame.dropna(subset=["date", "code", "open", "high", "low", "close", "volume"])
    frame = frame[(frame["close"] > 0) & (frame["volume"] >= 0)]
    frame = frame.sort_values(["code", "date"], kind="stable").reset_index(drop=True)

    grouped_close = frame.groupby("code", sort=False)["close"]
    grouped_volume = frame.groupby("code", sort=False)["volume"]
    daily_return = grouped_close.pct_change(fill_method=None)

    frame["feature_return_1"] = daily_return
    frame["feature_momentum_5"] = grouped_close.pct_change(5, fill_method=None)
    frame["feature_momentum_20"] = grouped_close.pct_change(20, fill_method=None)
    frame["feature_momentum_60"] = grouped_close.pct_change(60, fill_method=None)
    frame["feature_volatility_20"] = (
        daily_return.groupby(frame["code"], sort=False)
        .rolling(20, min_periods=12)
        .std()
        .reset_index(level=0, drop=True)
    )
    volume_5 = (
        grouped_volume.rolling(5, min_periods=3).mean().reset_index(level=0, drop=True)
    )
    volume_20 = (
        grouped_volume.rolling(20, min_periods=12).mean().reset_index(level=0, drop=True)
    )
    frame["feature_volume_ratio_5_20"] = volume_5 / volume_20.replace(0, np.nan)
    frame["feature_intraday_range"] = (frame["high"] - frame["low"]) / frame["close"]
    day_range = (frame["high"] - frame["low"]).replace(0, np.nan)
    frame["feature_close_position"] = (frame["close"] - frame["low"]) / day_range
    frame["label"] = grouped_close.shift(-int(label_horizon)) / frame["close"] - 1

    frame[FEATURE_COLUMNS] = frame[FEATURE_COLUMNS].replace([np.inf, -np.inf], np.nan)
    frame["label"] = frame["label"].replace([np.inf, -np.inf], np.nan)
    return frame


def build_rolling_folds(
    dates,
    train_days=504,
    validation_days=126,
    test_days=63,
    step_days=63,
    label_horizon=5,
    max_folds=4,
):
    values = pd.DatetimeIndex(pd.to_datetime(pd.Index(dates), errors="coerce")).dropna().unique().sort_values()
    train_days = int(train_days)
    validation_days = int(validation_days)
    test_days = int(test_days)
    step_days = int(step_days)
    label_horizon = int(label_horizon)
    max_folds = int(max_folds)
    if min(train_days, validation_days, test_days, step_days, label_horizon, max_folds) < 1:
        raise ValueError("rolling window parameters must be positive")
    if step_days < test_days:
        raise ValueError("step_days must be at least test_days to prevent overlapping test windows")

    total_days = train_days + validation_days + test_days + 2 * label_horizon
    folds = []
    offset = 0
    while offset + total_days <= len(values):
        train_start_index = offset
        train_end_index = train_start_index + train_days - 1
        validation_start_index = train_end_index + label_horizon + 1
        validation_end_index = validation_start_index + validation_days - 1
        test_start_index = validation_end_index + label_horizon + 1
        test_end_index = test_start_index + test_days - 1
        folds.append(
            RollingFold(
                train_start=values[train_start_index],
                train_end=values[train_end_index],
                validation_start=values[validation_start_index],
                validation_end=values[validation_end_index],
                test_start=values[test_start_index],
                test_end=values[test_end_index],
                purge_days=label_horizon,
            )
        )
        offset += step_days
    return folds[-max_folds:]


def _safe_annualized_return(returns, periods_per_year):
    if not returns:
        return 0.0
    wealth = float(np.prod([1.0 + value for value in returns]))
    if wealth <= 0:
        return -1.0
    return wealth ** (periods_per_year / len(returns)) - 1.0


def _max_drawdown(returns):
    if not returns:
        return 0.0
    wealth = np.cumprod(1.0 + np.asarray(returns, dtype=float))
    peaks = np.maximum.accumulate(wealth)
    drawdowns = wealth / peaks - 1.0
    return float(np.min(drawdowns))


def _rank_ic(group):
    clean = group[["score", "label"]].dropna()
    if len(clean) < 3 or clean["score"].nunique() < 2 or clean["label"].nunique() < 2:
        return np.nan
    return clean["score"].corr(clean["label"], method="spearman")


def evaluate_predictions(predictions, top_k=20, label_horizon=5, cost_bps=8.0):
    required = {"date", "code", "score", "label"}
    missing = required.difference(predictions.columns)
    if missing:
        raise ValueError("missing prediction columns: " + ", ".join(sorted(missing)))
    top_k = max(int(top_k), 1)
    label_horizon = max(int(label_horizon), 1)
    cost_rate = max(float(cost_bps), 0.0) / 10000.0

    frame = predictions.copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame["score"] = pd.to_numeric(frame["score"], errors="coerce")
    frame["label"] = pd.to_numeric(frame["label"], errors="coerce")
    frame = frame.dropna(subset=["date", "code", "score", "label"])

    rank_ics = frame.groupby("date", sort=True).apply(_rank_ic, include_groups=False).dropna()
    net_returns = []
    gross_returns = []
    benchmark_returns = []
    turnovers = []
    total_cost = 0.0
    trade_count = 0
    previous_weights = {}

    grouped_dates = list(frame.groupby("date", sort=True))
    for _, group in grouped_dates[::label_horizon]:
        selected = group.nlargest(min(top_k, len(group)), "score")
        if selected.empty:
            continue
        weight = 1.0 / len(selected)
        current_weights = {str(code): weight for code in selected["code"]}
        union = set(previous_weights).union(current_weights)
        changes = [abs(current_weights.get(code, 0.0) - previous_weights.get(code, 0.0)) for code in union]
        turnover = sum(changes)
        cost = turnover * cost_rate
        gross = float(selected["label"].mean())
        benchmark = float(group["label"].mean())
        gross_returns.append(gross)
        benchmark_returns.append(benchmark)
        net_returns.append(gross - cost)
        turnovers.append(turnover)
        total_cost += cost
        trade_count += sum(change > 1e-12 for change in changes)
        previous_weights = current_weights

    liquidation_cost = 0.0
    if net_returns and previous_weights:
        liquidation_turnover = sum(abs(weight) for weight in previous_weights.values())
        liquidation_cost = liquidation_turnover * cost_rate
        net_returns[-1] -= liquidation_cost
        total_cost += liquidation_cost
        trade_count += sum(abs(weight) > 1e-12 for weight in previous_weights.values())

    periods_per_year = 252.0 / label_horizon
    volatility = float(np.std(net_returns, ddof=1) * sqrt(periods_per_year)) if len(net_returns) > 1 else 0.0
    mean_return = float(np.mean(net_returns)) if net_returns else 0.0
    sharpe = mean_return / float(np.std(net_returns, ddof=1)) * sqrt(periods_per_year) if len(net_returns) > 1 and np.std(net_returns, ddof=1) > 0 else 0.0
    ic_std = float(rank_ics.std(ddof=1)) if len(rank_ics) > 1 else 0.0
    icir = float(rank_ics.mean() / ic_std * sqrt(periods_per_year)) if ic_std > 0 else 0.0

    return {
        "rankIc": float(rank_ics.mean()) if len(rank_ics) else 0.0,
        "icir": icir,
        "annualizedReturn": _safe_annualized_return(net_returns, periods_per_year),
        "benchmarkAnnualizedReturn": _safe_annualized_return(benchmark_returns, periods_per_year),
        "cumulativeReturn": float(np.prod(1.0 + np.asarray(net_returns)) - 1.0) if net_returns else 0.0,
        "grossCumulativeReturn": float(np.prod(1.0 + np.asarray(gross_returns)) - 1.0) if gross_returns else 0.0,
        "volatility": volatility,
        "maxDrawdown": _max_drawdown(net_returns),
        "sharpe": float(sharpe),
        "turnover": float(np.mean(turnovers)) if turnovers else 0.0,
        "totalCost": float(total_cost),
        "liquidationCost": float(liquidation_cost),
        "tradeCount": int(trade_count),
        "rebalanceCount": len(net_returns),
        "winRate": float(np.mean(np.asarray(net_returns) > 0)) if net_returns else 0.0,
    }
