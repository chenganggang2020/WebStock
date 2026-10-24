"""Build pinned upstream LEAN in a new directory, never in the source mirror.

Offline mode uses already cached NuGet packages. A successful build is not an
adapter test; verify the resulting engineDirectory through the native host.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

COMMIT = "f3d841e60dfd010ee5fc293ea893e56952484108"
URL = "https://github.com/QuantConnect/Lean.git"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--source-mirror", type=Path)
    parser.add_argument("--dotnet", default="dotnet")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        raise ValueError("Destination exists; choose a new directory")
    dotnet = shutil.which(args.dotnet)
    if not dotnet:
        raise ValueError(".NET 10 SDK is required")
    sdk = subprocess.check_output([dotnet, "--version"], text=True).strip()
    if not sdk.startswith("10."):
        raise ValueError("This pinned LEAN version requires .NET 10 SDK")
    if args.offline and not args.source_mirror:
        raise ValueError("Offline build requires a source mirror")
    locks_root = Path(__file__).resolve().parent / "runtime/lean-locks"
    lock_index = json.loads((locks_root / "index.json").read_text(encoding="utf-8"))
    if lock_index["schema"] != "webstock.lean.dependency-locks.v1" or lock_index["sourceCommit"] != COMMIT:
        raise ValueError("Dependency locks do not match pinned source")
    locked_files = {}
    for name, expected in lock_index["files"].items():
        if "\\" in name or ":" in name or name.startswith("/") or any(p in ("", ".", "..") for p in name.split("/")):
            raise ValueError("Invalid lock file path")
        raw = (locks_root / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError("Dependency lock hash mismatch: " + name)
        locked_files[name] = raw
    if not locked_files:
        raise ValueError("Missing dependency locks")
    source = str(args.source_mirror.resolve()) if args.source_mirror else URL
    if args.source_mirror:
        actual = subprocess.check_output(["git", "-C", source, "rev-parse", COMMIT + "^{commit}"], text=True).strip()
        if actual != COMMIT:
            raise ValueError("Source mirror does not contain pinned commit")
    env = dict(os.environ, DOTNET_CLI_TELEMETRY_OPTOUT="1", DOTNET_NOLOGO="1", PYTHONUTF8="1")
    count = int(env.get("GIT_CONFIG_COUNT", "0"))
    env.update({"GIT_CONFIG_COUNT": str(count + 1), f"GIT_CONFIG_KEY_{count}": "core.longpaths", f"GIT_CONFIG_VALUE_{count}": "true"})
    destination.mkdir(parents=True)
    engine = destination / "source"
    state = {"schema": "webstock.plugin.lean-runtime-install.v1", "source": URL, "commit": COMMIT,
             "sdk": sdk, "offline": args.offline, "engineDirectory": str(engine), "status": "building",
             "createdAtUtc": datetime.now(timezone.utc).isoformat(), "adapterVerification": "pending"}
    record = destination / "webstock-runtime.json"
    log = destination / "webstock-install.log"

    def save():
        record.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    save()
    try:
        with log.open("w", encoding="utf-8") as stream:
            def run(command, cwd=destination, timeout=1800):
                stream.write(json.dumps(command) + "\n"); stream.flush()
                subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT,
                               timeout=timeout, check=True)
            run(["git", "clone", "--no-hardlinks", "--no-checkout", source, str(engine)])
            run(["git", "checkout", "--detach", COMMIT], engine)
            actual = subprocess.check_output(["git", "-C", str(engine), "rev-parse", "HEAD"], text=True).strip()
            if actual != COMMIT:
                raise ValueError("Checked-out commit differs from pin")
            # SDK selection is local to this new runtime directory.
            (destination / "global.json").write_text(json.dumps({"sdk": {"version": sdk, "rollForward": "disable"}}), encoding="utf-8")
            project = "Launcher/QuantConnect.Lean.Launcher.csproj"
            for name, raw in locked_files.items():
                target = engine / name
                target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(raw)
            restore = [dotnet, "restore", project, "--locked-mode", "-p:NuGetAudit=false", "--disable-parallel"]
            if args.offline:
                feed = destination / "empty-offline-feed"; feed.mkdir()
                restore += ["--source", str(feed)]
            run(restore, engine)
            run([dotnet, "build", project, "--configuration", "Release", "--no-restore", "--no-incremental", "-m:2", "-v:minimal"], engine)
        output = engine / "Launcher/bin/Release"
        expected = ["QuantConnect.Lean.Launcher.dll", "QuantConnect.Lean.Engine.dll", "QuantConnect.Algorithm.dll"]
        if not all((output / name).is_file() for name in expected) or not (engine / "Data").is_dir():
            raise ValueError("Missing required engine build files or Data")
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        locks = sorted(engine.rglob("packages.lock.json"))
        if not locks:
            raise ValueError("No NuGet dependency locks produced")
        if {p.relative_to(engine).as_posix(): digest(p) for p in locks} != lock_index["files"]:
            raise ValueError("Build changed dependency locks")
        state.update(status="build_verified", dependencyLocks={str(p.relative_to(engine)): digest(p) for p in locks},
                     assemblySha256={p.name: digest(p) for p in sorted(output.glob("*.dll"))},
                     dependenciesResolvedWithContentHashes=True, lockedRestore=True)
        save()
    except Exception as error:
        state.update(status="failed", error=str(error)); save()
        print("Build failed; retained diagnostics: " + str(log), file=sys.stderr)
        raise
    print(json.dumps({"status": state["status"], "engineDirectory": str(engine), "record": str(record),
                      "adapterVerification": "pending"}))


if __name__ == "__main__":
    main()
