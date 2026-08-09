import importlib.metadata
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic
from .pipeline import FEATURE_COLUMNS, RollingFold, build_features, build_rolling_folds, evaluate_predictions


class QlibPanelDataset:
    def __init__(self, frame, fold):
        self.frame = frame
        self.fold = fold
        self.segments = {
            "train": (fold.train_start, fold.train_end),
            "valid": (fold.validation_start, fold.validation_end),
            "test": (fold.test_start, fold.test_end),
        }

    def prepare(self, segment, col_set=None, data_key=None):
        if segment not in self.segments:
            raise KeyError("unknown dataset segment: " + str(segment))
        start, end = self.segments[segment]
        selected = self.frame[(self.frame["date"] >= start) & (self.frame["date"] <= end)].copy()
        require_label = col_set != "feature"
        required = FEATURE_COLUMNS + (["label"] if require_label else [])
        selected = selected.dropna(subset=required)
        selected = selected.set_index(["date", "code"]).sort_index()
        selected.index = selected.index.set_names(["datetime", "instrument"])
        features = selected[FEATURE_COLUMNS].astype(float)
        if col_set == "feature":
            return features
        labels = selected[["label"]].astype(float).rename(columns={"label": "LABEL0"})
        return pd.concat({"feature": features, "label": labels}, axis=1)


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
        frames.append(pd.read_parquet(target))
    if not frames:
        raise ValueError("dataset has no raw parquet artifacts")
    return pd.concat(frames, ignore_index=True)


def _runtime_versions():
    versions = {
        "python": os.sys.version.split()[0],
        "qlib": importlib.metadata.version("pyqlib"),
        "lightgbm": importlib.metadata.version("lightgbm"),
        "pandas": importlib.metadata.version("pandas"),
        "pyarrow": importlib.metadata.version("pyarrow"),
    }
    try:
        versions["torch"] = importlib.metadata.version("torch")
    except importlib.metadata.PackageNotFoundError:
        pass
    return versions


def _initialize_qlib(workspace):
    import qlib
    from mlflow.tracking import MlflowClient

    runtime_dir = Path(workspace) / "qlib-runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    tracking_uri = "sqlite:///" + str(runtime_dir / "mlflow.db").replace("\\", "/")
    artifact_dir = runtime_dir / "mlruns"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    client = MlflowClient(tracking_uri=tracking_uri)
    if client.get_experiment_by_name("webstock-quant") is None:
        client.create_experiment("webstock-quant", artifact_location=artifact_dir.resolve().as_uri())
    qlib.init(
        provider_uri=str(runtime_dir),
        exp_manager={
            "class": "MLflowExpManager",
            "module_path": "qlib.workflow.expm",
            "kwargs": {"uri": tracking_uri, "default_exp_name": "webstock-quant"},
        },
    )


def _new_model(seed, num_boost_round, early_stopping_rounds):
    from qlib.contrib.model.gbdt import LGBModel

    return LGBModel(
        loss="mse",
        num_boost_round=int(num_boost_round),
        early_stopping_rounds=int(early_stopping_rounds),
        learning_rate=0.05,
        num_leaves=31,
        max_depth=-1,
        min_data_in_leaf=20,
        feature_fraction=0.9,
        bagging_fraction=0.9,
        bagging_freq=1,
        lambda_l1=0.05,
        lambda_l2=0.1,
        num_threads=min(max(os.cpu_count() or 2, 1), 8),
        deterministic=True,
        force_col_wise=True,
        seed=int(seed),
        feature_fraction_seed=int(seed),
        bagging_seed=int(seed),
        data_random_seed=int(seed),
    )


def _finite(value):
    number = float(value)
    return number if math.isfinite(number) else 0.0


