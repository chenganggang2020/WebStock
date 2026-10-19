"""Dedicated local reference checks against actual legacy functions; no provider/account writes."""
import hashlib
import importlib.util
import json
import math
import sys
import tempfile
from pathlib import Path
import pandas as pd

repo = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(repo / "quant"))
from webstock_quant import strategy_lab as old
from webstock_quant.pipeline import build_rolling_folds
from webstock_quant.manifest import manifest_sha256

count = 0
def same(actual, expected, path):
    global count
    count += 1
    if isinstance(actual, dict) and isinstance(expected, dict):
        assert set(actual) == set(expected), (path, set(actual), set(expected))
        for key in actual:
            same(actual[key], expected[key], path + "." + key)
    elif isinstance(actual, list) and isinstance(expected, list):
        assert len(actual) == len(expected), path
        for index, value in enumerate(actual):
            same(value, expected[index], f"{path}[{index}]")
    elif isinstance(actual, (int, float)) and not isinstance(actual, bool):
        assert math.isclose(actual, expected, abs_tol=1e-10, rel_tol=1e-10), (path, actual, expected)
    else:
        assert actual == expected, (path, actual, expected)

def assumptions(c):
    return old.ExecutionAssumptions(
        commission_bps=c["commissionBps"], minimum_commission=c["minimumCommission"],
        stamp_duty_bps=c["stampDutyBps"], slippage_bps=c["slippageBps"],
        capital_per_symbol=c["capitalPerSymbol"],
    )

def reference(fixture):
    panel = pd.DataFrame(fixture["dataset"]["bars"])
    panel["date"] = pd.to_datetime(panel["date"])
    for index, case in enumerate(fixture["cases"]):
        c, result = case["config"], case["result"]
        folds = build_rolling_folds(panel.date, c["trainDays"], c["validationDays"], c["testDays"], c["stepDays"], 1, c["maxFolds"])
        same([fold.to_contract() for fold in folds], result["folds"], f"folds{index}")
        for p, parameter in enumerate(c["parameters"]):
            prepared = old.prepare_strategy_signals(panel, {"strategyFamily": c["family"], "settings": parameter["settings"]})
            if p == 0:
                same([{"buy": bool(row.entrySignal), "sell": bool(row.exitSignal)} for row in prepared.itertuples()], case["signals"], "signals" + c["family"])
            test_metrics = []
            for f, fold in enumerate(folds):
                for key in ("validation", "test"):
                    actual = old.simulate_prepared_parameter(prepared, getattr(fold, key + "_start"), getattr(fold, key + "_end"), assumptions(c))
                    expected = result["parameters"][p]["folds"][f][key]
                    same({k: actual[k] for k in expected}, expected, f"{c['family']}.{p}.{f}.{key}")
                    if key == "test":
                        test_metrics.append(actual)
            stability = old.summarize_parameter_stability(test_metrics)
            expected = result["parameters"][p]
            same(stability.pop("admission"), expected["admission"], "admission")
            same(stability.pop("reasons"), expected["reasons"], "reasons")
            same(stability, {k:v for k,v in expected["metrics"].items() if k != "validationMeanReturn"}, "stability")
        for f, selection in enumerate(result["selections"]):
            evidence = result["parameters"]
            best = max(range(len(evidence)), key=lambda p: (
                evidence[p]["folds"][f]["validation"]["netReturn"],
                evidence[p]["folds"][f]["validation"]["maxDrawdown"],
                evidence[p]["folds"][f]["validation"]["tradeCount"],
                evidence[p]["parameterId"],
            ))
            same(selection["selectedParameterId"], evidence[best]["parameterId"], "validation-only")
            prepared = old.prepare_strategy_signals(panel, {"strategyFamily": c["family"], "settings": c["parameters"][best]["settings"]})
            actual = old._simulate_single_symbol(prepared, 1, 2, folds[f].test_start, folds[f].test_end, assumptions(c))
            same(actual["trades"], selection["test"]["symbols"][0]["trades"], "full trades")
            same(actual["equity"], [row["equity"] for row in selection["test"]["symbols"][0]["equity"]], "full equity")
    edge = pd.DataFrame(fixture["edgeBars"])
    edge["date"] = pd.to_datetime(edge["date"])
    edge["crossUp"] = [row["buy"] for row in fixture["edgeSignals"]]
    edge["crossDown"] = [row["sell"] for row in fixture["edgeSignals"]]
    actual = old._simulate_single_symbol(edge,1,2,edge.date.iloc[1],edge.date.iloc[-1],assumptions(fixture["edgeConfig"]))
    same({k: actual[k] for k in fixture["edgeResult"] if k != "symbols"}, {k:v for k,v in fixture["edgeResult"].items() if k != "symbols"}, "edge metrics")
    same(actual["trades"], fixture["edgeResult"]["symbols"][0]["trades"], "blocked next-open trades")

def bridge(fixture, output):
    spec = importlib.util.spec_from_file_location("quant_bridge", repo / "native/tests/quant_research_legacy_bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    # Actual parquet encoding/decoding plus legacy manifest hashing in a dedicated temporary dataset.
    with tempfile.TemporaryDirectory(prefix="quant-native-parquet-") as work:
        directory = Path(work)
        (directory / "raw").mkdir()
        frame = pd.DataFrame(fixture["dataset"]["bars"])
        file = directory / "raw/600000.parquet"
        frame.to_parquet(file,index=False)
        content = file.read_bytes()
        manifest = {
            "schema":"webstock.quant.dataset.v1","datasetId":"legacy-fixture","asOf":"2025-12-31",
            "source":{"id":"synthetic","name":"专用真实Parquet转换测试","termsVerified":False},
            "universe":{"membershipMode":"static"},"adjustmentMode":"unadjusted",
            "files":[{"path":"raw/600000.parquet","sha256":hashlib.sha256(content).hexdigest(),"rows":len(frame)}],
            "unknown":{"preserve":"旧清单未知字段"},
        }
        manifest["manifestSha256"] = manifest_sha256(manifest)
        (directory / "manifest.json").write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
        encoded = module.package_dataset(directory)
        package = json.loads(encoded)
        same(package["bars"],fixture["dataset"]["bars"],"real parquet conversion")
        same(json.loads(package["legacyDatasetEvidence"]["manifestUtf8"]),manifest,"complete manifest")
        Path(output).write_bytes(encoded)
        file.write_bytes(content+b"tampered")
        rejected=False
        try:module.package_dataset(directory)
        except ValueError:rejected=True
        same(rejected,True,"tampered parquet rejected")

if __name__ == "__main__":
    fixture=json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    reference(fixture)
    bridge(fixture,sys.argv[2])
    print("QuantResearch actual legacy Python/Parquet PASS",count,"zero network/account writes")
