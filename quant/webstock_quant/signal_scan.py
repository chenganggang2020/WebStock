import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic
from .model import _load_panel, _runtime_versions
from .strategy_lab import (
    STRATEGY_RULES,
    _candidate_signal_evidence,
    _candidate_signal_rules,
    _finite,
    filter_main_board_panel,
    generate_strategy_parameter_grid,
    prepare_strategy_signals,
)


def _match_strength(row, parameter):
    settings = parameter["settings"]
    family = parameter["strategyFamily"]
    if family == "low-position-volume-stagnation":
        volume = min(_finite(row.get("volumeRatio")) / settings["volumeMultiplier"], 3.0) / 3.0
        position = max(0.0, 1.0 - _finite(row.get("rangePosition")))
        return_quality = max(0.0, 1.0 - abs(_finite(row.get("dailyReturn"))) / settings["maxAbsReturn"])
        close_quality = min(_finite(row.get("closeLocation")), 1.0)
        return round(100.0 * (0.35 * volume + 0.3 * position + 0.15 * return_quality + 0.2 * close_quality), 2)
    if family == "volume-breakout":
        breakout = min(_finite(row.get("breakoutPercent")) / settings["breakoutMargin"], 3.0) / 3.0
        volume = min(_finite(row.get("volumeRatio")) / settings["volumeMultiplier"], 3.0) / 3.0
        close_quality = min(_finite(row.get("closeLocation")), 1.0)
        return round(100.0 * (0.4 * breakout + 0.35 * volume + 0.25 * close_quality), 2)
    return 50.0


def _why_matched(row, parameter):
    settings = parameter["settings"]
    if parameter["strategyFamily"] == "low-position-volume-stagnation":
        return [
            f"{settings['positionLookbackWindow']}日区间位置 {_finite(row['rangePosition']) * 100:.1f}% ≤ {settings['maxRangePosition'] * 100:.1f}%",
            f"成交量为前{settings['volumeWindow']}日均量 {_finite(row['volumeRatio']):.2f} 倍 ≥ {settings['volumeMultiplier']:.2f} 倍",
            f"当日涨跌幅 {_finite(row['dailyReturn']) * 100:+.2f}% 在 ±{settings['maxAbsReturn'] * 100:.2f}% 内",
            f"日内振幅 {_finite(row['intradayRange']) * 100:.2f}% ≤ {settings['maxIntradayRange'] * 100:.2f}%",
            f"收盘位于当日振幅上方 {_finite(row['closeLocation']) * 100:.1f}% ≥ {settings['minCloseLocation'] * 100:.1f}%",
        ]
    if parameter["strategyFamily"] == "volume-breakout":
        return [
            f"收盘超过此前{settings['breakoutWindow']}日最高价 {_finite(row['breakoutPercent']) * 100:.2f}% ≥ {settings['breakoutMargin'] * 100:.2f}%",
            f"成交量为此前均量 {_finite(row['volumeRatio']):.2f} 倍 ≥ {settings['volumeMultiplier']:.2f} 倍",
            f"收盘位于当日振幅上方 {_finite(row['closeLocation']) * 100:.1f}% ≥ {settings['minCloseLocation'] * 100:.1f}%",
        ]
    return ["当前交易日满足受控规则卡条件"]


def scan_strategy_candidates(panel, parameter, max_candidates=500):
    if panel.empty:
        return {"asOf": "", "candidateCount": 0, "storedCount": 0, "truncated": False, "candidates": []}
    prepared = prepare_strategy_signals(panel, parameter)
    latest_date = pd.Timestamp(prepared["date"].max())
    current = prepared[
        (prepared["date"] == latest_date) & prepared["entrySignal"].fillna(False)
    ].copy()
    confirmation_rule, invalidation_rule = _candidate_signal_rules(parameter["strategyFamily"])
    candidates = []
    for _, row in current.iterrows():
        candidates.append({
            "code": str(row["code"]),
            "name": str(row["name"]),
            "signalDate": latest_date.strftime("%Y-%m-%d"),
            "strategyFamily": parameter["strategyFamily"],
            "parameterId": parameter["parameterId"],
            "matchStrength": _match_strength(row, parameter),
            "candidateStatus": "rule-match-unconfirmed",
            "rawEvidence": _candidate_signal_evidence(row, parameter["strategyFamily"]),
            "thresholds": {name: _finite(value) for name, value in parameter["settings"].items()},
            "whyMatched": _why_matched(row, parameter),
            "confirmationRule": confirmation_rule,
            "invalidationRule": invalidation_rule,
            "earliestActionTiming": "下一可成交日开盘后，仅供观察或人工加入盯盘",
        })
    candidates.sort(key=lambda item: (-item["matchStrength"], item["code"]))
    limit = min(max(int(max_candidates), 1), 2000)
    stored = candidates[:limit]
    return {
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "candidateCount": len(candidates),
        "storedCount": len(stored),
        "truncated": len(candidates) > len(stored),
        "candidates": stored,
    }


