import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from webstock_quant.factor_lab import run_factor_lab, select_factor_orientation
from webstock_quant.manifest import file_sha256, manifest_sha256, write_json_atomic


def sample_panel(days=220):
    dates = pd.bdate_range("2025-01-02", periods=days)
    rows = []
    for stock_index, code in enumerate(("000001", "600000", "300750", "688981")):
        for day_index, date in enumerate(dates):
            wave = np.sin(day_index / (5 + stock_index)) * 0.08
            close = 10 + stock_index * 2 + day_index * (0.015 + stock_index * 0.002) + wave
            rows.append({
                "date": date,
                "code": code,
                "name": "stock-" + code,
                "open": close * 0.997,
                "high": close * (1.01 + stock_index * 0.0005),
                "low": close * 0.99,
                "close": close,
                "volume": 1_000_000 + day_index * 2_000 + stock_index * 20_000,
            })
    return pd.DataFrame(rows)


class FactorLabTests(unittest.TestCase):
    def test_factor_orientation_is_selected_from_validation_rows_only(self):
        validation = pd.DataFrame({
            "date": pd.to_datetime(["2026-01-02"] * 4 + ["2026-01-05"] * 4),
            "factor": [1, 2, 3, 4, 4, 3, 2, 1],
            "label": [0.01, 0.02, 0.03, 0.04, 0.04, 0.03, 0.02, 0.01],
        })

        orientation, rank_ic = select_factor_orientation(validation, "factor")

        self.assertEqual(orientation, 1)
        self.assertAlmostEqual(rank_ic, 1.0)

    def test_factor_lab_writes_traceable_sample_out_result(self):
        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            dataset_dir = workspace / "datasets" / "factor-test-data"
            raw_dir = dataset_dir / "raw"
            raw_dir.mkdir(parents=True)
            panel_path = raw_dir / "panel.parquet"
            panel = sample_panel()
            panel.to_parquet(panel_path, index=False)
            universe_path = dataset_dir / "universe.json"
            write_json_atomic(universe_path, [{"code": "000001", "name": "stock-000001"}])
            manifest = {
                "datasetId": "factor-test-data",
                "eligibility": "exploratory_only",
                "files": [{
                    "path": "raw/panel.parquet",
                    "sha256": file_sha256(panel_path),
                    "rows": len(panel),
                }, {
                    "path": "universe.json",
                    "sha256": file_sha256(universe_path),
                    "rows": 1,
                }],
                "warnings": ["Synthetic test data."],
            }
            manifest["manifestSha256"] = manifest_sha256(manifest)
            write_json_atomic(dataset_dir / "manifest.json", manifest)

            result_path, result = run_factor_lab(
                dataset_dir=dataset_dir,
                workspace=workspace,
                run_id="factor-test-run",
                train_days=60,
                validation_days=20,
                test_days=20,
                step_days=20,
                label_horizon=5,
                max_folds=2,
                top_k=2,
                cost_bps=8,
            )

            self.assertTrue(result_path.exists())
            self.assertEqual(result["schema"], "webstock.quant.factor-lab.v1")
            self.assertEqual(result["validationStatus"], "exploratory")
            self.assertEqual(len(result["factors"]), 8)
            self.assertEqual(len(result["folds"]), 2)
            self.assertEqual(len(result["factors"][0]["folds"]), 2)
            self.assertTrue(result["composite"]["candidates"])
            self.assertTrue((result_path.parent / result["artifacts"][0]["path"]).exists())
            for factor in result["factors"]:
                self.assertIn(factor["admission"], {"candidate", "watch", "rejected"})
                self.assertTrue(np.isfinite(factor["metrics"]["rankIc"]))


if __name__ == "__main__":
    unittest.main()
