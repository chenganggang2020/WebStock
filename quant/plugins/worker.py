"""Versioned plugin worker. All job paths are relative to a frozen job.

The native host owns process lifetime and validates the result a second time.
Plugins are executable code, not a security sandbox. Never load untrusted packages.
"""
from __future__ import annotations

import hashlib
import csv
import importlib.metadata
import json
import math
import os
from pathlib import Path
import sys
import traceback

PROTOCOL = "webstock.plugin.result.v1"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs,
                      parse_constant=lambda s: (_ for _ in ()).throw(ValueError(s)))


def checked_path(root, name):
    if not isinstance(name, str) or "\\" in name or ":" in name or name.startswith("/"):
        raise ValueError("Invalid relative path")
    if any(p in ("", ".", "..") for p in name.split("/")):
        raise ValueError("Invalid relative path")
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Path outside job")
    return path


def clean(value):
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if hasattr(value, "item"):
        return clean(value.item())
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return str(value)


def table(name, frame):
    return {"id": name, "columns": list(map(str, frame.columns)),
            "rows": clean(frame.to_numpy().tolist())}


def load_bars(path):
    import numpy as np
    import pandas as pd
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        header = next(csv.reader(stream), [])
    normalized = [str(c).strip().lower() for c in header]
    if len(set(normalized)) != len(normalized) or any(not c for c in normalized):
        raise ValueError("Duplicate or empty CSV column names")
    frame = pd.read_csv(path)
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    if len(set(frame.columns)) != len(frame.columns):
        raise ValueError("Duplicate column names")
    if "time" not in frame:
        aliases = [x for x in ("date", "datetime") if x in frame]
        if len(aliases) != 1:
            raise ValueError("CSV requires one time/date/datetime column")
        frame = frame.rename(columns={aliases[0]: "time"})
    required = ["open", "high", "low", "close", "volume"]
    if not set(required).issubset(frame.columns):
        raise ValueError("CSV requires open/high/low/close/volume")
    if not 2 <= len(frame) <= 100000:
        raise ValueError("CSV requires 2–100000 closed bars")
    for key in ("symbol", "code", "securityid"):
        if key in frame and frame[key].nunique(dropna=False) != 1:
            raise ValueError("This operation requires a single security")
    stamp = pd.to_datetime(frame.time, errors="raise")
    if stamp.isna().any() or not stamp.is_monotonic_increasing or stamp.duplicated().any():
        raise ValueError("Bar times must be unique and strictly increasing")
    for key in required:
        frame[key] = pd.to_numeric(frame[key], errors="raise").astype(float)
    if not np.isfinite(frame[required].to_numpy()).all():
        raise ValueError("OHLCV contains missing or nonfinite data")
    if (frame[["open", "high", "low", "close"]] <= 0).any().any() or (frame.volume < 0).any():
        raise ValueError("Invalid price or volume")
    if ((frame.high < frame[["open", "close", "low"]].max(axis=1)) |
            (frame.low > frame[["open", "close", "high"]].min(axis=1))).any():
        raise ValueError("Inconsistent OHLC range")
    if "isclosed" in frame and not frame.isclosed.astype(str).str.lower().isin(["true", "1"]).all():
        raise ValueError("Unclosed bars are not supported")
    frame["time"] = stamp.astype(str)
    return frame


def validate_parameters(operation, supplied):
    if not isinstance(supplied, dict):
        raise ValueError("Parameters must be an object")
    fields = {p["id"]: p for p in operation["parameters"]}
    if set(supplied) - set(fields):
        raise ValueError("Unknown parameter")
    result = {}
    for key, field in fields.items():
        value = supplied.get(key, field["default"])
        if field["type"] == "choice":
            if value not in field["choices"]:
                raise ValueError(f"Invalid choice: {key}")
        elif field["type"] == "text":
            import re
            from datetime import date
            if not isinstance(value,str) or not field["minLength"]<=len(value)<=field["maxLength"] or any(ord(c)<32 or ord(c)==127 for c in value):
                raise ValueError(f"Invalid text: {key}")
            if field["format"]=="cn-stock" and not re.fullmatch(r"[0-9]{6}",value):
                raise ValueError(f"Six-digit stock code required: {key}")
            if field["format"]=="date":
                if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}",value):raise ValueError(f"ISO date required: {key}")
                date.fromisoformat(value)
        else:
            if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
                raise ValueError(f"Invalid number: {key}")
            if not field["minimum"] <= value <= field["maximum"]:
                raise ValueError(f"Out of range: {key}")
            if field["type"] == "integer" and value != int(value):
                raise ValueError(f"Integer required: {key}")
            if field["type"] == "integer":
                value = int(value)
        result[key] = value
    return result


