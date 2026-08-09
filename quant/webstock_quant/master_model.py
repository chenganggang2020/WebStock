from dataclasses import dataclass
import copy
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic
from .pipeline import FEATURE_COLUMNS, build_features, build_rolling_folds, evaluate_predictions

try:
    import torch
    from torch import nn
except ImportError:  # Runtime health reports the missing optional dependency.
    torch = None
    nn = None


if nn is not None:
    class _PositionalEncoding(nn.Module):
        def __init__(self, d_model, max_length=256):
            super().__init__()
            positions = torch.arange(max_length, dtype=torch.float32).unsqueeze(1)
            scales = torch.exp(
                torch.arange(0, d_model, 2, dtype=torch.float32)
                * (-np.log(10_000.0) / d_model)
            )
            encoding = torch.zeros(max_length, d_model, dtype=torch.float32)
            encoding[:, 0::2] = torch.sin(positions * scales)
            encoding[:, 1::2] = torch.cos(positions * scales)
            self.register_buffer("encoding", encoding, persistent=False)

        def forward(self, values):
            return values + self.encoding[:values.shape[1]]


    class MarketGuidedStockTransformer(nn.Module):
        """MASTER-compatible feature gate with temporal and cross-stock attention."""

        def __init__(
            self,
            stock_feature_count,
            market_feature_count,
            d_model=32,
            temporal_heads=2,
            cross_stock_heads=2,
            dropout=0.1,
            gate_temperature=1.0,
        ):
            super().__init__()
            if d_model % temporal_heads or d_model % cross_stock_heads:
                raise ValueError("d_model must be divisible by both attention head counts")
            self.stock_feature_count = int(stock_feature_count)
            self.market_feature_count = int(market_feature_count)
            self.gate_temperature = max(float(gate_temperature), 1e-6)
            self.feature_gate = nn.Linear(self.market_feature_count, self.stock_feature_count)
            self.input_projection = nn.Linear(self.stock_feature_count, d_model)
            self.position = _PositionalEncoding(d_model)
            self.temporal_attention = nn.MultiheadAttention(
                d_model, temporal_heads, dropout=dropout, batch_first=True
            )
            self.temporal_norm = nn.LayerNorm(d_model)
            self.temporal_ffn = nn.Sequential(
                nn.Linear(d_model, d_model),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
                nn.Dropout(dropout),
            )
            self.cross_stock_attention = nn.MultiheadAttention(
                d_model, cross_stock_heads, dropout=dropout, batch_first=True
            )
            self.cross_stock_norm = nn.LayerNorm(d_model)
            self.cross_stock_ffn = nn.Sequential(
                nn.Linear(d_model, d_model),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(d_model, d_model),
                nn.Dropout(dropout),
            )
            self.temporal_pool = nn.Linear(d_model, d_model, bias=False)
            self.decoder = nn.Linear(d_model, 1)

        def forward(self, values):
            expected = self.stock_feature_count + self.market_feature_count
            squeeze_batch = values.ndim == 3
            if squeeze_batch:
                values = values.unsqueeze(0)
            if values.ndim != 4 or values.shape[-1] != expected:
                raise ValueError(f"expected [days, stocks, time, {expected}] input")

            day_count, stock_count, time_count, _ = values.shape
            stock = values[:, :, :, :self.stock_feature_count]
            market = values[:, :, -1, self.stock_feature_count:].mean(dim=1)
            gate = torch.softmax(self.feature_gate(market) / self.gate_temperature, dim=-1)
            stock = stock * (gate * self.stock_feature_count).unsqueeze(1).unsqueeze(1)

            hidden = self.input_projection(stock).reshape(day_count * stock_count, time_count, -1)
            hidden = self.position(hidden)
            attended, _ = self.temporal_attention(hidden, hidden, hidden, need_weights=False)
            hidden = self.temporal_norm(hidden + attended)
            hidden = hidden + self.temporal_ffn(hidden)
            hidden = hidden.reshape(day_count, stock_count, time_count, -1)

            cross_input = hidden.permute(0, 2, 1, 3).reshape(day_count * time_count, stock_count, -1)
            attended, _ = self.cross_stock_attention(
                cross_input, cross_input, cross_input, need_weights=False
            )
            cross_input = self.cross_stock_norm(cross_input + attended)
            cross_input = cross_input + self.cross_stock_ffn(cross_input)
            hidden = cross_input.reshape(day_count, time_count, stock_count, -1).permute(0, 2, 1, 3)

            hidden = hidden.reshape(day_count * stock_count, time_count, -1)
            transformed = self.temporal_pool(hidden)
            weights = torch.softmax(
                torch.matmul(transformed, transformed[:, -1, :].unsqueeze(-1)).squeeze(-1),
                dim=1,
            )
            pooled = torch.sum(hidden * weights.unsqueeze(-1), dim=1)
            scores = self.decoder(pooled).squeeze(-1).reshape(day_count, stock_count)
            return scores[0] if squeeze_batch else scores