def run_signal_scan(
    dataset_dir,
    workspace,
    run_id,
    strategy_family,
    validation_mode="exploratory",
    max_candidates=500,
    emit=None,
    **strategy_parameters,
):
    dataset_root = Path(dataset_dir)
    workspace_root = Path(workspace)
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest_sha256(manifest) != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")
    mode = str(validation_mode or "exploratory")
    if mode not in {"exploratory", "formal"}:
        raise ValueError("validation mode must be exploratory or formal")
    formal_allowed = manifest.get("eligibility") == "validation_eligible"
    if mode == "formal" and not formal_allowed:
        raise ValueError("当前数据集不具备正式筛选资格；请使用点时股票池、明确复权且来源条款已验证的数据")

    grid = generate_strategy_parameter_grid(strategy_family, **strategy_parameters)
    if len(grid) != 1:
        raise ValueError("signal scan requires exactly one deterministic parameter combination")
    parameter = grid[0]
    if emit:
        emit({"stage": "signal-scan-prepare", "message": "校验数据资格并计算全市场规则特征"})
    raw_panel = _load_panel(dataset_root, manifest)
    panel, universe = filter_main_board_panel(raw_panel)
    required_history = int(parameter["warmup"])
    history_counts = panel.groupby("code", sort=False).size()
    eligible_codes = set(history_counts[history_counts >= required_history].index.astype(str))
    universe["excludedInsufficientHistory"] = int(panel["code"].nunique() - len(eligible_codes))
    universe["included"] = len(eligible_codes)
    universe["minimumHistoryDays"] = required_history
    screening_panel = panel[panel["code"].isin(eligible_codes)].copy()
    if screening_panel.empty:
        raise ValueError("no main-board securities have enough history for the signal scan")
    scan = scan_strategy_candidates(screening_panel, parameter, max_candidates=max_candidates)

    run_dir = workspace_root / "signal-scans" / str(run_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    table_path = run_dir / "candidates.csv"
    rows = []
    for candidate in scan["candidates"]:
        rows.append({
            "code": candidate["code"],
            "name": candidate["name"],
            "signalDate": candidate["signalDate"],
            "matchStrength": candidate["matchStrength"],
            "rawEvidence": json.dumps(candidate["rawEvidence"], ensure_ascii=False, separators=(",", ":")),
            "whyMatched": "；".join(candidate["whyMatched"]),
        })
    pd.DataFrame(rows, columns=[
        "code", "name", "signalDate", "matchStrength", "rawEvidence", "whyMatched"
    ]).to_csv(table_path, index=False, encoding="utf-8-sig")

    definition = STRATEGY_RULES[strategy_family]
    result = {
        "schema": "webstock.quant.signal-scan.v1",
        "runId": str(run_id),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "validationMode": mode,
        "automaticTrading": False,
        "asOf": scan["asOf"],
        "dataManifest": {
            "datasetId": manifest["datasetId"],
            "sha256": manifest["manifestSha256"],
            "path": manifest_path.resolve().relative_to(workspace_root.resolve()).as_posix(),
        },
        "runtime": _runtime_versions(),
        "dataGate": {
            "datasetEligibility": manifest.get("eligibility", "exploratory_only"),
            "formalAllowed": formal_allowed,
            "researchUseOnly": not formal_allowed or mode == "exploratory",
            "adjustmentMode": manifest.get("adjustmentMode", "unknown"),
            "membershipMode": (manifest.get("universe") or {}).get("membershipMode", "unknown"),
            "coverage": manifest.get("coverage") or {},
        },
        "ruleCard": {
            "strategyFamily": strategy_family,
            "label": definition["label"],
            "entryRule": definition["entryRule"],
            "exitRule": definition["exitRule"],
            "parameterId": parameter["parameterId"],
            "settings": parameter["settings"],
        },
        "universe": universe,
        "candidateCount": scan["candidateCount"],
        "storedCount": scan["storedCount"],
        "truncated": scan["truncated"],
        "candidates": scan["candidates"],
        "artifacts": [{
            "path": table_path.name,
            "sha256": file_sha256(table_path),
            "rows": len(rows),
        }],
        "warnings": list(manifest.get("warnings") or []) + [
            "规则匹配不是买入推荐，不会自动下单。",
            "所有信号使用收盘后信息，最早只能在下一可成交日人工观察。",
            "未通过正式数据资格门禁时，结果仅可用于探索和数据检查。",
        ],
    }
    result_path = run_dir / "result.json"
    write_json_atomic(result_path, result)
    if emit:
        emit({
            "stage": "signal-scan-complete",
            "message": f"扫描完成：{scan['candidateCount']} 个规则匹配",
        })
    return result_path, result