def compute(manifest, operation, frame, parameters):
    if manifest["id"] == "org.webstock.statistical-models":
        if operation["inputKind"]=="market-panel-csv":
            from econometric_panel import calculate
        else:
            from statistical_models import calculate
        return calculate(operation["id"],frame,parameters)
    if manifest["id"] == "org.webstock.learning-models":
        from learning_models import calculate
        return calculate(operation["id"],frame,parameters)
    if manifest["id"] == "org.webstock.event-research":
        from event_research import calculate
        return calculate(operation["id"],frame,parameters)
    if manifest["id"] == "org.webstock.panel-research":
        from panel_research import calculate
        return calculate(operation["id"],frame,parameters)
    if manifest["id"] == "org.webstock.lean":
        from lean_adapter import calculate
        return calculate(frame,parameters)
    if manifest["id"] == "org.webstock.akshare":
        from akshare_adapter import fetch
        return fetch(parameters)
    if manifest["id"] == "org.webstock.talib":
        import pandas as pd
        import talib
        from talib import abstract
        function = abstract.Function(operation["function"])
        arguments = dict(parameters)
        period_vector = arguments.pop("periodVector", None)
        function.set_parameters(arguments)
        inputs = {key: frame[key].to_numpy() for key in ("open", "high", "low", "close", "volume")}
        if period_vector is not None:
            import numpy as np
            inputs["periods"] = np.full(len(frame), period_vector, dtype=float)
        values = function(inputs)
        arrays = values if isinstance(values, (list, tuple)) else [values]
        output = pd.DataFrame({"time": frame.time})
        for name, array in zip(function.output_names, arrays, strict=True):
            output[name] = array
        return {"kind": "indicator", "engineVersion": talib.__version__,
                "formulaVersion": operation["formulaVersion"], "kernelVersion": "TA-Lib/" + str(talib.__ta_version__),
                "warmupBars": function.lookback, "tables": [table("indicators", output)],
                "warnings": ["计算库公式结果；不代表买卖建议。", operation["description"]]}
    if manifest["id"] == "org.webstock.core-indicators":
        from core_indicators import calculate
        output, warnings = calculate(operation["id"], frame, parameters)
        return {"kind": "indicator", "engineVersion": manifest["version"],
                "formulaVersion": operation["formulaVersion"], "tables": [table("indicators", output)],
                "warnings": warnings}
    if manifest["id"] == "org.webstock.hikyuu":
        from hikyuu_adapter import calculate
        return calculate(frame, parameters)
    if manifest["id"] in ("org.webstock.backtesting-py", "org.webstock.backtrader", "org.webstock.vectorbt", "org.webstock.ml4t-backtest"):
        from backtest_adapters import calculate
        return calculate(manifest["id"].split(".")[-1], frame, parameters)
    if manifest["id"] == "org.webstock.quantaxis":
        from quantaxis_adapter import calculate
        return calculate(operation["id"], frame, parameters)
    if manifest["id"] == "org.webstock.vnpy":
        from vnpy_adapters import indicators
        return indicators(operation["id"],frame,parameters)
    if manifest["id"] == "org.webstock.vnpy-ctastrategy":
        from vnpy_adapters import cta_backtest
        return cta_backtest(frame,parameters)
    if manifest["id"] == "org.webstock.qlib":
        from qlib_adapter import calculate
        return calculate(frame)
    if manifest["id"] == "org.webstock.zipline-reloaded":
        from zipline_adapter import calculate
        return calculate(frame,parameters)
    if manifest["id"] == "org.webstock.rqalpha":
        from rqalpha_adapter import calculate
        return calculate(frame,parameters)
    if manifest["id"] == "org.webstock.wtpy":
        from wondertrader_adapters import roundtrip
        return roundtrip(frame)
    if manifest["id"] == "org.webstock.wondertrader":
        from wondertrader_adapters import backtest
        return backtest(frame,parameters)
    if manifest["id"] in ("org.webstock.bt", "org.webstock.wbt", "org.webstock.czsc"):
        from research_adapters import calculate
        return calculate(manifest["id"].split(".")[-1], frame, parameters)
    raise ValueError("Engine adapter is not implemented")


