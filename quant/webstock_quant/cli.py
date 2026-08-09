import argparse
import importlib.metadata
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .collector import collect_dataset
from .factor_lab import run_factor_lab
from .master_model import run_master_baseline
from .model import run_lightgbm_baseline


def _emit(prefix, payload):
    print(prefix + json.dumps(payload, ensure_ascii=False, separators=(",", ":")), flush=True)


def emit_event(payload):
    _emit("WEBSTOCK_EVENT=", payload)


def emit_result(payload):
    _emit("WEBSTOCK_RESULT=", payload)


def _safe_id(value, label):
    text = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,100}", text):
        raise ValueError(label + " contains unsupported characters")
    return text


def resolve_manifest_output_path(result_path, manifest_path):
    target = Path(manifest_path)
    if target.is_absolute():
        return target.resolve()
    workspace = Path(result_path).resolve().parents[2]
    return (workspace / target).resolve()


def _versions(verify=False):
    packages = {
        "qlib": "pyqlib",
        "lightgbm": "lightgbm",
        "pandas": "pandas",
        "pyarrow": "pyarrow",
        "baostock": "baostock",
        "torch": "torch",
    }
    versions = {name: importlib.metadata.version(package) for name, package in packages.items()}
    if verify:
        import lightgbm  # noqa: F401
        import pandas  # noqa: F401
        import pyarrow  # noqa: F401
        import qlib  # noqa: F401
        import torch  # noqa: F401
    return versions


def command_health(args):
    result = {
        "status": "available" if args.verify else "configured",
        "verified": bool(args.verify),
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "packages": _versions(verify=args.verify),
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    }
    emit_result(result)
    return 0


def _codes(value):
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _collect(args, dataset_id=None):
    workspace = Path(args.workspace).resolve()
    dataset_id = _safe_id(dataset_id or args.dataset_id, "dataset id")
    dataset_dir = workspace / "datasets" / dataset_id
    manifest_path, manifest = collect_dataset(
        universe_file=Path(args.universe_file).resolve(),
        dataset_dir=dataset_dir,
        dataset_id=dataset_id,
        start_date=args.start_date,
        end_date=args.end_date,
        limit=args.limit,
        codes=_codes(args.codes),
        sleep_ms=args.sleep_ms,
        workers=args.workers,
        emit=emit_event,
    )
    return dataset_dir, manifest_path, manifest


def command_collect(args):
    dataset_dir, manifest_path, manifest = _collect(args)
    emit_result({
        "kind": "dataset",
        "datasetId": manifest["datasetId"],
        "manifestPath": str(manifest_path),
        "datasetDir": str(dataset_dir),
        "manifest": manifest,
    })
    return 0


def _run(args, dataset_dir=None, run_id=None):
    workspace = Path(args.workspace).resolve()
    run_id = _safe_id(run_id or args.run_id, "run id")
    if dataset_dir is None:
        dataset_id = _safe_id(args.dataset_id, "dataset id")
        dataset_dir = workspace / "datasets" / dataset_id
    os.chdir(workspace)
    common = {
        "dataset_dir": dataset_dir,
        "workspace": workspace,
        "run_id": run_id,
        "train_days": args.train_days,
        "validation_days": args.validation_days,
        "test_days": args.test_days,
        "step_days": args.step_days,
        "label_horizon": args.label_horizon,
        "max_folds": args.max_folds,
        "top_k": args.top_k,
        "cost_bps": args.cost_bps,
        "seed": args.seed,
        "emit": emit_event,
    }
    if args.model == "master":
        result_path, result = run_master_baseline(
            **common,
            lookback=args.master_lookback,
            epochs=args.master_epochs,
            patience=args.master_patience,
            learning_rate=args.master_learning_rate,
            d_model=args.master_d_model,
            temporal_heads=args.master_temporal_heads,
            cross_stock_heads=args.master_cross_stock_heads,
            dropout=args.master_dropout,
            gate_temperature=args.master_gate_temperature,
            batch_days=args.master_batch_days,
        )
    else:
        result_path, result = run_lightgbm_baseline(
            **common,
            num_boost_round=args.num_boost_round,
            early_stopping_rounds=args.early_stopping_rounds,
        )
    return result_path, result


def command_run(args):
    result_path, result = _run(args)
    manifest_path = resolve_manifest_output_path(result_path, result["dataManifest"]["path"])
    emit_result({
        "kind": "quant-run",
        "manifestPath": str(manifest_path.resolve()),
        "resultPath": str(result_path),
        "result": result,
    })


def command_factor_lab(args):
    workspace = Path(args.workspace).resolve()
    dataset_id = _safe_id(args.dataset_id, "dataset id")
    run_id = _safe_id(args.run_id or "factor-lab-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"), "run id")
    os.chdir(workspace)
    result_path, result = run_factor_lab(
        dataset_dir=workspace / "datasets" / dataset_id,
        workspace=workspace,
        run_id=run_id,
        train_days=args.train_days,
        validation_days=args.validation_days,
        test_days=args.test_days,
        step_days=args.step_days,
        label_horizon=args.label_horizon,
        max_folds=args.max_folds,
        top_k=args.top_k,
        cost_bps=args.cost_bps,
        seed=args.seed,
        emit=emit_event,
    )
    manifest_path = resolve_manifest_output_path(result_path, result["dataManifest"]["path"])
    emit_result({
        "kind": "factor-lab",
        "manifestPath": str(manifest_path),
        "resultPath": str(result_path.resolve()),
        "datasetId": result["dataManifest"]["datasetId"],
        "runId": result["runId"],
    })
    return 0


