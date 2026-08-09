from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic
from .pipeline import FEATURE_COLUMNS, build_features, build_rolling_folds, evaluate_predictions


FACTOR_LABELS = {
    "feature_return_1": "1日收益",
    "feature_momentum_5": "5日动量",
    "feature_momentum_20": "20日动量",
    "feature_momentum_60": "60日动量",
    "feature_volatility_20": "20日波动率",
    "feature_volume_ratio_5_20": "量能比",
    "feature_intraday_range": "日内振幅",
    "feature_close_position": "收盘位置",
}


def _finite(value):
    number = float(value)
    return number if np.isfinite(number) else 0.0


def _daily_rank_ics(frame, score_column):
    values = []
    for _, group in frame.groupby("date", sort=True):
        clean = group[[score_column, "label"]].dropna()
        if len(clean) < 3 or clean[score_column].nunique() < 2 or clean["label"].nunique() < 2:
            continue
        correlation = clean[score_column].corr(clean["label"], method="spearman")
        if np.isfinite(correlation):
            values.append(float(correlation))
    return values


def select_factor_orientation(validation_frame, factor):
    rank_ics = _daily_rank_ics(validation_frame, factor)
    mean_rank_ic = float(np.mean(rank_ics)) if rank_ics else 0.0
    return (1 if mean_rank_ic >= 0 else -1), mean_rank_ic


def _factor_predictions(frame, factor, orientation, fold_index):
    return pd.DataFrame({
        "date": frame["date"],
        "code": frame["code"],
        "score": pd.to_numeric(frame[factor], errors="coerce") * int(orientation),
        "label": frame["label"],
        "fold": int(fold_index),
        "factorId": factor,
    })


def _cross_section_rank(values):
    return values.rank(method="average", pct=True).fillna(0.5) - 0.5


def _composite_predictions(frame, weights, fold_index):
    scores = pd.Series(0.0, index=frame.index, dtype=float)
    total = sum(abs(float(value)) for value in weights.values())
    if total <= 1e-12:
        weights = {factor: 1.0 for factor in FEATURE_COLUMNS}
        total = float(len(FEATURE_COLUMNS))
    for factor, weight in weights.items():
        ranked = frame.groupby("date", sort=False)[factor].transform(_cross_section_rank)
        scores += ranked * (float(weight) / total)
    return pd.DataFrame({
        "date": frame["date"],
        "code": frame["code"],
        "score": scores,
        "label": frame["label"],
        "fold": int(fold_index),
        "factorId": "validation-weighted-composite",
    })


def _validation_correlations(frame):
    output = {}
    for left_index, left in enumerate(FEATURE_COLUMNS):
        for right in FEATURE_COLUMNS[left_index + 1:]:
            daily = []
            for _, group in frame.groupby("date", sort=True):
                clean = group[[left, right]].dropna()
                if len(clean) < 3 or clean[left].nunique() < 2 or clean[right].nunique() < 2:
                    continue
                correlation = clean[left].corr(clean[right], method="spearman")
                if np.isfinite(correlation):
                    daily.append(abs(float(correlation)))
            output[(left, right)] = float(np.mean(daily)) if daily else 0.0
    return output


def _factor_duplicate_summary(factor, correlations):
    candidates = []
    for pair, values in correlations.items():
        if factor not in pair or not values:
            continue
        other = pair[1] if pair[0] == factor else pair[0]
        candidates.append((float(np.mean(values)), other))
    if not candidates:
        return 0.0, ""
    correlation, other = max(candidates, key=lambda item: item[0])
    return correlation, other


def _admission_status(fold_count, metrics, positive_fold_rate, max_correlation):
    rank_ic = float(metrics.get("rankIc") or 0.0)
    annualized = float(metrics.get("annualizedReturn") or 0.0)
    benchmark = float(metrics.get("benchmarkAnnualizedReturn") or 0.0)
    drawdown = float(metrics.get("maxDrawdown") or 0.0)
    reasons = []
    if fold_count < 3:
        reasons.append("样本外窗口少于3个")
    if rank_ic < 0.02:
        reasons.append("样本外Rank IC低于0.02")
    if positive_fold_rate < 0.6:
        reasons.append("正向窗口占比低于60%")
    if max_correlation >= 0.9:
        reasons.append("与已有因子重复度过高")
    if annualized <= benchmark:
        reasons.append("扣费年化未超过等权基准")
    if drawdown <= -0.35:
        reasons.append("样本外最大回撤超过35%")

    if not reasons:
        return "candidate", ["通过当前探索性门槛，仍需更长区间和正式点时点数据复核"]
    if rank_ic > 0 and positive_fold_rate >= 0.5 and max_correlation < 0.95:
        return "watch", reasons
    return "rejected", reasons


