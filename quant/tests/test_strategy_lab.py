import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from webstock_quant.strategy_lab import (
    collect_current_signal_candidates,
    ExecutionAssumptions,
    filter_main_board_panel,
    generate_parameter_grid,
    generate_strategy_parameter_grid,
    prepare_strategy_signals,
    run_strategy_lab,
    select_bounded_liquid_universe,
    simulate_ma_parameter,
    simulate_prepared_parameter,
    summarize_parameter_stability,
)
from webstock_quant.manifest import file_sha256, manifest_sha256, write_json_atomic
from webstock_quant.cli import build_parser
from webstock_quant.signal_scan import run_signal_scan, scan_strategy_candidates


def price_frame(code="600000", name="sample", closes=None, opens=None, volumes=None):
    closes = list(closes or [10.0] * 12)
    opens = list(opens or [closes[0]] + closes[:-1])
    volumes = list(volumes or [1_000_000] * len(closes))
    dates = pd.bdate_range("2026-01-05", periods=len(closes))
    return pd.DataFrame({
        "date": dates,
        "code": code,
        "name": name,
        "open": opens,
        "high": np.maximum(opens, closes) * 1.01,
        "low": np.minimum(opens, closes) * 0.99,
        "close": closes,
        "volume": volumes,
    })


class StrategyLabTests(unittest.TestCase):
    def test_cli_accepts_explicit_strategy_rule_card(self):
        args = build_parser().parse_args([
            "strategy-lab", "--workspace", "work", "--dataset-id", "dataset-demo",
            "--short-windows", "5,10", "--long-windows", "20,40",
            "--max-folds", "3", "--commission-bps", "2.5", "--stamp-duty-bps", "5",
        ])

        self.assertEqual(args.short_windows, "5,10")
        self.assertEqual(args.long_windows, "20,40")
        self.assertEqual(args.max_folds, 3)

    def test_cli_accepts_each_controlled_strategy_family(self):
        args = build_parser().parse_args([
            "strategy-lab", "--workspace", "work", "--dataset-id", "dataset-demo",
            "--strategy-family", "macd-crossover",
            "--fast-windows", "8,12", "--slow-windows", "26", "--signal-windows", "9",
        ])

        self.assertEqual(args.strategy_family, "macd-crossover")
        self.assertEqual(args.fast_windows, "8,12")
        self.assertEqual(args.slow_windows, "26")
        self.assertEqual(args.signal_windows, "9")

        stagnation = build_parser().parse_args([
            "strategy-lab", "--workspace", "work", "--dataset-id", "dataset-demo",
            "--strategy-family", "low-position-volume-stagnation",
            "--position-lookback-windows", "120", "--max-range-positions", "0.35",
            "--volume-windows", "20", "--volume-multipliers", "1.8",
            "--max-abs-returns", "0.02", "--max-intraday-ranges", "0.06",
            "--min-close-locations", "0.5",
        ])

        self.assertEqual(stagnation.strategy_family, "low-position-volume-stagnation")
        self.assertEqual(stagnation.position_lookback_windows, "120")
        self.assertEqual(stagnation.max_range_positions, "0.35")
        self.assertEqual(stagnation.volume_windows, "20")
        self.assertEqual(stagnation.max_abs_returns, "0.02")
        self.assertEqual(stagnation.max_intraday_ranges, "0.06")
        self.assertEqual(stagnation.min_close_locations, "0.5")

        scan = build_parser().parse_args([
            "signal-scan", "--workspace", "work", "--dataset-id", "dataset-demo",
            "--strategy-family", "volume-breakout", "--validation-mode", "exploratory",
            "--breakout-windows", "20", "--volume-multipliers", "1.5",
            "--breakout-margins", "0.005", "--breakout-min-close-locations", "0.7",
        ])
        self.assertEqual(scan.command, "signal-scan")
        self.assertEqual(scan.breakout_margins, "0.005")

    def test_main_board_filter_excludes_other_boards_st_and_zero_volume_rows(self):
        panel = pd.concat([
            price_frame("600000", "浦发银行"),
            price_frame("002463", "沪电股份"),
            price_frame("300750", "宁德时代"),
            price_frame("688981", "中芯国际"),
            price_frame("830799", "艾融软件"),
            price_frame("000001", "*ST样本"),
        ], ignore_index=True)

        filtered, coverage = filter_main_board_panel(panel)

        self.assertEqual(set(filtered["code"]), {"600000", "002463"})
        self.assertEqual(coverage["excludedByBoard"], 3)
        self.assertEqual(coverage["excludedSt"], 1)

    def test_parameter_grid_only_contains_valid_unique_ma_pairs(self):
        grid = generate_parameter_grid([5, 10, 10, 20], [10, 20, 40])

        self.assertEqual(grid, [(5, 10), (5, 20), (5, 40), (10, 20), (10, 40), (20, 40)])
        with self.assertRaisesRegex(ValueError, "64"):
            generate_parameter_grid(range(1, 12), range(20, 31))

    def test_multi_strategy_parameter_grids_are_bounded_and_auditable(self):
        macd = generate_strategy_parameter_grid(
            "macd-crossover", fast_windows=[8, 12], slow_windows=[26], signal_windows=[9]
        )
        rsi = generate_strategy_parameter_grid(
            "rsi-rebound", rsi_periods=[6, 14], entry_thresholds=[30], exit_thresholds=[70]
        )
        breakout = generate_strategy_parameter_grid(
            "volume-breakout", breakout_windows=[20, 40], volume_multipliers=[1.5, 2]
        )
        stagnation = generate_strategy_parameter_grid(
            "low-position-volume-stagnation",
            position_lookback_windows=[120],
            max_range_positions=[0.35],
            volume_windows=[20],
            volume_multipliers=[1.8],
            max_abs_returns=[0.02],
            max_intraday_ranges=[0.06],
            min_close_locations=[0.5],
        )

        self.assertEqual([item["parameterId"] for item in macd], ["macd-8-26-9", "macd-12-26-9"])
        self.assertEqual([item["parameterId"] for item in rsi], ["rsi-6-30-70", "rsi-14-30-70"])
        self.assertEqual([item["parameterId"] for item in breakout], [
            "breakout-20-1.5-0.005-0.7", "breakout-20-2-0.005-0.7",
            "breakout-40-1.5-0.005-0.7", "breakout-40-2-0.005-0.7",
        ])
        self.assertEqual(breakout[0]["settings"]["breakoutMargin"], 0.005)
        self.assertEqual(breakout[0]["settings"]["minCloseLocation"], 0.7)
        self.assertEqual(len(stagnation), 1)
        self.assertEqual(stagnation[0]["strategyFamily"], "low-position-volume-stagnation")
        self.assertEqual(stagnation[0]["settings"], {
            "positionLookbackWindow": 120,
            "maxRangePosition": 0.35,
            "volumeWindow": 20,
            "volumeMultiplier": 1.8,
            "maxAbsReturn": 0.02,
            "maxIntradayRange": 0.06,
            "minCloseLocation": 0.5,
        })
        with self.assertRaisesRegex(ValueError, "64"):
            generate_strategy_parameter_grid(
                "macd-crossover",
                fast_windows=range(1, 9), slow_windows=range(20, 29), signal_windows=[9],
            )

    def test_new_strategy_signals_use_only_current_and_past_rows(self):
        closes = [12, 11, 10, 9, 8, 8.2, 8.6, 9.2, 10, 11, 12, 13]
        volumes = [100] * 8 + [300, 300, 200, 200]
        panel = price_frame(closes=closes, volumes=volumes)
        parameters = [
            generate_strategy_parameter_grid(
                "macd-crossover", fast_windows=[3], slow_windows=[6], signal_windows=[2]
            )[0],
            generate_strategy_parameter_grid(
                "rsi-rebound", rsi_periods=[3], entry_thresholds=[30], exit_thresholds=[70]
            )[0],
            generate_strategy_parameter_grid(
                "volume-breakout", breakout_windows=[3], volume_multipliers=[1.5]
            )[0],
            generate_strategy_parameter_grid(
                "low-position-volume-stagnation",
                position_lookback_windows=[5],
                max_range_positions=[0.35],
                volume_windows=[3],
                volume_multipliers=[1.5],
                max_abs_returns=[0.03],
                max_intraday_ranges=[0.06],
                min_close_locations=[0.5],
            )[0],
        ]

        for parameter in parameters:
            prepared = prepare_strategy_signals(panel, parameter)
            changed = panel.copy()
            changed.loc[changed.index[-1], ["close", "high", "volume"]] = [999, 1000, 999999]
            changed_prepared = prepare_strategy_signals(changed, parameter)
            self.assertEqual(
                prepared["entrySignal"].iloc[:-1].tolist(),
                changed_prepared["entrySignal"].iloc[:-1].tolist(),
            )
            self.assertEqual(
                prepared["exitSignal"].iloc[:-1].tolist(),
                changed_prepared["exitSignal"].iloc[:-1].tolist(),
            )
            if parameter["strategyFamily"] != "low-position-volume-stagnation":
                self.assertTrue(prepared["entrySignal"].any(), parameter["parameterId"])

    def test_low_position_volume_stagnation_exposes_auditable_features(self):
        panel = price_frame(
            closes=[12, 11, 10, 9, 8.2, 8.0, 8.05],
            volumes=[100, 100, 100, 100, 100, 100, 220],
        )
        parameter = generate_strategy_parameter_grid(
            "low-position-volume-stagnation",
            position_lookback_windows=[5],
            max_range_positions=[0.35],
            volume_windows=[3],
            volume_multipliers=[1.8],
            max_abs_returns=[0.02],
            max_intraday_ranges=[0.06],
            min_close_locations=[0.5],
        )[0]

        prepared = prepare_strategy_signals(panel, parameter)
        signal = prepared.iloc[-1]

        self.assertTrue(bool(signal["entrySignal"]))
        self.assertLessEqual(signal["rangePosition"], 0.35)
        self.assertGreaterEqual(signal["volumeRatio"], 1.8)
        self.assertLessEqual(abs(signal["dailyReturn"]), 0.02)
        self.assertLessEqual(signal["intradayRange"], 0.06)
        self.assertGreaterEqual(signal["closeLocation"], 0.5)

    def test_volume_breakout_uses_prior_high_and_quality_thresholds(self):
        panel = price_frame(
            closes=[10, 10, 10, 10, 10.2],
            volumes=[100, 100, 100, 100, 200],
        )
        parameter = generate_strategy_parameter_grid(
            "volume-breakout", breakout_windows=[3], volume_multipliers=[1.5],
            breakout_margins=[0.005], breakout_min_close_locations=[0.7],
        )[0]

        prepared = prepare_strategy_signals(panel, parameter)
        signal = prepared.iloc[-1]

        self.assertAlmostEqual(signal["priorHigh"], panel["high"].iloc[1:4].max())
        self.assertGreaterEqual(signal["breakoutPercent"], 0.005)
        self.assertGreaterEqual(signal["volumeRatio"], 1.5)
        self.assertGreaterEqual(signal["closeLocation"], 0.7)
        self.assertTrue(bool(signal["entrySignal"]))

    def test_current_candidate_contains_raw_signal_evidence(self):
        panel = price_frame(
            closes=[12, 11, 10, 9, 8.2, 8.0, 8.05],
            volumes=[100, 100, 100, 100, 100, 100, 220],
        )
        parameter = generate_strategy_parameter_grid(
            "low-position-volume-stagnation",
            position_lookback_windows=[5], max_range_positions=[0.35],
            volume_windows=[3], volume_multipliers=[1.8], max_abs_returns=[0.02],
            max_intraday_ranges=[0.06], min_close_locations=[0.5],
        )[0]
        parameter.update({
            "admission": "watch",
            "metrics": {"positiveFoldRate": 2 / 3, "meanOosReturn": 0.01, "medianOosReturn": 0.008},
        })

        current = collect_current_signal_candidates(panel, [parameter])
        signal_evidence = current["candidates"][0]["evidence"][0]["signalEvidence"]

        self.assertEqual(signal_evidence["signalDate"], "2026-01-13")
        self.assertLessEqual(signal_evidence["rangePosition"], 0.35)
        self.assertGreaterEqual(signal_evidence["volumeRatio"], 1.8)
        self.assertLessEqual(abs(signal_evidence["dailyReturn"]), 0.02)
        self.assertIn("confirmationRule", current["candidates"][0])
        self.assertIn("invalidationRule", current["candidates"][0])

    def test_direct_signal_scan_ranks_matches_without_claiming_confirmation(self):
        matching = price_frame(
            "600000", "浦发银行",
            closes=[12, 11, 10, 9, 8.2, 8.0, 8.05],
            volumes=[100, 100, 100, 100, 100, 100, 220],
        )
        ordinary = price_frame(
            "600001", "普通样本",
            closes=[12, 11, 10, 9, 8.2, 8.0, 8.05],
            volumes=[100] * 7,
        )
        parameter = generate_strategy_parameter_grid(
            "low-position-volume-stagnation",
            position_lookback_windows=[5], max_range_positions=[0.35],
            volume_windows=[3], volume_multipliers=[1.8], max_abs_returns=[0.02],
            max_intraday_ranges=[0.06], min_close_locations=[0.5],
        )[0]

        scan = scan_strategy_candidates(pd.concat([matching, ordinary]), parameter)

        self.assertEqual(scan["candidateCount"], 1)
        self.assertEqual(scan["candidates"][0]["code"], "600000")
        self.assertEqual(scan["candidates"][0]["candidateStatus"], "rule-match-unconfirmed")
        self.assertGreater(scan["candidates"][0]["matchStrength"], 0)
        self.assertTrue(scan["candidates"][0]["whyMatched"])

    def test_formal_signal_scan_rejects_exploratory_dataset_before_loading_panel(self):
        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            dataset_dir = workspace / "datasets" / "exploratory-scan"
            dataset_dir.mkdir(parents=True)
            manifest = {
                "datasetId": "exploratory-scan",
                "eligibility": "exploratory_only",
                "warnings": ["Synthetic exploratory data."],
            }
            manifest["manifestSha256"] = manifest_sha256(manifest)
            write_json_atomic(dataset_dir / "manifest.json", manifest)

            with self.assertRaisesRegex(ValueError, "正式筛选资格"):
                run_signal_scan(
                    dataset_dir=dataset_dir,
                    workspace=workspace,
                    run_id="formal-scan-test",
                    strategy_family="volume-breakout",
                    validation_mode="formal",
                    breakout_windows=[20],
                    volume_multipliers=[1.5],
                )

    def test_generic_executor_uses_prepared_signals_without_replacing_them_with_ma(self):
        prepared = price_frame(closes=[10] * 8, opens=[10] * 8)
        prepared["entrySignal"] = False
        prepared["exitSignal"] = False
        prepared["crossUp"] = False
        prepared["crossDown"] = False
        prepared.loc[2, ["entrySignal", "crossUp"]] = True
        prepared.loc[5, ["exitSignal", "crossDown"]] = True

        result = simulate_prepared_parameter(
            prepared,
            prepared["date"].min(),
            prepared["date"].max(),
            ExecutionAssumptions(commission_bps=0, minimum_commission=0, stamp_duty_bps=0, slippage_bps=0),
        )

        self.assertEqual(result["buyCount"], 1)
        self.assertEqual(result["sellCount"], 1)
        self.assertEqual(result["tradeCount"], 1)

    def test_daily_candidates_scan_all_eligible_codes_and_exclude_rejected_parameters(self):
        panel = pd.concat([
            price_frame("600000", "浦发银行", closes=[5, 5, 5, 5, 6]),
            price_frame("002463", "沪电股份", closes=[8, 8, 8, 8, 9]),
        ], ignore_index=True)
        stable = {
            "strategyFamily": "moving-average-crossover",
            "parameterId": "ma-2-3",
            "label": "MA2 / MA3",
            "settings": {"shortWindow": 2, "longWindow": 3},
            "admission": "stable",
            "metrics": {"positiveFoldRate": 1.0, "meanOosReturn": 0.02},
        }
        rejected = dict(stable, parameterId="ma-rejected", admission="rejected")

        current = collect_current_signal_candidates(panel, [stable, rejected], max_candidates=1)

        self.assertEqual(current["universeScanned"], 2)
        self.assertEqual(current["candidateCount"], 2)
        self.assertEqual(current["storedCount"], 1)
        self.assertTrue(current["truncated"])
        self.assertEqual(current["candidates"][0]["parameterIds"], ["ma-2-3"])
        self.assertEqual(current["candidates"][0]["admissions"], ["stable"])
        self.assertEqual(current["candidates"][0]["signalDate"], "2026-01-09")
        self.assertEqual(current["earliestObservation"], "next-executable-open")

    def test_daily_candidates_are_empty_when_every_parameter_is_rejected(self):
        panel = price_frame("600000", "浦发银行", closes=[5, 5, 5, 5, 6])
        rejected = {
            "strategyFamily": "moving-average-crossover",
            "parameterId": "ma-2-3",
            "label": "MA2 / MA3",
            "settings": {"shortWindow": 2, "longWindow": 3},
            "admission": "rejected",
            "metrics": {"positiveFoldRate": 0.0, "meanOosReturn": -0.02},
        }

        current = collect_current_signal_candidates(panel, [rejected])

        self.assertEqual(current["candidateCount"], 0)
        self.assertEqual(current["candidates"], [])

    def test_liquidity_cap_uses_training_rows_only_and_is_deterministic(self):
        frames = []
        for code, volume in (("600000", 100), ("600001", 300), ("600002", 200)):
            frame = price_frame(code, code, closes=[10] * 8, volumes=[volume] * 8)
            frames.append(frame)
        panel = pd.concat(frames, ignore_index=True)
        cutoff = panel["date"].sort_values().iloc[4]
        # 截止日后的极端成交量不能改变训练期选池。
        panel.loc[(panel["code"] == "600000") & (panel["date"] > cutoff), "volume"] = 999999

        selected = select_bounded_liquid_universe(panel, set(panel["code"]), cutoff, 2)

        self.assertEqual(selected, ["600001", "600002"])

    def test_limit_up_blocks_buy_and_limit_down_defers_sell(self):
        assumptions = ExecutionAssumptions(
            commission_bps=0,
            minimum_commission=0,
            stamp_duty_bps=0,
            slippage_bps=0,
            capital_per_symbol=100_000,
        )
        # 第 5 个收盘形成金叉；下一交易日开盘为涨停，买入必须失败。
        blocked_buy = price_frame(
            closes=[10, 9, 8, 9, 10, 11, 12, 13],
            opens=[10, 9, 8, 8.80, 10, 11, 12, 13],
        )
        blocked_buy.loc[5, "open"] = 11.00  # 相对前收 10.00 的 10% 涨停价
        buy_result = simulate_ma_parameter(
            blocked_buy,
            short_window=2,
            long_window=3,
            start_date=blocked_buy.iloc[1]["date"],
            end_date=blocked_buy.iloc[-1]["date"],
            assumptions=assumptions,
        )
        self.assertGreaterEqual(buy_result["blockedBuys"], 1)
        self.assertEqual(buy_result["buyCount"], 0)

        # 金叉后买入；死叉后的次日是跌停，卖出应延后到下一交易日。
        deferred_sell = price_frame(
            closes=[10, 9, 8, 9, 10, 11, 10, 8, 7.2, 7.5, 7.6],
            opens=[10, 10, 9, 8, 9, 10, 11, 10, 7.2, 7.5, 7.6],
        )
        sell_result = simulate_ma_parameter(
            deferred_sell,
            short_window=2,
            long_window=3,
            start_date=deferred_sell.iloc[1]["date"],
            end_date=deferred_sell.iloc[-1]["date"],
            assumptions=assumptions,
        )
        self.assertGreaterEqual(sell_result["blockedSells"], 1)
        self.assertEqual(sell_result["sellCount"], 1)
        self.assertGreater(sell_result["trades"][0]["sellDate"], sell_result["trades"][0]["buyDate"])

    def test_costs_reduce_return_and_t_plus_one_prevents_same_day_sale(self):
        frame = price_frame(closes=[10, 9, 8, 9, 10, 11, 9, 8, 9, 10, 11, 12])
        free = simulate_ma_parameter(
            frame, 2, 3, frame.iloc[1]["date"], frame.iloc[-1]["date"],
            ExecutionAssumptions(commission_bps=0, minimum_commission=0, stamp_duty_bps=0, slippage_bps=0),
        )
        charged = simulate_ma_parameter(
            frame, 2, 3, frame.iloc[1]["date"], frame.iloc[-1]["date"], ExecutionAssumptions(),
        )

        self.assertLess(charged["netReturn"], free["netReturn"])
        self.assertTrue(all(trade["sellDate"] > trade["buyDate"] for trade in charged["trades"]))

    def test_stability_requires_at_least_three_positive_out_of_sample_folds(self):
        insufficient = summarize_parameter_stability([
            {"netReturn": 0.03, "maxDrawdown": -0.01, "tradeCount": 2, "winRate": 0.5},
            {"netReturn": 0.02, "maxDrawdown": -0.02, "tradeCount": 2, "winRate": 0.5},
        ])
        stable = summarize_parameter_stability([
            {"netReturn": 0.03, "maxDrawdown": -0.01, "tradeCount": 2, "winRate": 0.5},
            {"netReturn": 0.02, "maxDrawdown": -0.02, "tradeCount": 2, "winRate": 0.5},
            {"netReturn": 0.01, "maxDrawdown": -0.03, "tradeCount": 2, "winRate": 0.5},
        ])

        self.assertNotEqual(insufficient["admission"], "stable")
        self.assertEqual(stable["admission"], "stable")
        self.assertEqual(stable["positiveFoldRate"], 1.0)

    def test_stability_rejects_a_positive_median_when_mean_return_is_negative(self):
        misleading = summarize_parameter_stability([
            {"netReturn": 0.03, "maxDrawdown": -0.03, "tradeCount": 2, "winRate": 0.5},
            {"netReturn": 0.02, "maxDrawdown": -0.02, "tradeCount": 2, "winRate": 0.5},
            {"netReturn": -0.12, "maxDrawdown": -0.15, "tradeCount": 2, "winRate": 0.0},
        ])

        self.assertLess(misleading["meanOosReturn"], 0)
        self.assertNotEqual(misleading["admission"], "stable")
        self.assertIn("样本外平均收益不为正", misleading["reasons"])

    def test_strategy_lab_writes_traceable_three_fold_research_result(self):
        with TemporaryDirectory() as temporary_directory:
            workspace = Path(temporary_directory)
            dataset_dir = workspace / "datasets" / "strategy-test-data"
            raw_dir = dataset_dir / "raw"
            raw_dir.mkdir(parents=True)
            frames = []
            days = 180
            for index, (code, name) in enumerate((
                ("600000", "浦发银行"),
                ("002463", "沪电股份"),
                ("600001", "测试银行"),
                ("300750", "宁德时代"),
                ("000001", "*ST测试"),
            )):
                base = 10 + index * 3
                closes = [base + day * 0.01 + np.sin(day / (4 + index)) * 0.6 for day in range(days)]
                frames.append(price_frame(code, name, closes=closes))
            panel = pd.concat(frames, ignore_index=True)
            panel_path = raw_dir / "panel.parquet"
            panel.to_parquet(panel_path, index=False)
            universe_path = dataset_dir / "universe.json"
            write_json_atomic(universe_path, [{"code": code} for code in panel["code"].unique()])
            manifest = {
                "datasetId": "strategy-test-data",
                "eligibility": "exploratory_only",
                "files": [{
                    "path": "raw/panel.parquet",
                    "sha256": file_sha256(panel_path),
                    "rows": len(panel),
                }, {
                    "path": "universe.json",
                    "sha256": file_sha256(universe_path),
                    "rows": 5,
                }],
                "warnings": ["Synthetic test data."],
            }
            manifest["manifestSha256"] = manifest_sha256(manifest)
            write_json_atomic(dataset_dir / "manifest.json", manifest)

            result_path, result = run_strategy_lab(
                dataset_dir=dataset_dir,
                workspace=workspace,
                run_id="strategy-test-run",
                short_windows=[3, 5],
                long_windows=[10, 20],
                train_days=40,
                validation_days=20,
                test_days=20,
                step_days=20,
                max_folds=3,
                min_history_days=20,
                max_instruments=2,
                assumptions=ExecutionAssumptions(
                    commission_bps=0,
                    minimum_commission=0,
                    stamp_duty_bps=0,
                    slippage_bps=0,
                ),
            )

            self.assertTrue(result_path.exists())
            self.assertEqual(result["schema"], "webstock.quant.strategy-lab.v1")
            self.assertFalse(result["automaticTrading"])
            self.assertEqual(result["validationStatus"], "exploratory")
            self.assertEqual(len(result["folds"]), 3)
            self.assertEqual(len(result["parameters"]), 4)
            self.assertEqual(result["universe"]["included"], 2)
            self.assertEqual(result["universe"]["excludedByBoard"], 1)
            self.assertEqual(result["universe"]["excludedSt"], 1)
            self.assertEqual(result["universe"]["excludedByLiquidityCap"], 1)
            self.assertEqual(result["universe"]["candidateScanIncluded"], 3)
            self.assertEqual(result["currentSignals"]["universeScanned"], 3)
            self.assertTrue((result_path.parent / result["artifacts"][0]["path"]).exists())
            self.assertIn(result["bestParameter"]["admission"], {"stable", "watch", "rejected"})

            family_parameters = {
                "macd-crossover": {"fast_windows": [3], "slow_windows": [6], "signal_windows": [2]},
                "rsi-rebound": {"rsi_periods": [3], "entry_thresholds": [30], "exit_thresholds": [70]},
                "volume-breakout": {"breakout_windows": [5], "volume_multipliers": [1.5]},
            }
            for family, parameters in family_parameters.items():
                _, family_result = run_strategy_lab(
                    dataset_dir=dataset_dir,
                    workspace=workspace,
                    run_id="strategy-test-" + family,
                    strategy_family=family,
                    train_days=40,
                    validation_days=20,
                    test_days=20,
                    step_days=20,
                    max_folds=3,
                    min_history_days=20,
                    max_instruments=2,
                    assumptions=ExecutionAssumptions(
                        commission_bps=0,
                        minimum_commission=0,
                        stamp_duty_bps=0,
                        slippage_bps=0,
                    ),
                    **parameters,
                )
                self.assertEqual(family_result["ruleCard"]["strategyFamily"], family)
                self.assertEqual(len(family_result["parameters"]), 1)
                self.assertTrue(family_result["parameters"][0]["label"])
                self.assertTrue(family_result["parameters"][0]["settings"])


if __name__ == "__main__":
    unittest.main()
