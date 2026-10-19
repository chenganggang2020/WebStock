"""Build a transparent equal-weight board proxy from local qfq daily closes."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pandas as pd


def build(payload: dict) -> dict:
    dataset_dir = Path(str(payload["datasetDir"]))
    codes = [str(code).zfill(6) for code in payload.get("codes", [])]
    raw_days = max(2, int(payload.get("rawDays", 60)))
    closes: list[pd.Series] = []
    included: list[str] = []

    for code in codes:
        source = dataset_dir / "raw" / f"{code}.parquet"
        if not source.is_file():
            continue
        frame = pd.read_parquet(source, columns=["date", "close"])
        if frame.empty:
            continue
        frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
        frame["close"] = pd.to_numeric(frame["close"], errors="coerce")
        series = frame.dropna().drop_duplicates("date", keep="last").set_index("date")["close"]
        series = series[series > 0].sort_index()
        if len(series) < 2:
            continue
        closes.append(series.rename(code))
        included.append(code)

    if len(closes) < 2:
        raise RuntimeError("可用成分历史少于2只，无法计算板块等权估算")

    prices = pd.concat(closes, axis=1).sort_index()
    returns = prices.pct_change(fill_method=None)
    minimum = max(2, int(math.ceil(len(closes) * 0.6)))
    coverage = returns.notna().sum(axis=1)
    equal_return = returns.mean(axis=1, skipna=True).where(coverage >= minimum).dropna()
    # A display window of N returns requires N+1 closing levels.
    equal_return = equal_return.tail(raw_days + 1)
    if len(equal_return) < 2:
        raise RuntimeError("满足成分覆盖阈值的共同交易日不足")

    level = (1.0 + equal_return).cumprod() * 100.0
    points = [
        {"date": date.strftime("%Y-%m-%d"), "close": round(float(value), 8)}
        for date, value in level.items()
    ]
    return {
        "points": points,
        "requestedConstituents": len(codes),
        "includedConstituents": len(included),
        "minimumDailyCoverage": minimum,
        "includedCodes": included,
    }


def main() -> None:
    payload = json.load(sys.stdin)
    json.dump(build(payload), sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    main()
