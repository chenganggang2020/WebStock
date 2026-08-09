import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from webstock_quant.pipeline import (
    FEATURE_COLUMNS,
    build_features,
    build_rolling_folds,
    evaluate_predictions,
)
from webstock_quant.collector import select_universe
from webstock_quant.manifest import manifest_sha256
from webstock_quant.model import QlibPanelDataset


def sample_panel(days=90, instruments=('000001', '600000', '300750')):
    dates = pd.bdate_range('2025-01-02', periods=days)
    rows = []
    for instrument_index, code in enumerate(instruments):
        for day_index, date in enumerate(dates):
            close = 10 + instrument_index * 3 + day_index * (0.02 + instrument_index * 0.003)
            rows.append({
                'date': date,
                'code': code,
                'name': code,
                'open': close * 0.998,
                'high': close * 1.01,
                'low': close * 0.99,
                'close': close,
                'volume': 1_000_000 + day_index * 1_000 + instrument_index * 5_000,
            })
    return pd.DataFrame(rows)


class FeatureTests(unittest.TestCase):
    def test_future_prices_do_not_change_past_features(self):
        panel = sample_panel()
        baseline = build_features(panel, label_horizon=5)

        changed = panel.copy()
        future_mask = changed['date'] >= changed['date'].sort_values().unique()[-10]
        changed.loc[future_mask, 'close'] *= 4
        changed_features = build_features(changed, label_horizon=5)

        cutoff = panel['date'].sort_values().unique()[-11]
        feature_columns = [column for column in baseline.columns if column.startswith('feature_')]
        pd.testing.assert_frame_equal(
            baseline.loc[baseline['date'] <= cutoff, feature_columns].reset_index(drop=True),
            changed_features.loc[changed_features['date'] <= cutoff, feature_columns].reset_index(drop=True),
        )

    def test_rolling_folds_are_ordered_and_purged_by_label_horizon(self):
        dates = pd.bdate_range('2020-01-01', periods=180)
        folds = build_rolling_folds(
            dates,
            train_days=80,
            validation_days=30,
            test_days=20,
            step_days=20,
            label_horizon=5,
            max_folds=3,
        )
        self.assertEqual(len(folds), 3)
        for fold in folds:
            self.assertLess(fold.train_end, fold.validation_start)
            self.assertLess(fold.validation_end, fold.test_start)
            self.assertGreaterEqual(fold.purge_days, 5)

    def test_rolling_folds_reject_overlapping_test_windows(self):
        dates = pd.bdate_range('2020-01-01', periods=220)
        with self.assertRaisesRegex(ValueError, 'overlapping'):
            build_rolling_folds(
                dates,
                train_days=80,
                validation_days=30,
                test_days=40,
                step_days=20,
                label_horizon=5,
                max_folds=3,
            )

    def test_transaction_costs_reduce_net_return(self):
        predictions = pd.DataFrame({
            'date': pd.to_datetime(['2025-01-02'] * 3 + ['2025-01-09'] * 3),
            'code': ['000001', '600000', '300750'] * 2,
            'score': [3, 2, 1, 1, 3, 2],
            'label': [0.04, 0.02, -0.01, -0.02, 0.03, 0.01],
        })
        free = evaluate_predictions(predictions, top_k=2, label_horizon=5, cost_bps=0)
        charged = evaluate_predictions(predictions, top_k=2, label_horizon=5, cost_bps=10)
        self.assertGreater(free['cumulativeReturn'], charged['cumulativeReturn'])
        self.assertGreater(charged['totalCost'], 0)
        self.assertGreater(charged['liquidationCost'], 0)
        self.assertEqual(charged['tradeCount'], 4)

    def test_forward_return_backtest_does_not_overlap_holding_periods(self):
        dates = pd.bdate_range('2025-01-02', periods=12)
        rows = []
        for date_index, day in enumerate(dates):
            for code_index, code in enumerate(['000001', '600000', '300750']):
                rows.append({
                    'date': day,
                    'code': code,
                    'score': 3 - code_index,
                    'label': 0.01 + date_index * 0.0001 - code_index * 0.001,
                })
        metrics = evaluate_predictions(pd.DataFrame(rows), top_k=2, label_horizon=5, cost_bps=0)
        self.assertEqual(metrics['rebalanceCount'], 3)

    def test_universe_selection_excludes_current_st_and_is_deterministic(self):
        stocks = [
            {'code': '000001', 'name': '平安银行'},
            {'code': '000002', 'name': 'ST测试'},
            {'code': '300750', 'name': '宁德时代'},
            {'code': '600000', 'name': '浦发银行'},
            {'code': '920001', 'name': '北交测试'},
        ]
        first, excluded = select_universe(stocks, limit=3)
        second, _ = select_universe(stocks, limit=3)
        self.assertEqual(first, second)
        self.assertNotIn('000002', [item['code'] for item in first])
        self.assertEqual(excluded['currentSt'], 1)

    def test_manifest_hash_does_not_hash_its_own_digest(self):
        manifest = {'schema': 'webstock.quant.dataset.v1', 'datasetId': 'demo'}
        digest = manifest_sha256(manifest)
        manifest['manifestSha256'] = digest
        self.assertEqual(manifest_sha256(manifest), digest)

    def test_qlib_dataset_adapter_preserves_feature_and_label_columns(self):
        features = build_features(sample_panel(days=150), label_horizon=5)
        dates = features['date'].sort_values().unique()
        fold = build_rolling_folds(
            dates,
            train_days=80,
            validation_days=20,
            test_days=15,
            step_days=15,
            label_horizon=5,
            max_folds=1,
        )[0]
        dataset = QlibPanelDataset(features, fold)
        train = dataset.prepare('train', col_set=['feature', 'label'])
        test_features = dataset.prepare('test', col_set='feature')
        self.assertFalse(train.empty)
        self.assertEqual(list(train['feature'].columns), FEATURE_COLUMNS)
        self.assertEqual(list(train['label'].columns), ['LABEL0'])
        self.assertEqual(list(test_features.columns), FEATURE_COLUMNS)

    def test_qlib_tracking_artifacts_stay_inside_quant_workspace(self):
        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory) / 'quant-workspace'
            script = (
                "import sys; from pathlib import Path; "
                "from mlflow.tracking import MlflowClient; "
                "from webstock_quant.model import _initialize_qlib; "
                "workspace=Path(sys.argv[1]); _initialize_qlib(workspace); "
                "uri='sqlite:///'+str(workspace/'qlib-runtime'/'mlflow.db').replace(chr(92),'/'); "
                "experiment=MlflowClient(tracking_uri=uri).get_experiment_by_name('webstock-quant'); "
                "print('WEBSTOCK_ARTIFACT='+experiment.artifact_location)"
            )
            completed = subprocess.run(
                [sys.executable, '-c', script, str(workspace)],
                check=True,
                capture_output=True,
                text=True,
            )
            artifact_line = next(
                line for line in completed.stdout.splitlines() if line.startswith('WEBSTOCK_ARTIFACT=')
            )
            expected = (workspace / 'qlib-runtime' / 'mlruns').resolve().as_uri()
            self.assertEqual(artifact_line.split('=', 1)[1].rstrip('/'), expected.rstrip('/'))


if __name__ == '__main__':
    unittest.main()
