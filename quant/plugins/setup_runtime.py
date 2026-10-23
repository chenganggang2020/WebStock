"""Create one independent runtime from its observed dependency/source snapshot.

Existing directories are never overwritten. Dependency verification alone does
not certify an engine; run its real adapter tests after this step.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request


def main():
    base=Path(__file__).resolve().parent/"runtime"
    recipes=json.loads((base/"recipes.json").read_text(encoding="utf-8"))["recipes"]
    parser=argparse.ArgumentParser()
    parser.add_argument("--recipe",choices=sorted(recipes),required=True)
    parser.add_argument("--destination",type=Path,required=True)
    parser.add_argument("--uv",default="uv",help="uv executable path")
    parser.add_argument("--python",help="Optional Python executable or version; defaults to recipe minor version")
    parser.add_argument("--offline",action="store_true",help="Use existing uv cache only; fail rather than fetching missing files")
    parser.add_argument("--source-root",type=Path,help="Optional directory of previously cloned source repositories; pinned commits are verified")
    args=parser.parse_args();recipe=recipes[args.recipe]
    # Set Git's Windows long-path handling for installer child processes only.
    # Do not change the user's global Git or Windows configuration.
    child_environment=os.environ.copy()
    child_environment["PYTHONUTF8"]="1"
    if sys.platform=="win32":
        count=int(child_environment.get("GIT_CONFIG_COUNT","0"))
        child_environment.update({"GIT_CONFIG_COUNT":str(count+1),f"GIT_CONFIG_KEY_{count}":"core.longpaths",f"GIT_CONFIG_VALUE_{count}":"true"})
    destination=args.destination.resolve()
    if destination.exists():raise ValueError("Destination already exists; choose a new empty location")
    uv=shutil.which(args.uv)
    if not uv:raise ValueError("Install uv or specify its executable using --uv")
    destination.parent.mkdir(parents=True,exist_ok=True)
    requirements=base/recipe["requirements"]
    offline=["--offline"] if args.offline else []
    subprocess.run([uv,*offline,"venv","--python",args.python or recipe["python"],str(destination)],check=True,timeout=300)
    python=destination/("Scripts/python.exe" if sys.platform=="win32" else "bin/python")
    log=destination/"webstock-install.log";record=destination/"webstock-runtime.json"
    state={"schema":"webstock.plugin.runtime-install.v1","recipe":args.recipe,"python":str(python),
        "createdAtUtc":datetime.now(timezone.utc).isoformat(),"requirementsSha256":hashlib.sha256(requirements.read_bytes()).hexdigest(),
        "status":"installing","adapterVerification":"pending","wheelHashesLocked":False,"offline":args.offline}
    def save():record.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n',encoding="utf-8")
    save()
    try:
        install_requirements=requirements
        if args.source_root:
            contents=requirements.read_text(encoding="utf-8");mirrors=[]
            for source in recipe.get("sourceRepositories",[]):
                folder=(args.source_root/source["directoryName"]).resolve()
                actual=subprocess.check_output(["git","-C",str(folder),"rev-parse",source["commit"]+"^{commit}"],text=True).strip()
                if actual!=source["commit"]:raise ValueError("Source mirror commit mismatch")
                original="git+"+source["url"]+"@"+source["commit"]
                if contents.count(original)!=1:raise ValueError("Source entry mismatch")
                contents=contents.replace(original,"git+"+folder.as_uri()+"@"+source["commit"])
                mirrors.append({**source,"localMirror":str(folder)})
            install_requirements=destination/"webstock-install-requirements.txt"
            install_requirements.write_text(contents,encoding="utf-8")
            state["sourceMirrors"]=mirrors;save()
        with log.open("w",encoding="utf-8") as stream:
            subprocess.run([uv,*offline,"pip","install","--python",str(python),"-r",str(install_requirements)],check=True,stdout=stream,stderr=subprocess.STDOUT,timeout=1800,env=child_environment)
            subprocess.run([uv,"pip","check","--python",str(python)],check=True,stdout=stream,stderr=subprocess.STDOUT,timeout=60)
        restored=[]
        for asset in recipe.get("restoreSourceData",[]):
            source=next(x for x in recipe["sourceRepositories"] if x["directoryName"]==asset["repository"])
            if args.source_root:
                raw=subprocess.check_output(["git","-C",str(args.source_root/source["directoryName"]),"show",source["commit"]+":"+asset["path"]])
            else:
                if args.offline:raise ValueError("Restoring this upstream data file offline requires --source-root")
                repo=source["url"].removeprefix("https://github.com/").removesuffix(".git")
                url="https://raw.githubusercontent.com/"+repo+"/"+source["commit"]+"/"+asset["path"]
                with urllib.request.urlopen(url,timeout=60) as response:raw=response.read(4*1024*1024)
            if hashlib.sha256(raw).hexdigest()!=asset["sha256"]:raise ValueError("Source data file hash mismatch")
            purelib=Path(subprocess.check_output([str(python),"-c","import sysconfig;print(sysconfig.get_path('purelib'))"],text=True).strip())
            target=(purelib/asset["destination"]).resolve()
            if not target.is_relative_to(destination):raise ValueError("Source data target outside new runtime")
            if target.exists() and target.read_bytes()!=raw:raise ValueError("Refusing to replace differing installed data")
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
            restored.append({**asset,"commit":source["commit"],"managedBy":"webstock-runtime manifest, additional upstream data file"})
        state["restoredSourceData"]=restored
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