def run_factor_lab(
    dataset_dir,
    workspace,
    run_id,
    train_days=504,
    validation_days=126,
    test_days=63,
    step_days=63,
    label_horizon=5,
    max_folds=4,
    top_k=20,
    cost_bps=8.0,
    seed=20260809,
    emit=None,
):
    from .model import _load_panel, _runtime_versions

    dataset_root = Path(dataset_dir)
    workspace_root = Path(workspace)
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest_sha256(manifest) != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")

    if emit:
        emit({"stage": "factor-prepare", "message": "Checking data hashes and building factor panel"})
    panel = _load_panel(dataset_root, manifest)
    features = build_features(panel, label_horizon=label_horizon)
    usable = features.dropna(subset=FEATURE_COLUMNS + ["label"])
    dates = pd.DatetimeIndex(usable["date"].unique()).sort_values()
    folds = build_rolling_folds(
        dates,
        train_days=train_days,
        validation_days=validation_days,
        test_days=test_days,
        step_days=step_days,
        label_horizon=label_horizon,
        max_folds=max_folds,
    )
    if not folds:
        required_days = int(train_days) + int(validation_days) + int(test_days) + 2 * int(label_horizon)
        raise ValueError(f"not enough trading dates for factor lab; at least {required_days} are required")

    factor_predictions = {factor: [] for factor in FEATURE_COLUMNS}
    factor_folds = {factor: [] for factor in FEATURE_COLUMNS}
    correlations = {}
    composite_predictions = []
    last_weights = {}

    for fold_index, fold in enumerate(folds, start=1):
        validation = usable[
            (usable["date"] >= fold.validation_start) & (usable["date"] <= fold.validation_end)
        ]
        test = usable[(usable["date"] >= fold.test_start) & (usable["date"] <= fold.test_end)]
        if validation.empty or test.empty:
            raise ValueError("factor lab fold contains an empty validation or test segment")

        fold_weights = {}
        for factor in FEATURE_COLUMNS:
            orientation, validation_rank_ic = select_factor_orientation(validation, factor)
            predictions = _factor_predictions(test, factor, orientation, fold_index)
            test_rank_ics = _daily_rank_ics(predictions, "score")
            test_rank_ic = float(np.mean(test_rank_ics)) if test_rank_ics else 0.0
            factor_predictions[factor].append(predictions)
            factor_folds[factor].append({
                "fold": fold_index,
                "orientation": orientation,
                "validationRankIc": _finite(validation_rank_ic),
                "testRankIc": _finite(test_rank_ic),
            })
            fold_weights[factor] = validation_rank_ic

        for pair, correlation in _validation_correlations(validation).items():
            correlations.setdefault(pair, []).append(correlation)
        composite_predictions.append(_composite_predictions(test, fold_weights, fold_index))
        last_weights = fold_weights
        if emit:
            emit({
                "stage": "factor-evaluate",
                "current": fold_index,
                "total": len(folds),
                "message": f"Factor sample-out fold {fold_index}/{len(folds)} completed",
            })

    all_prediction_frames = []
    factors = []
    for factor in FEATURE_COLUMNS:
        predictions = pd.concat(factor_predictions[factor], ignore_index=True)
        all_prediction_frames.append(predictions)
        metrics = evaluate_predictions(
            predictions[["date", "code", "score", "label"]],
            top_k=top_k,
            label_horizon=label_horizon,
            cost_bps=cost_bps,
        )
        metrics = {name: (_finite(value) if not isinstance(value, int) else value) for name, value in metrics.items()}
        folds_for_factor = factor_folds[factor]
        positive_rate = float(np.mean([item["testRankIc"] > 0 for item in folds_for_factor]))
        orientations = [item["orientation"] for item in folds_for_factor]
        orientation_agreement = abs(float(np.mean(orientations)))
        max_correlation, closest_factor = _factor_duplicate_summary(factor, correlations)
        admission, reasons = _admission_status(len(folds), metrics, positive_rate, max_correlation)
        factors.append({
            "factorId": factor,
            "displayName": FACTOR_LABELS.get(factor, factor),
            "complexity": 1,
            "dominantOrientation": 1 if sum(orientations) >= 0 else -1,
            "orientationAgreement": _finite(orientation_agreement),
            "validationRankIc": _finite(np.mean([item["validationRankIc"] for item in folds_for_factor])),
            "testRankIc": _finite(metrics["rankIc"]),
            "positiveFoldRate": _finite(positive_rate),
            "maxAbsCorrelation": _finite(max_correlation),
            "closestFactor": closest_factor,
            "admission": admission,
            "reasons": reasons,
            "metrics": metrics,
            "folds": folds_for_factor,
        })

    composite_frame = pd.concat(composite_predictions, ignore_index=True)
    all_prediction_frames.append(composite_frame)
    composite_metrics = evaluate_predictions(
        composite_frame[["date", "code", "score", "label"]],
        top_k=top_k,
        label_horizon=label_horizon,
        cost_bps=cost_bps,
    )
    composite_metrics = {
        name: (_finite(value) if not isinstance(value, int) else value)
        for name, value in composite_metrics.items()
    }

    latest_date = pd.Timestamp(features["date"].max())
    latest = features[features["date"] == latest_date].dropna(subset=FEATURE_COLUMNS).copy()
    latest_scores = _composite_predictions(latest, last_weights, len(folds) + 1)
    latest = latest.assign(score=latest_scores["score"].to_numpy()).sort_values("score", ascending=False)
    candidates = [{
        "code": str(row.code).zfill(6),
        "name": str(getattr(row, "name", "") or row.code),
        "score": _finite(row.score),
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "trainedThrough": pd.Timestamp(folds[-1].validation_end).strftime("%Y-%m-%d"),
    } for row in latest.head(max(int(top_k), 1)).itertuples(index=False)]

    run_dir = workspace_root / "factor-runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    scores_path = run_dir / "factor_scores.parquet"
    pd.concat(all_prediction_frames, ignore_index=True).to_parquet(scores_path, index=False, compression="zstd")
    warnings = list(manifest.get("warnings") or [])
    warnings.extend([
        "Factor directions and ensemble weights are selected from each validation window only.",
        "Admission labels are exploratory gates, not evidence of future profitability.",
        "Public unadjusted daily data cannot support production factor approval.",
    ])
    result = {
        "schema": "webstock.quant.factor-lab.v1",
        "runId": run_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "validationStatus": "validated" if manifest.get("eligibility") == "validation_eligible" else "exploratory",
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "dataManifest": {
            "datasetId": manifest["datasetId"],
            "sha256": manifest["manifestSha256"],
            "path": manifest_path.resolve().relative_to(workspace_root.resolve()).as_posix(),
        },
        "runtime": _runtime_versions(),
        "parameters": {
            "trainDays": int(train_days),
            "validationDays": int(validation_days),
            "testDays": int(test_days),
            "stepDays": int(step_days),
            "labelHorizon": int(label_horizon),
            "maxFolds": int(max_folds),
            "topK": int(top_k),
            "costBps": float(cost_bps),
            "costModel": "turnover-bps-with-terminal-liquidation-v2",
            "seed": int(seed),
        },
        "folds": [fold.to_contract() for fold in folds],
        "factors": factors,
        "composite": {
            "factorId": "validation-weighted-composite",
            "displayName": "验证期加权复合因子",
            "metrics": composite_metrics,
            "latestWeights": {factor: _finite(weight) for factor, weight in last_weights.items()},
            "candidates": candidates,
        },
        "artifacts": [{
            "path": scores_path.relative_to(run_dir).as_posix(),
            "sha256": file_sha256(scores_path),
            "rows": int(sum(len(frame) for frame in all_prediction_frames)),
        }],
        "warnings": warnings,
    }
    result_path = run_dir / "result.json"
    write_json_atomic(result_path, result)
    if emit:
        emit({
            "stage": "factor-complete",
            "message": f"Factor lab completed: {len(factors)} factors, {len(folds)} folds",
        })
    return result_path, result
