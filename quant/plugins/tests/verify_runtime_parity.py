"""Compare numerical result tables after rebuilding isolated runtimes.

Operational order identifiers and run metadata are deliberately excluded. This
checks reproducibility, not agreement between different execution engines.
"""
import argparse
import json
import math
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for key in ("baseline-evidence","rebuilt-evidence","baseline-state","rebuilt-state","output"):
        p.add_argument("--"+key,type=Path,required=True)
    args=p.parse_args()
    read=lambda path:json.loads(path.read_text(encoding="utf-8"))
    original={r["pluginId"]:r for r in read(args.baseline_evidence)["runs"]}
    rows=[]
    for run in read(args.rebuilt_evidence)["runs"]:
        base=original[run["pluginId"]]
        a=read(args.baseline_state/"jobs"/base["runId"]/"result.json")
        b=read(args.rebuilt_state/"jobs"/run["runId"]/"result.json")
        assert a["formulaVersion"]==b["formulaVersion"]
        prior={t["id"]:t for t in a["tables"]};compared=[]
        for t in b["tables"]:
            if t["id"] not in ("indicators","equity","weight-index","native-dsb-bars") and not t["id"].startswith("features-"):continue
            old=prior[t["id"]];assert old["columns"]==t["columns"] and len(old["rows"])==len(t["rows"])
            for i,(left,right) in enumerate(zip(old["rows"],t["rows"],strict=True)):
                for column,x,y in zip(t["columns"],left,right,strict=True):
                    if isinstance(x,(float,int)) and not isinstance(x,bool):
                        assert isinstance(y,(float,int)) and math.isclose(x,y,rel_tol=1e-10,abs_tol=1e-8),(run["pluginId"],t["id"],i,column,x,y)
                    else:assert x==y,(run["pluginId"],t["id"],i,column,x,y)
            compared.append(t["id"])
        assert compared,run["pluginId"]
        rows.append({"pluginId":run["pluginId"],"baselineRunId":base["runId"],"rebuiltRunId":run["runId"],"comparedTables":compared,"status":"matched"})
    args.output.write_text(json.dumps({"schema":"webstock.plugin.runtime-parity.v1","absoluteTolerance":1e-8,"relativeTolerance":1e-10,"runs":rows},indent=2)+'\n',encoding="utf-8")
    print("Numerical runtime parity verified for",len(rows),"installed adapters")


if __name__=="__main__":main()
