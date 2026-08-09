import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from webstock_quant.cli import build_parser, resolve_manifest_output_path
from webstock_quant.master_model import (
    DailySequence,
    MarketGuidedStockTransformer,
    build_daily_sequences,
    fit_robust_scaler,
    normalize_cross_section_labels,
    predict_master_batches,
    run_master_baseline,
    train_master_model,
)
from webstock_quant.manifest import file_sha256, manifest_sha256, write_json_atomic
from webstock_quant.pipeline import FEATURE_COLUMNS, build_features


def sample_panel(days=90, instruments=("000001", "600000", "300750")):
    dates = pd.bdate_range("2025-01-02", periods=days)
    rows = []
    for instrument_index, code in enumerate(instruments):
        for day_index, date in enumerate(dates):
            close = 10 + instrument_index * 3 + day_index * (0.02 + instrument_index * 0.003)
            rows.append({
                "date": date,
                "code": code,
                "name": code,
                "open": close * 0.998,
                "high": close * 1.01,
                "low": close * 0.99,
                "close": close,
                "volume": 1_000_000 + day_index * 1_000 + instrument_index * 5_000,
            })
    return pd.DataFrame(rows)


class MasterDataTests(unittest.TestCase):
    def test_sequence_builder_uses_only_target_date_and_earlier_features(self):
        features = build_features(sample_panel(), label_horizon=5)
        target_dates = pd.DatetimeIndex(features["date"].unique()).sort_values()[65:70]
        train = features[features["date"] < target_dates[0]]
        scaler = fit_robust_scaler(train, FEATURE_COLUMNS)
        baseline = build_daily_sequences(features, target_dates, scaler, lookback=8)

        changed = features.copy()
        changed.loc[changed["date"] > target_dates[-1], FEATURE_COLUMNS] = 999_999
        repeated = build_daily_sequences(changed, target_dates, scaler, lookback=8)

        self.assertEqual([batch.date for batch in baseline], [batch.date for batch in repeated])
        for first, second in zip(baseline, repeated):
            np.testing.assert_allclose(first.features, second.features)

    def test_validation_sequences_keep_feature_valid_stocks_with_nan_labels(self):
        features = build_features(sample_panel(), label_horizon=5)
        target_date = pd.Timestamp(features["date"].sort_values().unique()[-8])
        target_rows = features[features["date"] == target_date]
        missing_code = str(target_rows.iloc[0]["code"])
        features.loc[
            (features["date"] == target_date) & (features["code"] == missing_code),
            "label",
        ] = np.nan
        scaler = fit_robust_scaler(
            features[features["date"] < target_date],
            FEATURE_COLUMNS,
        )

        batches = build_daily_sequences(features, [target_date], scaler, lookback=8)

        self.assertEqual(len(batches), 1)
        self.assertIn(missing_code, batches[0].codes)
        missing_index = batches[0].codes.index(missing_code)
        self.assertTrue(np.isnan(batches[0].labels[missing_index]))

    def test_small_cross_section_is_not_emptied_by_extreme_label_filter(self):
        labels = np.asarray([0.01, -0.02, 0.03, 0.04, -0.01], dtype=np.float32)

        normalized, mask = normalize_cross_section_labels(labels, trim_fraction=0.05)

        self.assertEqual(mask.sum(), len(labels))
        self.assertTrue(np.isfinite(normalized[mask]).all())
        self.assertAlmostEqual(float(normalized[mask].mean()), 0.0, places=6)

    def test_cli_accepts_only_registered_model_ids(self):
        parser = build_parser()
        master = parser.parse_args([
            "run", "--workspace", "workspace", "--dataset-id", "dataset-001",
            "--run-id", "run-001", "--model", "master",
        ])
        self.assertEqual(master.model, "master")
        with self.assertRaises(SystemExit):
            parser.parse_args([
                "run", "--workspace", "workspace", "--dataset-id", "dataset-001",
                "--run-id", "run-002", "--model", "unknown-model",
            ])

    def test_relative_manifest_output_is_resolved_from_the_run_workspace(self):
        result_path = Path("D:/quant-workspace/runs/master-run/result.json")
        resolved = resolve_manifest_output_path(
            result_path,
            "datasets/dataset-001/manifest.json",
        )
        self.assertEqual(
            resolved,
            Path("D:/quant-workspace/datasets/dataset-001/manifest.json").resolve(),
        )

    def test_market_guided_transformer_scores_the_whole_daily_cross_section(self):
        model = MarketGuidedStockTransformer(
            stock_feature_count=len(FEATURE_COLUMNS),
            market_feature_count=len(FEATURE_COLUMNS) * 2,
            d_model=16,
            temporal_heads=2,
            cross_stock_heads=2,
            dropout=0.0,
            gate_temperature=1.0,
        )
        import torch

        inputs = torch.randn(5, 8, len(FEATURE_COLUMNS) * 3)
        scores = model(inputs)
        batched_scores = model(torch.stack([inputs, inputs]))

        self.assertEqual(tuple(scores.shape), (5,))
        self.assertEqual(tuple(batched_scores.shape), (2, 5))
        self.assertTrue(torch.isfinite(scores).all())

    def test_training_and_prediction_preserve_every_inference_stock(self):
        rng = np.random.default_rng(20260809)
        batches = []
        for day_index, date in enumerate(pd.bdate_range("2025-01-02", periods=5)):
            features = rng.normal(size=(5, 8, len(FEATURE_COLUMNS) * 3)).astype(np.float32)
            labels = features[:, -1, 0] * 0.02 + day_index * 0.001
            if day_index == 4:
                labels[0] = np.nan
            batches.append(DailySequence(
                date=date,
                codes=[str(index + 1).zfill(6) for index in range(5)],
                names=["stock-" + str(index) for index in range(5)],
                features=features,
                labels=labels.astype(np.float32),
            ))

        model, summary = train_master_model(
            batches[:4],
            batches[3:],
            stock_feature_count=len(FEATURE_COLUMNS),
            market_feature_count=len(FEATURE_COLUMNS) * 2,
            epochs=2,
            patience=2,
            d_model=8,
            temporal_heads=2,
            cross_stock_heads=2,
            dropout=0.0,
            seed=20260809,
        )
        predictions = predict_master_batches(model, batches[4:])

        self.assertEqual(summary["epochsTrained"], 2)
        self.assertEqual(len(predictions), 5)
        self.assertEqual(int(predictions["label"].isna().sum()), 1)
        self.assertTrue(np.isfinite(predictions["score"]).all())

    def test_training_rejects_validation_without_finite_labels(self):
        feature_count = len(FEATURE_COLUMNS)
        train = DailySequence(
            date=pd.Timestamp("2026-01-05"),
            codes=["000001", "000002", "000003"],
            names=["A", "B", "C"],
            features=np.ones((3, 4, feature_count * 3), dtype=np.float32),
            labels=np.asarray([0.01, 0.02, -0.01], dtype=np.float32),
        )
        validation = DailySequence(
            date=pd.Timestamp("2026-01-06"),
            codes=["000001", "000002", "000003"],
            names=["A", "B", "C"],
            features=np.ones((3, 4, feature_count * 3), dtype=np.float32),
            labels=np.asarray([np.nan, np.nan, np.nan], dtype=np.float32),
        )

        with self.assertRaisesRegex(ValueError, "validation has fewer than two finite labels"):
            train_master_model(
                [train],
                [validation],
                stock_feature_count=feature_count,
                market_feature_count=feature_count * 2,
                epochs=1,
            )

    def test_master_run_writes_a_traceable_result_for_the_same_dataset_contract(self):
        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            dataset_dir = workspace / "datasets" / "master-test-data"
            raw_dir = dataset_dir / "raw"
            raw_dir.mkdir(parents=True)
            panel_path = raw_dir / "panel.parquet"
            sample_panel(days=180).to_parquet(panel_path, index=False)
            manifest = {
                "datasetId": "master-test-data",
                "asOf": "2025-06-30",
                "files": [{
                    "path": "raw/panel.parquet",
                    "sha256": file_sha256(panel_path),
                    "rows": 540,
                }],
                "warnings": ["Synthetic test data."],
            }
            manifest["manifestSha256"] = manifest_sha256(manifest)
            write_json_atomic(dataset_dir / "manifest.json", manifest)

            result_path, result = run_master_baseline(
                dataset_dir=dataset_dir,
                workspace=workspace,
                run_id="master-test-run",
                train_days=60,
                validation_days=15,
                test_days=10,
                step_days=10,
                label_horizon=5,
                max_folds=1,
                top_k=3,
                epochs=2,
                patience=2,
                d_model=8,
                temporal_heads=2,
                cross_stock_heads=2,
                dropout=0.0,
            )

            self.assertTrue(result_path.exists())
            self.assertEqual(result["modelId"], "master-market-guided-v1")
            self.assertEqual(result["dataManifest"]["datasetId"], "master-test-data")
            self.assertEqual(result["parameters"]["trainDays"], 60)
            self.assertGreater(result["artifacts"][0]["rows"], 0)
            self.assertEqual(len(result["folds"]), 1)


if __name__ == "__main__":
    unittest.main()
