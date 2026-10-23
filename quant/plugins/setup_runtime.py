"""Create one independent runtime from its observed dependency/source snapshot.

Existing directories are never overwritten. Dependency verification alone does
not certify an engine; run its real adapter tests after this step.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    base=Path(__file__).resolve().parent/"runtime"
    recipes=json.loads((base/"recipes.json").read_text(encoding="utf-8"))["recipes"]
    parser=argparse.ArgumentParser()
    parser.add_argument("--recipe",choices=sorted(recipes),required=True)
    parser.add_argument("--destination",type=Path,required=True)
    parser.add_argument("--uv",default="uv",help="uv executable path")
    parser.add_argument("--python",help="Optional Python executable or version; defaults to recipe minor version")
    args=parser.parse_args();recipe=recipes[args.recipe]
    destination=args.destination.resolve()
    if destination.exists():raise ValueError("Destination already exists; choose a new empty location")
    uv=shutil.which(args.uv)
    if not uv:raise ValueError("Install uv or specify its executable using --uv")
    destination.parent.mkdir(parents=True,exist_ok=True)
    requirements=base/recipe["requirements"]
    subprocess.run([uv,"venv","--python",args.python or recipe["python"],str(destination)],check=True,timeout=300)
    python=destination/("Scripts/python.exe" if sys.platform=="win32" else "bin/python")
    log=destination/"webstock-install.log";record=destination/"webstock-runtime.json"
    state={"schema":"webstock.plugin.runtime-install.v1","recipe":args.recipe,"python":str(python),
        "createdAtUtc":datetime.now(timezone.utc).isoformat(),"requirementsSha256":hashlib.sha256(requirements.read_bytes()).hexdigest(),
        "status":"installing","adapterVerification":"pending","wheelHashesLocked":False}
    def save():record.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding="utf-8")
    save()
    try:
        with log.open("w",encoding="utf-8") as stream:
            subprocess.run([uv,"pip","install","--python",str(python),"-r",str(requirements)],check=True,stdout=stream,stderr=subprocess.STDOUT,timeout=1800)
            subprocess.run([uv,"pip","check","--python",str(python)],check=True,stdout=stream,stderr=subprocess.STDOUT,timeout=60)
        code='import sys,importlib.metadata as m,json;print(json.dumps(dict(python=list(sys.version_info[:3]),packages=sorted([dict(name=d.metadata["Name"],version=d.version) for d in m.distributions()],key=lambda x:x["name"].lower()))))'
        state["inventory"]=json.loads(subprocess.check_output([str(python),"-X","utf8","-c",code],text=True,encoding="utf-8",timeout=30))
        if '.'.join(map(str,state["inventory"]["python"][:2]))!=recipe["python"]:
            raise ValueError("Installed Python minor version differs from recipe")
        state["status"]="dependencies_verified";save()
    except Exception as error:
        state["status"]="failed";state["error"]=str(error);save()
        print("Installation failed; retained diagnostics: "+str(log),file=sys.stderr);raise
    print(json.dumps({"status":state["status"],"python":str(python),"record":str(record),"adapterVerification":"pending"},ensure_ascii=True))


if __name__=="__main__":main()