def run_lightgbm_baseline(
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
    num_boost_round=300,
    early_stopping_rounds=30,
    emit=None,
):
    dataset_root = Path(dataset_dir)
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    expected_manifest_hash = manifest_sha256(manifest)
    if expected_manifest_hash != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")

    if emit:
        emit({"stage": "prepare", "message": "正在校验数据哈希并计算特征"})
    panel = _load_panel(dataset_root, manifest)
    features = build_features(panel, label_horizon=label_horizon)
    usable = features.dropna(subset=FEATURE_COLUMNS + ["label"])
    dates = pd.DatetimeIndex(usable["date"].unique()).sort_values()
    if usable["code"].nunique() < 3:
        raise ValueError("at least three instruments are required for a cross-sectional baseline")

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
        raise ValueError(f"not enough trading dates for rolling validation; at least {required_days} are required")

    Path(workspace).mkdir(parents=True, exist_ok=True)
    _initialize_qlib(workspace)
    from qlib.workflow import R

    prediction_frames = []
    fitted_models = []
    with R.start(experiment_name="webstock-quant", recorder_name=run_id):
        for index, fold in enumerate(folds, start=1):
            if emit:
                emit({
                    "stage": "train",
                    "current": index,
                    "total": len(folds),
                    "message": f"正在训练第 {index}/{len(folds)} 个滚动窗口",
                })
            dataset = QlibPanelDataset(features, fold)
            model = _new_model(seed + index, num_boost_round, early_stopping_rounds)
            model.fit(dataset, verbose_eval=0)
            predictions = model.predict(dataset, segment="test").rename("score").reset_index()
            labels = dataset.prepare("test", col_set=["feature", "label"])["label"]["LABEL0"]
            predictions["label"] = labels.reindex(
                pd.MultiIndex.from_frame(predictions[["datetime", "instrument"]])
            ).to_numpy()
            predictions = predictions.rename(columns={"datetime": "date", "instrument": "code"})
            predictions["fold"] = index
            prediction_frames.append(predictions)
            fitted_models.append((model, fold))

    all_predictions = pd.concat(prediction_frames, ignore_index=True).dropna(subset=["score", "label"])
    metrics = evaluate_predictions(
        all_predictions[["date", "code", "score", "label"]],
        top_k=top_k,
        label_horizon=label_horizon,
        cost_bps=cost_bps,
    )
    metrics = {key: (_finite(value) if not isinstance(value, int) else value) for key, value in metrics.items()}

    latest_date = pd.Timestamp(features["date"].max())
    latest = features[features["date"] == latest_date].dropna(subset=FEATURE_COLUMNS).copy()
    last_model, last_fold = fitted_models[-1]
    latest["score"] = last_model.model.predict(latest[FEATURE_COLUMNS].to_numpy())
    latest = latest.sort_values("score", ascending=False).head(max(int(top_k), 1))
    candidates = [
        {
            "code": str(row.code).zfill(6),
            "name": str(getattr(row, "name", "") or row.code),
            "score": _finite(row.score),
            "asOf": latest_date.strftime("%Y-%m-%d"),
            "modelTrainedThrough": pd.Timestamp(last_fold.validation_end).strftime("%Y-%m-%d"),
        }
        for row in latest.itertuples(index=False)
    ]

    run_dir = Path(workspace) / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    predictions_path = run_dir / "predictions.parquet"
    all_predictions.to_parquet(predictions_path, index=False, compression="zstd")

    feature_importance = []
    if fitted_models and fitted_models[-1][0].model is not None:
        importance = fitted_models[-1][0].model.feature_importance(importance_type="gain")
        feature_importance = [
            {"feature": feature, "gain": _finite(gain)}
            for feature, gain in sorted(zip(FEATURE_COLUMNS, importance), key=lambda item: item[1], reverse=True)
        ]

    warnings = list(manifest.get("warnings") or [])
    warnings.append(
        "该结果为公开未复权日线上的探索性滚动回测，不能作为实盘收益或模型有效性证明。"
    )
    result = {
        "schema": "webstock.quant.result.v1",
        "runId": run_id,
        "modelId": "qlib-lightgbm-v2",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "validationStatus": "exploratory",
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "dataManifest": {
            "datasetId": manifest["datasetId"],
            "sha256": manifest["manifestSha256"],
            "path": manifest_path.resolve().relative_to(Path(workspace).resolve()).as_posix(),
        },
        "runtime": _runtime_versions(),
        "featureSet": "webstock-daily-technical-v1",
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
            "numBoostRound": int(num_boost_round),
            "earlyStoppingRounds": int(early_stopping_rounds),
        },
        "folds": [fold.to_contract() for fold in folds],
        "metrics": metrics,
        "candidates": candidates,
        "featureImportance": feature_importance,
        "artifacts": [{
            "path": predictions_path.relative_to(run_dir).as_posix(),
            "sha256": file_sha256(predictions_path),
            "rows": int(len(all_predictions)),
        }],
        "warnings": warnings,
    }
    result_path = run_dir / "result.json"
    write_json_atomic(result_path, result)
    if emit:
        emit({
            "stage": "run-complete",
            "message": f"滚动回测完成：{len(folds)} 个窗口，{len(candidates)} 只候选",
        })
    return result_path, result
