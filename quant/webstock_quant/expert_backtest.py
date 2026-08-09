import json
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic


STRICT_EVIDENCE = {"primary", "archive"}
STRICT_ROLES = {"direct_quote", "transcript"}
STRICT_PRECISION = {"minute", "second"}
DIRECTION = {"bullish": 1.0, "bearish": -1.0}


def _load_panel(dataset_dir, manifest):
    root = Path(dataset_dir)
    frames = []
    for artifact in manifest.get("files", []):
        relative = str(artifact.get("path") or "")
        if not relative.startswith("raw/") or not relative.endswith(".parquet"):
            continue
        target = root / relative
        if not target.exists():
            raise FileNotFoundError("dataset artifact is missing: " + relative)
        if file_sha256(target) != str(artifact.get("sha256") or "").lower():
            raise ValueError("dataset artifact hash mismatch: " + relative)
        frames.append(pd.read_parquet(target, columns=["date", "code", "open", "close"]))
    if not frames:
        raise ValueError("dataset has no raw parquet artifacts")
    panel = pd.concat(frames, ignore_index=True)
    panel["date"] = pd.to_datetime(panel["date"], errors="coerce").dt.normalize()
    panel["code"] = panel["code"].astype(str).str.zfill(6)
    for column in ["open", "close"]:
        panel[column] = pd.to_numeric(panel[column], errors="coerce")
    return panel.dropna(subset=["date", "code", "open", "close"])


def _exclusion_reason(observation):
    if observation.get("evidenceLevel") not in STRICT_EVIDENCE:
        return "secondary_evidence"
    if observation.get("contentRole") not in STRICT_ROLES:
        return "non_quote_content"
    if observation.get("publishedTimePrecision") not in STRICT_PRECISION:
        return "imprecise_publication_time"
    if observation.get("stance") not in DIRECTION:
        return "non_directional_stance"
    if not observation.get("publishedAt"):
        return "missing_publication_time"
    codes = [str(code).zfill(6) for code in observation.get("stockCodes", []) if str(code).isdigit()]
    if not codes:
        return "missing_stock_mapping"
    try:
        pd.Timestamp(observation["publishedAt"])
    except (TypeError, ValueError):
        return "invalid_publication_time"
    return ""


def _local_signal_time(value):
    timestamp = pd.Timestamp(value)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize("Asia/Shanghai")
    else:
        timestamp = timestamp.tz_convert("Asia/Shanghai")
    return timestamp


def _next_session_open_day(dates, value):
    signal_time = _local_signal_time(value)
    for day in pd.DatetimeIndex(dates):
        session_open = day.tz_localize("Asia/Shanghai") + timedelta(hours=9, minutes=30)
        if session_open > signal_time:
            return pd.Timestamp(day).normalize()
    return None


def _finite(value):
    return value is not None and math.isfinite(float(value))


def _summary(values):
    clean = np.asarray([float(value) for value in values if _finite(value)], dtype=float)
    if not len(clean):
        return {"count": 0, "mean": None, "median": None, "winRate": None}
    return {
        "count": int(len(clean)),
        "mean": float(clean.mean()),
        "median": float(np.median(clean)),
        "winRate": float((clean > 0).mean()),
    }


