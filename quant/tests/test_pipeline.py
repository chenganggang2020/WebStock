import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import numpy as np
import pandas as pd
import requests

from webstock_quant.pipeline import (
    FEATURE_COLUMNS,
    build_features,
    build_rolling_folds,
    evaluate_predictions,
)
from webstock_quant.collector import (
    _sina_symbol,
    collect_dataset,
    fetch_sina_history,
    fetch_eastmoney_history,
    fetch_tencent_history,
    fetch_tencent_forward_adjusted_history,
    select_universe,
)
from webstock_quant.cli import build_parser
from webstock_quant.expert_backtest import run_expert_backtest
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
    def test_expert_backtest_uses_next_session_and_excludes_secondary_material(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            workspace = root / 'workspace'
            dataset_dir = workspace / 'datasets' / 'expert-demo'
            raw_dir = dataset_dir / 'raw'
            raw_dir.mkdir(parents=True)
            dates = pd.bdate_range('2025-01-02', periods=70)
            for code, slope in [('000001', 0.10), ('600000', 0.02), ('300750', -0.01)]:
                frame = pd.DataFrame({
                    'date': dates,
                    'code': code,
                    'name': code,
                    'open': [10 + slope * index for index in range(len(dates))],
                    'high': [10.2 + slope * index for index in range(len(dates))],
                    'low': [9.8 + slope * index for index in range(len(dates))],
                    'close': [10.1 + slope * index for index in range(len(dates))],
                    'volume': 1_000_000,
                })
                frame.to_parquet(raw_dir / (code + '.parquet'), index=False)
            from webstock_quant.manifest import file_sha256
            files = [{
                'path': 'raw/' + target.name,
                'sha256': file_sha256(target),
                'bytes': target.stat().st_size,
            } for target in sorted(raw_dir.glob('*.parquet'))]
            manifest = {
                'schema': 'webstock.quant.dataset.v1',
                'datasetId': 'expert-demo',
                'asOf': dates[-1].strftime('%Y-%m-%d'),
                'eligibility': 'exploratory_only',
                'files': files,
                'warnings': ['synthetic test dataset'],
            }
            manifest['manifestSha256'] = manifest_sha256(manifest)
            (dataset_dir / 'manifest.json').write_text(
                __import__('json').dumps(manifest), encoding='utf-8'
            )
            signals_path = root / 'signals.json'
            signals_path.write_text(__import__('json').dumps({
                'channelId': 7,
                'observations': [
                    {
                        'id': 11,
                        'publishedAt': '2025-01-03T14:30:00+08:00',
                        'publishedTimePrecision': 'minute',
                        'evidenceLevel': 'primary',
                        'contentRole': 'direct_quote',
                        'stance': 'bullish',
                        'stockCodes': ['000001'],
                    },
                    {
                        'id': 12,
                        'publishedAt': '2025-01-03T14:30:00+08:00',
                        'publishedTimePrecision': 'minute',
                        'evidenceLevel': 'secondary_quote',
                        'contentRole': 'secondary_quote',
                        'stance': 'bullish',
                        'stockCodes': ['600000'],
                    },
                    {
                        'id': 13,
                        'publishedAt': '2025-01-07T08:30:00+08:00',
                        'publishedTimePrecision': 'minute',
                        'evidenceLevel': 'archive',
                        'contentRole': 'transcript',
                        'stance': 'bearish',
                        'stockCodes': ['300750'],
                    },
                ],
            }), encoding='utf-8')

            result_path, result = run_expert_backtest(
                dataset_dir=dataset_dir,
                workspace=workspace,
                run_id='expert-test-run',
                signals_path=signals_path,
                horizons=[1, 5, 20, 60],
                cost_bps=10,
            )

            self.assertTrue(result_path.exists())
            self.assertEqual(result['inputSha256'], file_sha256(signals_path))
            self.assertEqual(result['coverage']['strictEligibleObservations'], 2)
            self.assertEqual(result['coverage']['excludedByReason']['secondary_evidence'], 1)
            event = result['events'][0]
            self.assertEqual(event['entryDate'], '2025-01-06')
            self.assertEqual(result['events'][1]['entryDate'], '2025-01-07')
            gross = event['horizons']['1']['grossReturn']
            net = event['horizons']['1']['netReturn']
            self.assertAlmostEqual(gross - net, 0.002, places=9)
            self.assertEqual(result['validationStatus'], 'exploratory')
            self.assertTrue(any('retrospective' in warning.lower() for warning in result['warnings']))

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

    def test_sina_symbol_maps_beijing_exchange_codes(self):
        self.assertEqual(_sina_symbol('000001'), 'sz000001')
        self.assertEqual(_sina_symbol('600000'), 'sh600000')
        self.assertEqual(_sina_symbol('920992'), 'bj920992')

    def test_sina_rate_limit_uses_longer_backoff_before_retry(self):
        limited = Mock()
        limited.status_code = 456
        limited.headers = {}
        error = requests.HTTPError('rate limited')
        error.response = limited
        limited.raise_for_status.side_effect = error

        success = Mock()
        success.raise_for_status.return_value = None
        success.json.return_value = [{
            'day': '2025-01-02',
            'open': '10.0',
            'high': '10.2',
            'low': '9.9',
            'close': '10.1',
            'volume': '10000',
        }]
        session = Mock()
        session.get.side_effect = [limited, success]

        with patch('webstock_quant.collector.time.sleep') as sleep:
            frame = fetch_sina_history(
                session,
                {'code': '000001', 'name': '平安银行'},
                '2025-01-01',
                '2025-01-31',
                retries=1,
            )

        self.assertEqual(len(frame), 1)
        sleep.assert_called_once_with(3)

    def test_eastmoney_fallback_parses_public_daily_rows(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"klines": [
            "2025-01-02,10.00,10.10,10.20,9.90,10000",
            "2025-01-03,10.10,10.30,10.40,10.00,12000",
        ]}}
        session = Mock()
        session.get.return_value = response
        frame = fetch_eastmoney_history(
            session, {"code": "002398", "name": "垒知集团"},
            "2025-01-01", "2025-01-31", retries=0,
        )
        self.assertEqual(list(frame.columns), ["date", "code", "name", "open", "high", "low", "close", "volume"])
        self.assertEqual(frame.iloc[0]["close"], 10.1)
        self.assertIn("0.002398", session.get.call_args.kwargs["params"]["secid"])
        self.assertEqual(frame.attrs["source_id"], "eastmoney-public-kline")

    def test_eastmoney_forward_adjustment_is_explicit_in_request_and_source(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"klines": [
            "2025-01-02,10.00,10.10,10.20,9.90,10000",
        ]}}
        session = Mock()
        session.get.return_value = response

        frame = fetch_eastmoney_history(
            session, {"code": "600000", "name": "浦发银行"},
            "2025-01-01", "2025-01-31", retries=0,
            adjustment_mode="forward-adjusted",
        )

        self.assertEqual(session.get.call_args.kwargs["params"]["fqt"], "1")
        self.assertEqual(frame.attrs["source_id"], "eastmoney-public-kline-forward-adjusted")

    def test_eastmoney_uses_declared_http_fallback_after_https_transport_failure(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"klines": [
            "2025-01-02,10.00,10.10,10.20,9.90,10000",
        ]}}
        session = Mock()
        session.get.side_effect = [requests.ConnectionError("TLS endpoint disconnected"), response]

        frame = fetch_eastmoney_history(
            session, {"code": "920000", "name": "Beijing sample"},
            "2025-01-01", "2025-01-31", retries=0,
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(session.get.call_count, 2)
        self.assertTrue(session.get.call_args_list[0].args[0].startswith("https://"))
        self.assertTrue(session.get.call_args_list[1].args[0].startswith("http://"))
        self.assertEqual(frame.attrs["source_id"], "eastmoney-public-kline-http-fallback")

    def test_tencent_second_fallback_parses_public_daily_rows(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"sz002521": {"day": [
            ["2025-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
            ["2025-01-03", "10.10", "10.30", "10.40", "10.00", "12000"],
        ]}}}
        session = Mock()
        session.get.return_value = response
        frame = fetch_tencent_history(
            session, {"code": "002521", "name": "齐峰新材"},
            "2025-01-01", "2025-01-31", retries=0,
        )
        self.assertEqual(frame.iloc[1]["close"], 10.3)
        self.assertIn("sz002521,day", session.get.call_args.kwargs["params"]["param"])

    def test_tencent_forward_adjusted_history_paginates_without_mixing_raw_prices(self):
        first = Mock()
        first.raise_for_status.return_value = None
        first.json.return_value = {"data": {"sz000001": {"qfqday": [
            ["2024-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
            ["2024-01-03", "10.10", "10.30", "10.40", "10.00", "12000"],
        ]}}}
        second = Mock()
        second.raise_for_status.return_value = None
        second.json.return_value = {"data": {"sz000001": {"qfqday": [
            ["2023-12-29", "9.80", "9.90", "10.00", "9.70", "9000"],
        ]}}}
        session = Mock()
        session.get.side_effect = [first, second]

        frame = fetch_tencent_forward_adjusted_history(
            session, {"code": "000001", "name": "平安银行"},
            "2023-12-29", "2024-01-03", retries=0, page_size=2,
        )

        self.assertEqual(frame.iloc[0]["date"], "2023-12-29")
        self.assertEqual(frame.iloc[-1]["date"], "2024-01-03")
        self.assertEqual(frame.attrs["source_id"], "tencent-public-kline-forward-adjusted")
        self.assertEqual(session.get.call_count, 2)
        self.assertTrue(all(",qfq" in call.kwargs["params"]["param"] for call in session.get.call_args_list))

    def test_tencent_forward_adjusted_history_uses_official_alternate_host_after_501(self):
        blocked = Mock()
        blocked.raise_for_status.side_effect = requests.HTTPError(
            "501 challenge",
            response=Mock(status_code=501),
        )
        fallback = Mock()
        fallback.raise_for_status.return_value = None
        fallback.json.return_value = {"data": {"sh600000": {"qfqday": [
            ["2025-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
        ]}}}
        session = Mock()
        session.get.side_effect = [blocked, fallback]

        frame = fetch_tencent_forward_adjusted_history(
            session, {"code": "600000", "name": "浦发银行"},
            "2025-01-01", "2025-01-31", retries=0,
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(session.get.call_count, 2)
        self.assertIn("web.ifzq.gtimg.cn", session.get.call_args_list[0].args[0])
        self.assertIn("https://ifzq.gtimg.cn/", session.get.call_args_list[1].args[0])
        self.assertEqual(
            frame.attrs["source_id"],
            "tencent-public-kline-forward-adjusted-alternate-host",
        )

    def test_tencent_forward_adjusted_history_uses_finance_proxy_after_two_501_responses(self):
        blocked_primary = Mock()
        blocked_primary.raise_for_status.side_effect = requests.HTTPError(
            "501 primary challenge",
            response=Mock(status_code=501),
        )
        blocked_alternate = Mock()
        blocked_alternate.raise_for_status.side_effect = requests.HTTPError(
            "501 alternate challenge",
            response=Mock(status_code=501),
        )
        fallback = Mock()
        fallback.raise_for_status.return_value = None
        fallback.json.return_value = {"data": {"sh600000": {"qfqday": [
            ["2025-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
        ]}}}
        session = Mock()
        session.get.side_effect = [blocked_primary, blocked_alternate, fallback]

        frame = fetch_tencent_forward_adjusted_history(
            session, {"code": "600000", "name": "浦发银行"},
            "2025-01-01", "2025-01-31", retries=0,
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(session.get.call_count, 3)
        self.assertIn("proxy.finance.qq.com", session.get.call_args_list[2].args[0])
        self.assertEqual(
            frame.attrs["source_id"],
            "tencent-public-kline-forward-adjusted-finance-proxy",
        )

    def test_tencent_qfq_request_accepts_day_series_for_non_beijing_symbol(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"sh688141": {"day": [
            ["2025-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
        ]}}}
        session = Mock()
        session.get.return_value = response

        frame = fetch_tencent_forward_adjusted_history(
            session, {"code": "688141", "name": "杰华特"},
            "2025-01-01", "2025-01-31", retries=0,
        )

        self.assertEqual(len(frame), 1)
        self.assertEqual(
            frame.attrs["source_id"],
            "tencent-public-kline-qfq-request-day-series",
        )

    def test_tencent_qfq_request_rejects_day_only_beijing_symbol(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"data": {"bj920000": {"day": [
            ["2025-01-02", "10.00", "10.10", "10.20", "9.90", "10000"],
        ]}}}
        session = Mock()
        session.get.return_value = response

        with self.assertRaisesRegex(ValueError, "no rows"):
            fetch_tencent_forward_adjusted_history(
                session, {"code": "920000", "name": "北交样本"},
                "2025-01-01", "2025-01-31", retries=0,
            )

    def test_collection_resumes_valid_files_after_interruption(self):
        dates = pd.bdate_range('2025-01-02', periods=8)

        def frame_for(stock):
            rows = []
            for index, day in enumerate(dates):
                close = 10 + index * 0.1
                rows.append({
                    'date': day.strftime('%Y-%m-%d'),
                    'code': stock['code'],
                    'name': stock['name'],
                    'open': close - 0.05,
                    'high': close + 0.1,
                    'low': close - 0.1,
                    'close': close,
                    'volume': 1_000_000 + index,
                })
            return pd.DataFrame(rows)

        stocks = [
            {'code': '000001', 'name': '平安银行'},
            {'code': '300750', 'name': '宁德时代'},
            {'code': '600000', 'name': '浦发银行'},
        ]
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            universe_file = root / 'stocks.json'
            universe_file.write_text(__import__('json').dumps(stocks, ensure_ascii=False), encoding='utf-8')
            dataset_dir = root / 'datasets' / 'resume-demo'
            first_calls = []

            def interrupted_fetch(session, stock, start_date, end_date, retries=2):
                first_calls.append(stock['code'])
                if stock['code'] == '300750':
                    raise KeyboardInterrupt('simulated interruption')
                return frame_for(stock)

            with patch('webstock_quant.collector.fetch_sina_history', side_effect=interrupted_fetch):
                with self.assertRaises(KeyboardInterrupt):
                    collect_dataset(
                        universe_file=universe_file,
                        dataset_dir=dataset_dir,
                        dataset_id='resume-demo',
                        start_date='2025-01-01',
                        end_date='2025-02-01',
                        limit=3,
                        sleep_ms=0,
                        workers=1,
                    )

            self.assertTrue((dataset_dir / 'raw' / '000001.parquet').exists())
            resumed_calls = []

            def resumed_fetch(session, stock, start_date, end_date, retries=2):
                resumed_calls.append(stock['code'])
                return frame_for(stock)

            with patch('webstock_quant.collector.fetch_sina_history', side_effect=resumed_fetch):
                _, manifest = collect_dataset(
                    universe_file=universe_file,
                    dataset_dir=dataset_dir,
                    dataset_id='resume-demo',
                    start_date='2025-01-01',
                    end_date='2025-02-01',
                    limit=3,
                    sleep_ms=0,
                    workers=1,
                )

            self.assertNotIn('000001', resumed_calls)
            self.assertEqual(manifest['coverage']['succeeded'], 3)
            self.assertEqual(manifest['coverage']['failed'], 0)
            self.assertEqual(manifest['quality']['coverageRate'], 1.0)
            self.assertEqual(manifest['quality']['invalidCachedFiles'], 0)
            self.assertEqual(len(list((dataset_dir / 'raw').glob('*.parquet'))), 3)

    def test_collection_retry_progress_does_not_count_stale_failures_as_completed(self):
        dates = pd.bdate_range('2025-01-02', periods=8)

        def frame_for(stock):
            return pd.DataFrame([{
                'date': day.strftime('%Y-%m-%d'), 'code': stock['code'], 'name': stock['name'],
                'open': 10.0, 'high': 10.2, 'low': 9.8, 'close': 10.1, 'volume': 10000,
            } for day in dates])

        stocks = [
            {'code': '000001', 'name': '平安银行'},
            {'code': '000002', 'name': '万科A'},
            {'code': '600000', 'name': '浦发银行'},
        ]
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            universe_file = root / 'stocks.json'
            universe_file.write_text(__import__('json').dumps(stocks, ensure_ascii=False), encoding='utf-8')
            dataset_dir = root / 'datasets' / 'retry-progress'
            with patch('webstock_quant.collector.fetch_sina_history', side_effect=RuntimeError('offline')), \
                 patch('webstock_quant.collector.fetch_eastmoney_history', side_effect=RuntimeError('offline')), \
                 patch('webstock_quant.collector.fetch_tencent_history', side_effect=RuntimeError('offline')):
                with self.assertRaisesRegex(RuntimeError, 'usable daily data'):
                    collect_dataset(
                        universe_file=universe_file, dataset_dir=dataset_dir,
                        dataset_id='retry-progress', start_date='2025-01-01', end_date='2025-02-01',
                        limit=3, sleep_ms=0, workers=1,
                    )

            events = []
            with patch('webstock_quant.collector.fetch_sina_history', side_effect=lambda session, stock, start, end, retries=0: frame_for(stock)):
                collect_dataset(
                    universe_file=universe_file, dataset_dir=dataset_dir,
                    dataset_id='retry-progress', start_date='2025-01-01', end_date='2025-02-01',
                    limit=3, sleep_ms=0, workers=1, emit=events.append,
                )

            progress = [event['current'] for event in events if event.get('stage') == 'collect']
            self.assertEqual(progress, [1, 2, 3])

    def test_forward_adjusted_collection_stops_retrying_a_failed_primary_for_every_symbol(self):
        dates = pd.bdate_range('2025-01-02', periods=8)
        stocks = [
            {'code': '000001', 'name': '平安银行'},
            {'code': '000002', 'name': '万科A'},
        ]

        def adjusted_frame(session, stock, start_date, end_date, retries=1):
            frame = pd.DataFrame([{
                'date': day.strftime('%Y-%m-%d'), 'code': stock['code'], 'name': stock['name'],
                'open': 10.0, 'high': 10.2, 'low': 9.8, 'close': 10.1, 'volume': 10000,
            } for day in dates])
            frame.attrs['source_id'] = 'tencent-public-kline-forward-adjusted'
            return frame

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            universe_file = root / 'stocks.json'
            universe_file.write_text(__import__('json').dumps(stocks, ensure_ascii=False), encoding='utf-8')
            with patch('webstock_quant.collector.fetch_eastmoney_history', side_effect=RuntimeError('offline')) as primary, \
                 patch('webstock_quant.collector.fetch_tencent_forward_adjusted_history', side_effect=adjusted_frame):
                _, manifest = collect_dataset(
                    universe_file=universe_file, dataset_dir=root / 'datasets' / 'adjusted-circuit',
                    dataset_id='adjusted-circuit', start_date='2025-01-01', end_date='2025-02-01',
                    adjustment_mode='forward-adjusted', limit=2, sleep_ms=0, workers=1,
                )

        self.assertEqual(primary.call_count, 1)
        self.assertEqual(manifest['coverage']['succeeded'], 2)

    def test_incremental_collection_reuses_a_verified_baseline_and_fetches_only_missing_dates(self):
        stocks = [
            {'code': '000001', 'name': '平安银行'},
            {'code': '600000', 'name': '浦发银行'},
        ]
        calls = []

        def adjusted_frame(session, stock, start_date, end_date, retries=0, adjustment_mode='forward-adjusted'):
            calls.append((stock['code'], str(start_date), str(end_date)))
            dates = pd.bdate_range(start_date, end_date)
            frame = pd.DataFrame([{
                'date': day.strftime('%Y-%m-%d'), 'code': stock['code'], 'name': stock['name'],
                'open': 10.0, 'high': 10.2, 'low': 9.8, 'close': 10.1, 'volume': 10000,
            } for day in dates])
            frame.attrs['source_id'] = 'eastmoney-public-kline-forward-adjusted'
            return frame

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            universe_file = root / 'stocks.json'
            universe_file.write_text(__import__('json').dumps(stocks, ensure_ascii=False), encoding='utf-8')
            base_dir = root / 'datasets' / 'a-share-qfq-base'
            next_dir = root / 'datasets' / 'a-share-qfq-next'
            with patch('webstock_quant.collector.fetch_eastmoney_history', side_effect=adjusted_frame):
                _, base_manifest = collect_dataset(
                    universe_file=universe_file, dataset_dir=base_dir,
                    dataset_id='a-share-qfq-base', start_date='2025-01-01', end_date='2025-01-10',
                    adjustment_mode='forward-adjusted', limit=2, sleep_ms=0, workers=1,
                )
                base_hash = (base_dir / 'raw' / '000001.parquet').read_bytes()
                calls.clear()
                _, manifest = collect_dataset(
                    universe_file=universe_file, dataset_dir=next_dir,
                    dataset_id='a-share-qfq-next', start_date='2025-01-01', end_date='2025-01-15',
                    adjustment_mode='forward-adjusted', limit=2, sleep_ms=0, workers=1,
                    base_dataset_dir=base_dir,
                )

            self.assertEqual({call[1] for call in calls}, {'2025-01-11'})
            self.assertEqual({call[2] for call in calls}, {'2025-01-15'})
            self.assertEqual((base_dir / 'raw' / '000001.parquet').read_bytes(), base_hash)
            self.assertEqual(manifest['collection']['baseDatasetId'], base_manifest['datasetId'])
            self.assertEqual(manifest['dateRange']['end'], '2025-01-15')
            merged = pd.read_parquet(next_dir / 'raw' / '000001.parquet')
            self.assertEqual(merged['date'].iloc[0], '2025-01-01')
            self.assertEqual(merged['date'].iloc[-1], '2025-01-15')
            self.assertEqual(merged['date'].nunique(), len(merged))

    def test_collect_cli_exposes_bounded_worker_count(self):
        args = build_parser().parse_args([
            'collect',
            '--workspace', 'workspace',
            '--universe-file', 'stocks.json',
            '--dataset-id', 'dataset-demo',
            '--workers', '4',
        ])
        self.assertEqual(args.workers, 4)
        self.assertEqual(args.sleep_ms, 600)

    def test_collect_cli_accepts_an_explicit_forward_adjustment_mode(self):
        args = build_parser().parse_args([
            'collect',
            '--workspace', 'workspace',
            '--universe-file', 'stocks.json',
            '--dataset-id', 'dataset-demo',
            '--adjustment-mode', 'forward-adjusted',
        ])
        self.assertEqual(args.adjustment_mode, 'forward-adjusted')

    def test_collect_cli_accepts_a_baseline_dataset_id_for_incremental_updates(self):
        args = build_parser().parse_args([
            'collect',
            '--workspace', 'workspace',
            '--universe-file', 'stocks.json',
            '--dataset-id', 'dataset-demo-next',
            '--base-dataset-id', 'dataset-demo-base',
        ])
        self.assertEqual(args.base_dataset_id, 'dataset-demo-base')

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