else:
    class MarketGuidedStockTransformer:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("MASTER requires the locked PyTorch runtime")


@dataclass(frozen=True)
class RobustScaler:
    columns: tuple
    median: np.ndarray
    scale: np.ndarray

    def transform(self, values):
        array = np.asarray(values, dtype=np.float32)
        normalized = (array - self.median) / self.scale
        return np.nan_to_num(np.clip(normalized, -3.0, 3.0), nan=0.0, posinf=3.0, neginf=-3.0)


@dataclass(frozen=True)
class DailySequence:
    date: pd.Timestamp
    codes: list
    names: list
    features: np.ndarray
    labels: np.ndarray


def fit_robust_scaler(frame, columns):
    if frame.empty:
        raise ValueError("training frame is empty")
    values = frame[list(columns)].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=np.float32)
    median = np.nanmedian(values, axis=0)
    median = np.nan_to_num(median, nan=0.0)
    mad = np.nanmedian(np.abs(values - median), axis=0)
    scale = np.where(np.isfinite(mad) & (mad > 1e-12), mad * 1.4826, 1.0)
    return RobustScaler(tuple(columns), median.astype(np.float32), scale.astype(np.float32))


def normalize_cross_section_labels(labels, trim_fraction=0.05):
    values = np.asarray(labels, dtype=np.float32)
    finite_indices = np.flatnonzero(np.isfinite(values))
    mask = np.zeros(values.shape, dtype=bool)
    if not len(finite_indices):
        return np.zeros(values.shape, dtype=np.float32), mask

    trim = int(np.floor(len(finite_indices) * max(float(trim_fraction), 0.0) / 2.0))
    ordered = finite_indices[np.argsort(values[finite_indices], kind="stable")]
    kept = ordered[trim:len(ordered) - trim] if trim else ordered
    mask[kept] = True

    normalized = np.zeros(values.shape, dtype=np.float32)
    selected = values[mask]
    standard_deviation = float(selected.std(ddof=1)) if len(selected) > 1 else 0.0
    if standard_deviation > 1e-12:
        normalized[mask] = (selected - float(selected.mean())) / standard_deviation
    return normalized, mask


def build_daily_sequences(frame, target_dates, scaler, lookback=8):
    lookback = int(lookback)
    if lookback < 2:
        raise ValueError("lookback must be at least two trading observations")
    required = {"date", "code", "label"}.union(scaler.columns)
    missing = required.difference(frame.columns)
    if missing:
        raise ValueError("missing sequence columns: " + ", ".join(sorted(missing)))

    prepared = frame.copy()
    prepared["date"] = pd.to_datetime(prepared["date"], errors="coerce")
    prepared["code"] = prepared["code"].astype(str).str.replace(r"\D", "", regex=True).str.zfill(6)
    prepared = prepared.dropna(subset=["date", "code"])
    prepared = prepared.sort_values(["code", "date"], kind="stable").drop_duplicates(["code", "date"], keep="last")

    transformed = scaler.transform(prepared[list(scaler.columns)].to_numpy())
    transformed_columns = ["_master_feature_" + str(index) for index in range(len(scaler.columns))]
    prepared[transformed_columns] = transformed

    market = prepared.groupby("date", sort=True)[transformed_columns].agg(["mean", "std"])
    market.columns = [f"{name}_{stat}" for name, stat in market.columns]
    market = market.fillna(0.0)
    market_columns = list(market.columns)
    prepared = prepared.merge(market.reset_index(), on="date", how="left", validate="many_to_one")

    by_code = {code: group.reset_index(drop=True) for code, group in prepared.groupby("code", sort=True)}
    output = []
    for raw_date in pd.DatetimeIndex(pd.to_datetime(pd.Index(target_dates), errors="coerce")).dropna().unique().sort_values():
        codes = []
        names = []
        feature_rows = []
        labels = []
        for code, stock in by_code.items():
            history = stock[stock["date"] <= raw_date].tail(lookback)
            if len(history) != lookback or pd.Timestamp(history.iloc[-1]["date"]) != pd.Timestamp(raw_date):
                continue
            combined = history[transformed_columns + market_columns].to_numpy(dtype=np.float32)
            if not np.isfinite(combined).all():
                continue
            latest = history.iloc[-1]
            codes.append(code)
            names.append(str(latest.get("name") or code))
            feature_rows.append(combined)
            labels.append(pd.to_numeric(pd.Series([latest["label"]]), errors="coerce").iloc[0])
        if feature_rows:
            output.append(DailySequence(
                date=pd.Timestamp(raw_date),
                codes=codes,
                names=names,
                features=np.stack(feature_rows).astype(np.float32),
                labels=np.asarray(labels, dtype=np.float32),
            ))
    return output