def command_pilot(args):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dataset_id = _safe_id(args.dataset_id or "sina-pilot-" + timestamp, "dataset id")
    prefix = "master-" if args.model == "master" else "qlib-lightgbm-"
    run_id = _safe_id(args.run_id or prefix + timestamp, "run id")
    dataset_dir, manifest_path, manifest = _collect(args, dataset_id=dataset_id)
    emit_event({
        "stage": "dataset-ready",
        "message": f"数据清单已生成：{manifest['coverage']['succeeded']} 只证券",
        "manifestPath": str(manifest_path),
    })
    result_path, result = _run(args, dataset_dir=dataset_dir, run_id=run_id)
    emit_result({
        "kind": "pilot",
        "manifestPath": str(manifest_path),
        "resultPath": str(result_path),
        "manifest": manifest,
        "result": result,
    })
    return 0


def add_common_collection_arguments(parser):
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--universe-file", required=True)
    parser.add_argument("--dataset-id", default="")
    parser.add_argument("--start-date", default="2019-01-01")
    parser.add_argument("--end-date", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--codes", default="")
    parser.add_argument("--sleep-ms", type=int, default=120)
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=3)


def add_common_model_arguments(parser):
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--dataset-id", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--model", choices=["lightgbm", "master"], default="lightgbm")
    parser.add_argument("--train-days", type=int, default=504)
    parser.add_argument("--validation-days", type=int, default=126)
    parser.add_argument("--test-days", type=int, default=63)
    parser.add_argument("--step-days", type=int, default=63)
    parser.add_argument("--label-horizon", type=int, default=5)
    parser.add_argument("--max-folds", type=int, default=4)
    parser.add_argument("--top-k", type=int, default=20)
    parser.add_argument("--cost-bps", type=float, default=8.0)
    parser.add_argument("--seed", type=int, default=20260809)
    parser.add_argument("--num-boost-round", type=int, default=300)
    parser.add_argument("--early-stopping-rounds", type=int, default=30)
    add_master_arguments(parser)


def add_master_arguments(parser):
    parser.add_argument("--master-lookback", type=int, default=8)
    parser.add_argument("--master-epochs", type=int, default=20)
    parser.add_argument("--master-patience", type=int, default=4)
    parser.add_argument("--master-learning-rate", type=float, default=0.001)
    parser.add_argument("--master-d-model", type=int, default=32)
    parser.add_argument("--master-temporal-heads", type=int, default=2)
    parser.add_argument("--master-cross-stock-heads", type=int, default=2)
    parser.add_argument("--master-dropout", type=float, default=0.1)
    parser.add_argument("--master-gate-temperature", type=float, default=1.0)
    parser.add_argument("--master-batch-days", type=int, default=16)


def build_parser():
    parser = argparse.ArgumentParser(description="WebStock Qlib/LightGBM research sidecar")
    commands = parser.add_subparsers(dest="command", required=True)

    health = commands.add_parser("health")
    health.add_argument("--verify", action="store_true")
    health.set_defaults(handler=command_health)

    collect = commands.add_parser("collect")
    add_common_collection_arguments(collect)
    collect.set_defaults(handler=command_collect)

    run = commands.add_parser("run")
    add_common_model_arguments(run)
    run.set_defaults(handler=command_run)

    factor_lab = commands.add_parser("factor-lab")
    factor_lab.add_argument("--workspace", required=True)
    factor_lab.add_argument("--dataset-id", required=True)
    factor_lab.add_argument("--run-id", default="")
    factor_lab.add_argument("--train-days", type=int, default=504)
    factor_lab.add_argument("--validation-days", type=int, default=126)
    factor_lab.add_argument("--test-days", type=int, default=63)
    factor_lab.add_argument("--step-days", type=int, default=63)
    factor_lab.add_argument("--label-horizon", type=int, default=5)
    factor_lab.add_argument("--max-folds", type=int, default=4)
    factor_lab.add_argument("--top-k", type=int, default=20)
    factor_lab.add_argument("--cost-bps", type=float, default=8.0)
    factor_lab.add_argument("--seed", type=int, default=20260809)
    factor_lab.set_defaults(handler=command_factor_lab)

    pilot = commands.add_parser("pilot")
    add_common_collection_arguments(pilot)
    pilot.add_argument("--run-id", default="")
    pilot.add_argument("--model", choices=["lightgbm", "master"], default="lightgbm")
    pilot.add_argument("--train-days", type=int, default=504)
    pilot.add_argument("--validation-days", type=int, default=126)
    pilot.add_argument("--test-days", type=int, default=63)
    pilot.add_argument("--step-days", type=int, default=63)
    pilot.add_argument("--label-horizon", type=int, default=5)
    pilot.add_argument("--max-folds", type=int, default=4)
    pilot.add_argument("--top-k", type=int, default=20)
    pilot.add_argument("--cost-bps", type=float, default=8.0)
    pilot.add_argument("--seed", type=int, default=20260809)
    pilot.add_argument("--num-boost-round", type=int, default=300)
    pilot.add_argument("--early-stopping-rounds", type=int, default=30)
    add_master_arguments(pilot)
    pilot.set_defaults(handler=command_pilot)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        return int(args.handler(args) or 0)
    except Exception as error:
        _emit("WEBSTOCK_ERROR=", {"message": str(error), "type": type(error).__name__})
        traceback.print_exc(file=sys.stderr)
        return 1