def main():
    root = Path(sys.argv[1]).resolve().parent
    request_path = root / "request.json"
    request = read_json(request_path)
    if request["schema"] != "webstock.plugin.request.v1" or request["automaticTrading"] is not False:
        raise ValueError("Unsupported request")
    manifest_path = root / "plugin" / "manifest.json"
    manifest = read_json(manifest_path)
    if digest(manifest_path.read_bytes()) != request["manifestSha256"]:
        raise ValueError("Manifest changed")
    for name, expected in manifest["files"].items():
        if digest(checked_path(root / "plugin", name).read_bytes()) != expected:
            raise ValueError("Plugin file changed: " + name)
    operation = next(x for x in manifest["operations"] if x["id"] == request["operationId"])
    parameters = validate_parameters(operation, request["parameters"])
    source = checked_path(root, request["input"]["path"])
    if digest(source.read_bytes()) != request["input"]["sha256"]:
        raise ValueError("Frozen input changed")
    query=operation["inputKind"]=="parameters-only"
    if request["input"]["path"] != ("input.json" if query else "input.csv"):
        raise ValueError("Frozen input kind mismatch")
    if query:
        if read_json(source)!={"schema":"webstock.plugin.query.v1","operationId":operation["id"],"parameters":parameters}:
            raise ValueError("Frozen query differs from parameters")
    elif operation["inputKind"]=="market-events-csv":
        if request["input"].get("knownEventsOnly") is not True or request["input"].get("kind")!="market-events-csv":
            raise ValueError("Known-event acknowledgement and input kind required")
    elif request["input"]["closedBarsOnly"] is not True:
        raise ValueError("Closed-bar acknowledgement required")
    print(json.dumps({"event": "progress", "message": "核验完成，正在计算", "percent": 15}), flush=True)
    if query:
        frame=None
    elif operation["inputKind"]=="market-panel-csv":
        from panel_contract import load_panel
        frame=load_panel(source)
    elif operation["inputKind"]=="market-events-csv":
        from event_contract import load_events
        frame=load_events(source)
    else:
        frame=load_bars(source)
    computed = compute(manifest, operation, frame, parameters)
    versions = {}
    for dependency in manifest.get("distributions", []):
        versions[dependency] = importlib.metadata.version(dependency)
    result = {"schema": PROTOCOL, "status": "completed", "automaticTrading": False,
              "runId": request["runId"], "pluginId": manifest["id"], "pluginVersion": manifest["version"],
              "operationId": operation["id"], "requestSha256": digest(request_path.read_bytes()),
              "inputSha256": request["input"]["sha256"], "manifestSha256": request["manifestSha256"],
              "parameters": parameters, "dependencies": versions, "bars": computed["bars"] if query else len(frame),
              "dataPolicy": request["input"], **computed}
    blob = json.dumps(clean(result), ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(blob) > 24 * 1024 * 1024:
        raise ValueError("Result exceeds 24 MiB")
    temporary = root / "result.json.tmp"
    temporary.write_bytes(blob)
    os.replace(temporary, root / "result.json")
    print(json.dumps({"event": "result", "path": "result.json", "sha256": digest(blob)}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}, ensure_ascii=False), flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