def run_expert_backtest(dataset_dir, workspace, run_id, signals_path, horizons=None, cost_bps=8.0, emit=None):
    dataset_root = Path(dataset_dir).resolve()
    workspace_root = Path(workspace).resolve()
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest_sha256(manifest) != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")
    signals_file = Path(signals_path).resolve()
    signals = read_json(signals_file)
    observations = list(signals.get("observations") or [])
    selected_horizons = sorted({int(value) for value in (horizons or [1, 5, 20, 60]) if 1 <= int(value) <= 252})
    if not selected_horizons:
        raise ValueError("at least one holding horizon is required")
    cost_rate = max(float(cost_bps), 0.0) / 10000.0
    panel = _load_panel(dataset_root, manifest)
    dates = np.sort(panel["date"].unique())
    by_code = {code: frame.sort_values("date").set_index("date") for code, frame in panel.groupby("code")}
    market_by_date = {
        pd.Timestamp(day).normalize(): frame.set_index("code")[["open", "close"]]
        for day, frame in panel.groupby("date")
    }
    exclusions = Counter()
    eligible = []
    for observation in observations:
        reason = _exclusion_reason(observation)
        if reason:
            exclusions[reason] += 1
        else:
            eligible.append(observation)

    events = []
    for index, observation in enumerate(eligible, start=1):
        entry_day = _next_session_open_day(dates, observation["publishedAt"])
        if entry_day is None:
            exclusions["no_next_trading_session"] += 1
            continue
        direction = DIRECTION[observation["stance"]]
        for code in [str(value).zfill(6) for value in observation.get("stockCodes", [])]:
            prices = by_code.get(code)
            if prices is None or entry_day not in prices.index:
                exclusions["stock_not_in_dataset"] += 1
                continue
            entry_price = float(prices.loc[entry_day, "open"])
            if entry_price <= 0:
                exclusions["invalid_entry_price"] += 1
                continue
            code_dates = prices.index[prices.index >= entry_day]
            event_horizons = {}
            for horizon in selected_horizons:
                if len(code_dates) < horizon:
                    continue
                exit_day = pd.Timestamp(code_dates[horizon - 1]).normalize()
                exit_price = float(prices.loc[exit_day, "close"])
                gross_return = direction * (exit_price / entry_price - 1.0)
                net_return = gross_return - 2.0 * cost_rate
                entry_market = market_by_date.get(entry_day, pd.DataFrame(columns=["open", "close"]))[["open"]]
                exit_market = market_by_date.get(exit_day, pd.DataFrame(columns=["open", "close"]))[["close"]]
                market = entry_market.join(exit_market, how="inner")
                market = market[(market["open"] > 0) & (market["close"] > 0)]
                benchmark = None if market.empty else direction * float((market["close"] / market["open"] - 1.0).mean())
                event_horizons[str(horizon)] = {
                    "exitDate": exit_day.strftime("%Y-%m-%d"),
                    "exitPrice": exit_price,
                    "grossReturn": gross_return,
                    "netReturn": net_return,
                    "benchmarkReturn": benchmark,
                    "excessReturn": None if benchmark is None else net_return - benchmark,
                }
            if not event_horizons:
                exclusions["insufficient_forward_sessions"] += 1
                continue
            events.append({
                "observationId": int(observation.get("id") or 0),
                "code": code,
                "stance": observation["stance"],
                "signalAt": observation["publishedAt"],
                "entryDate": entry_day.strftime("%Y-%m-%d"),
                "entryPrice": entry_price,
                "horizons": event_horizons,
            })
        if emit:
            emit({"stage": "expert-backtest", "current": index, "total": len(eligible),
                  "message": f"创作者语录回测 {index}/{len(eligible)}"})

    metrics = {}
    for horizon in selected_horizons:
        key = str(horizon)
        rows = [event["horizons"][key] for event in events if key in event["horizons"]]
        metrics[key] = {
            "netReturn": _summary([row["netReturn"] for row in rows]),
            "benchmarkReturn": _summary([row["benchmarkReturn"] for row in rows]),
            "excessReturn": _summary([row["excessReturn"] for row in rows]),
        }

    run_root = workspace_root / "expert-runs" / str(run_id)
    run_root.mkdir(parents=True, exist_ok=True)
    events_path = run_root / "events.json"
    write_json_atomic(events_path, events)
    result = {
        "schema": "webstock.expert-backtest.v1",
        "runId": str(run_id),
        "channelId": int(signals.get("channelId") or 0),
        "validationStatus": "exploratory",
        "asOf": manifest.get("asOf"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "dataManifest": {
            "datasetId": manifest.get("datasetId"),
            "sha256": manifest.get("manifestSha256"),
            "path": manifest_path.resolve().relative_to(workspace_root).as_posix(),
        },
        "inputSha256": file_sha256(signals_file),
        "parameters": {
            "horizons": selected_horizons,
            "costBpsPerSide": float(cost_bps),
            "entryRule": "first_09:30_session_open_after_publication",
            "exitRule": "holding_session_close",
            "benchmark": "same-window equal-weight available dataset universe",
            "timeBasis": "exact public publication timestamp",
        },
        "coverage": {
            "totalObservations": len(observations),
            "strictEligibleObservations": len(eligible),
            "evaluatedEvents": len(events),
            "excludedByReason": dict(sorted(exclusions.items())),
        },
        "metrics": metrics,
        "events": events,
        "artifacts": [{
            "path": events_path.name,
            "sha256": file_sha256(events_path),
            "bytes": events_path.stat().st_size,
        }],
        "warnings": list(manifest.get("warnings") or []) + [
            "Exploratory only: the public daily dataset is unadjusted and may contain survivorship and corporate-action bias.",
            "Retrospective source selection can overstate performance even when publication timestamps are exact.",
            "Secondary quotes, commentary, imprecise timestamps and non-directional observations are excluded from the strict subset.",
        ],
    }
    result_path = run_root / "result.json"
    write_json_atomic(result_path, result)
    return result_path, result