def _require_torch():
    if torch is None:
        raise RuntimeError("MASTER requires the locked PyTorch runtime")


def _batch_groups(batches, batch_days):
    grouped = {}
    for batch in batches:
        grouped.setdefault(int(batch.features.shape[0]), []).append(batch)
    for group in grouped.values():
        for start in range(0, len(group), int(batch_days)):
            yield group[start:start + int(batch_days)]


def _batch_loss(model, batches, device, trim_fraction):
    if isinstance(batches, DailySequence):
        batches = [batches]
    normalized_rows = []
    mask_rows = []
    for batch in batches:
        normalized, mask = normalize_cross_section_labels(batch.labels, trim_fraction=trim_fraction)
        normalized_rows.append(normalized)
        mask_rows.append(mask)
    mask = np.stack(mask_rows)
    if int(mask.sum()) < 2:
        return None
    features = torch.from_numpy(np.stack([batch.features for batch in batches])).to(
        device=device, dtype=torch.float32
    )
    labels = torch.from_numpy(np.stack(normalized_rows)).to(device=device, dtype=torch.float32)
    mask_tensor = torch.from_numpy(mask).to(device=device)
    predictions = model(features)
    return torch.mean((predictions[mask_tensor] - labels[mask_tensor]) ** 2)


def _mean_loss(model, batches, device, batch_days):
    model.eval()
    losses = []
    with torch.no_grad():
        for batch_group in _batch_groups(batches, batch_days):
            loss = _batch_loss(model, batch_group, device, trim_fraction=0.0)
            if loss is not None and math.isfinite(float(loss)):
                losses.append(float(loss))
    return float(np.mean(losses)) if losses else math.inf


def train_master_model(
    train_batches,
    validation_batches,
    stock_feature_count,
    market_feature_count,
    epochs=20,
    patience=4,
    learning_rate=1e-3,
    d_model=32,
    temporal_heads=2,
    cross_stock_heads=2,
    dropout=0.1,
    gate_temperature=1.0,
    seed=20260809,
    device_name="cpu",
    batch_days=16,
    on_epoch=None,
):
    _require_torch()
    if not train_batches:
        raise ValueError("MASTER training has no daily batches")
    if not validation_batches:
        raise ValueError("MASTER validation has no daily batches")

    np.random.seed(int(seed))
    torch.manual_seed(int(seed))
    torch.use_deterministic_algorithms(True, warn_only=True)
    torch.set_num_threads(min(max(os.cpu_count() or 2, 1), 8))
    device = torch.device(device_name)
    model = MarketGuidedStockTransformer(
        stock_feature_count=stock_feature_count,
        market_feature_count=market_feature_count,
        d_model=d_model,
        temporal_heads=temporal_heads,
        cross_stock_heads=cross_stock_heads,
        dropout=dropout,
        gate_temperature=gate_temperature,
    ).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=float(learning_rate))
    generator = np.random.default_rng(int(seed))
    best_state = copy.deepcopy(model.state_dict())
    best_loss = math.inf
    best_epoch = 0
    stale_epochs = 0
    history = []

    for epoch in range(1, int(epochs) + 1):
        model.train()
        losses = []
        shuffled = [train_batches[int(index)] for index in generator.permutation(len(train_batches))]
        for batch_group in _batch_groups(shuffled, batch_days):
            loss = _batch_loss(model, batch_group, device, trim_fraction=0.05)
            if loss is None:
                continue
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=3.0)
            optimizer.step()
            losses.append(float(loss.detach()))

        if not losses:
            raise ValueError("MASTER training has fewer than two finite labels per day")
        train_loss = float(np.mean(losses))
        validation_loss = _mean_loss(model, validation_batches, device, batch_days)
        if not math.isfinite(validation_loss):
            raise ValueError("MASTER validation has fewer than two finite labels per day")
        history.append({
            "epoch": epoch,
            "trainLoss": train_loss,
            "validationLoss": validation_loss,
        })
        if on_epoch:
            on_epoch(epoch, int(epochs), train_loss, validation_loss)

        if validation_loss < best_loss - 1e-8:
            best_loss = validation_loss
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
            stale_epochs = 0
        else:
            stale_epochs += 1
            if stale_epochs >= int(patience):
                break

    model.load_state_dict(best_state)
    model.eval()
    return model, {
        "epochsTrained": len(history),
        "bestEpoch": best_epoch,
        "bestValidationLoss": best_loss,
        "device": str(device),
        "history": history,
    }


