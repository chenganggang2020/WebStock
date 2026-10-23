"""Install generated packages and run every project's first operation in C++.

All machine locations are command-line inputs. Evidence is written locally, not
committed automatically. The historical fixture is never a performance proof.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess


def main():
    p=argparse.ArgumentParser()
    for name in ("host","packages","environment-root","data","state","evidence"):
        p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--only",help="Comma-separated project ids; default all packages")
    p.add_argument("--operations",help="Comma-separated operation ids for the selected project")
    args=p.parse_args()
    mapping={"talib":("data-tools","rsi"),"core-indicators":("data-tools","donchian-prior"),
        "hikyuu":("hikyuu","sma-cross"),"backtesting-py":("backtesting-py","sma-cross"),
        "backtrader":("backtrader","sma-cross"),"vectorbt":("vectorbt","sma-cross"),
        "bt":("bt","sma-weight"),"wbt":("czsc","sma-weight"),"czsc":("czsc","online-bi"),
        "ml4t-backtest":("ml4t-backtest","sma-cross"),"quantaxis":("quantaxis311","kdj"),
        "vnpy":("vnpy","rsi"),"vnpy-ctastrategy":("vnpy","sma-limit"),"qlib":("qlib","alpha158"),
        "zipline-reloaded":("zipline-reloaded","sma-close"),"rqalpha":("rqalpha","sma-close")}
    environment=dict(os.environ,QT_QPA_PLATFORM="offscreen",PYTHONUTF8="1")
    rows=[]
    for package in sorted(args.packages.glob("*.wspkg")):
        manifest=json.loads(package.read_text(encoding="utf-8"))["manifest"]
        engine=manifest["id"].split(".")[-1]
        if args.only and engine not in args.only.split(","):continue
        runtime,operation=mapping[engine]
        exe=args.environment_root/runtime/"Scripts/python.exe"
        base=[str(args.host),"--root",str(args.state)]
        installed=subprocess.run(base+["--install",str(package),"--runtime",str(exe)],env=environment,
                                 capture_output=True,text=True,encoding="utf-8",timeout=60)
        if installed.returncode:raise RuntimeError(installed.stderr+installed.stdout)
        for operation in args.operations.split(",") if args.operations else [operation]:
            ran=subprocess.run(base+["--run",manifest["id"]+"/"+operation,"--input",str(args.data)],env=environment,
                               capture_output=True,text=True,encoding="utf-8",timeout=240)
            records=[json.loads(line) for line in ran.stdout.splitlines() if line.startswith("{")]
            if not records or ran.returncode or records[-1]["status"]!="completed":
                raise RuntimeError(engine+": "+ran.stdout+ran.stderr)
            record=records[-1];result=json.loads((args.state/"jobs"/record["runId"]/"result.json").read_text(encoding="utf-8"))
            assert result["pluginVersion"]==manifest["version"]
            op=next(x for x in manifest["operations"] if x["id"]==operation)
            assert result["formulaVersion"]==op["formulaVersion"]
            assert result["bars"]>100
            row={"pluginId":manifest["id"],"operationId":operation,"version":manifest["version"],"status":"verified",
                 "runId":record["runId"],"resultSha256":record["resultSha256"],"bars":result["bars"],
                 "tables":[{"id":t["id"],"rows":len(t["rows"])} for t in result["tables"]]}
            rows.append(row);print(json.dumps(row,ensure_ascii=False),flush=True)
    args.evidence.parent.mkdir(parents=True,exist_ok=True)
    args.evidence.write_text(json.dumps({"schema":"webstock.plugin.native-acceptance.v1","runs":rows},ensure_ascii=False,indent=2),encoding="utf-8")


if __name__=="__main__":main()