def predict_master_batches(model, batches, device_name="cpu"):
    _require_torch()
    device = torch.device(device_name)
    rows = []
    model.to(device)
    model.eval()
    with torch.no_grad():
        for batch in batches:
            values = torch.from_numpy(batch.features).to(device=device, dtype=torch.float32)
            scores = model(values).detach().cpu().numpy()
            for code, name, score, label in zip(batch.codes, batch.names, scores, batch.labels):
                rows.append({
                    "date": batch.date,
                    "code": code,
                    "name": name,
                    "score": float(score),
                    "label": float(label) if np.isfinite(label) else np.nan,
                })
    return pd.DataFrame(rows, columns=["date", "code", "name", "score", "label"])


def run_master_baseline(
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
    lookback=8,
    epochs=20,
    patience=4,
    learning_rate=1e-3,
    d_model=32,
    temporal_heads=2,
    cross_stock_heads=2,
    dropout=0.1,
    gate_temperature=1.0,
    batch_days=16,
    emit=None,
):
    _require_torch()
    from .model import _finite, _load_panel, _runtime_versions

    dataset_root = Path(dataset_dir)
    workspace_root = Path(workspace)
    manifest_path = dataset_root / "manifest.json"
    manifest = read_json(manifest_path)
    if manifest_sha256(manifest) != str(manifest.get("manifestSha256") or "").lower():
        raise ValueError("dataset manifest hash mismatch")

    if emit:
        emit({"stage": "prepare", "message": "Checking dataset hashes and building MASTER sequences"})
    panel = _load_panel(dataset_root, manifest)
    features = build_features(panel, label_horizon=label_horizon)
    usable = features.dropna(subset=FEATURE_COLUMNS + ["label"])
    dates = pd.DatetimeIndex(usable["date"].unique()).sort_values()
    if usable["code"].nunique() < 3:
        raise ValueError("at least three instruments are required for cross-stock attention")
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

    workspace_root.mkdir(parents=True, exist_ok=True)
    prediction_frames = []
    fitted = []
    training_summaries = []
    for fold_index, fold in enumerate(folds, start=1):
        train_frame = features[
            (features["date"] >= fold.train_start) & (features["date"] <= fold.train_end)
        ]
        scaler = fit_robust_scaler(train_frame, FEATURE_COLUMNS)
        train_batches = build_daily_sequences(
            features,
            dates[(dates >= fold.train_start) & (dates <= fold.train_end)],
            scaler,
            lookback=lookback,
        )
        validation_batches = build_daily_sequences(
            features,
            dates[(dates >= fold.validation_start) & (dates <= fold.validation_end)],
            scaler,
            lookback=lookback,
        )
        test_batches = build_daily_sequences(
            features,
            dates[(dates >= fold.test_start) & (dates <= fold.test_end)],
            scaler,
            lookback=lookback,
        )

        def on_epoch(epoch, total, train_loss, validation_loss):
            if emit:
                emit({
                    "stage": "train",
                    "current": (fold_index - 1) * total + epoch,
                    "total": len(folds) * total,
                    "message": (
                        f"MASTER fold {fold_index}/{len(folds)}, epoch {epoch}/{total}, "
                        f"validation loss {validation_loss:.5f}"
                    ),
                })

        model, training_summary = train_master_model(
            train_batches,
            validation_batches,
            stock_feature_count=len(FEATURE_COLUMNS),
            market_feature_count=len(FEATURE_COLUMNS) * 2,
            epochs=epochs,
            patience=patience,
            learning_rate=learning_rate,
            d_model=d_model,
            temporal_heads=temporal_heads,
            cross_stock_heads=cross_stock_heads,
            dropout=dropout,
            gate_temperature=gate_temperature,
            seed=int(seed) + fold_index,
            batch_days=batch_days,
            on_epoch=on_epoch,
        )
        predictions = predict_master_batches(model, test_batches)
        predictions["fold"] = fold_index
        prediction_frames.append(predictions)
        fitted.append((model, fold, scaler))
        training_summaries.append(dict(training_summary, fold=fold_index))

    all_predictions = pd.concat(prediction_frames, ignore_index=True)
    metrics = evaluate_predictions(
        all_predictions[["date", "code", "score", "label"]],
        top_k=top_k,
        label_horizon=label_horizon,
        cost_bps=cost_bps,
    )
    metrics = {key: (_finite(value) if not isinstance(value, int) else value) for key, value in metrics.items()}

    latest_date = pd.Timestamp(features["date"].max())
    last_model, last_fold, last_scaler = fitted[-1]
    latest_batches = build_daily_sequences(features, [latest_date], last_scaler, lookback=lookback)
    if not latest_batches:
        raise ValueError("latest dataset date has no complete MASTER sequences")
    latest = predict_master_batches(last_model, latest_batches).sort_values("score", ascending=False)
    latest = latest.head(max(int(top_k), 1))
    candidates = [{
        "code": str(row.code).zfill(6),
        "name": str(row.name or row.code),
        "score": _finite(row.score),
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "modelTrainedThrough": pd.Timestamp(last_fold.validation_end).strftime("%Y-%m-%d"),
    } for row in latest.itertuples(index=False)]

    run_dir = workspace_root / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    predictions_path = run_dir / "predictions.parquet"
    all_predictions.to_parquet(predictions_path, index=False, compression="zstd")
    model_path = run_dir / "model.pt"
    torch.save({
        "modelId": "master-market-guided-v1",
        "stateDict": last_model.state_dict(),
        "featureColumns": FEATURE_COLUMNS,
        "lookback": int(lookback),
        "dModel": int(d_model),
        "temporalHeads": int(temporal_heads),
        "crossStockHeads": int(cross_stock_heads),
        "scaler": {
            "median": last_scaler.median.tolist(),
            "scale": last_scaler.scale.tolist(),
        },
    }, model_path)

    warnings = list(manifest.get("warnings") or [])
    warnings.extend([
        "Exploratory MASTER comparison on the same public, unadjusted daily dataset and rolling folds as LightGBM.",
        "Validation inference keeps all feature-valid stocks; missing labels are filtered only when metrics are computed.",
        "This implementation follows the official MASTER architecture concepts under its MIT license; it is not an official pretrained checkpoint.",
    ])
    result = {
        "schema": "webstock.quant.result.v1",
        "runId": run_id,
        "modelId": "master-market-guided-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "status": "completed",
        "validationStatus": "exploratory",
        "asOf": latest_date.strftime("%Y-%m-%d"),
        "dataManifest": {
            "datasetId": manifest["datasetId"],
            "sha256": manifest["manifestSha256"],
            "path": manifest_path.resolve().relative_to(workspace_root.resolve()).as_posix(),
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
            "lookback": int(lookback),
            "epochs": int(epochs),
            "patience": int(patience),
            "learningRate": float(learning_rate),
            "dModel": int(d_model),
            "temporalHeads": int(temporal_heads),
            "crossStockHeads": int(cross_stock_heads),
            "dropout": float(dropout),
            "gateTemperature": float(gate_temperature),
            "batchDays": int(batch_days),
            "preprocessing": "training-only robust-zscore-clip3-fill0; daily-label-trim5pct-cszscore",
        },
        "folds": [fold.to_contract() for fold in folds],
        "metrics": metrics,
        "candidates": candidates,
        "featureImportance": [],
        "training": training_summaries,
        "artifacts": [
            {
                "path": predictions_path.relative_to(run_dir).as_posix(),
                "sha256": file_sha256(predictions_path),
                "rows": int(len(all_predictions)),
            },
            {
                "path": model_path.relative_to(run_dir).as_posix(),
                "sha256": file_sha256(model_path),
                "rows": 0,
            },
        ],
        "warnings": warnings,
    }
    result_path = run_dir / "result.json"
    write_json_atomic(result_path, result)
    if emit:
        emit({
            "stage": "run-complete",
            "message": f"MASTER rolling evaluation completed: {len(folds)} folds, {len(candidates)} candidates",
        })
    return result_path, result
