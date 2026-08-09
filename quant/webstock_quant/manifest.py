import hashlib
import json
import os
from pathlib import Path


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def manifest_sha256(manifest):
    payload = dict(manifest)
    payload.pop("manifestSha256", None)
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def file_sha256(file_path):
    digest = hashlib.sha256()
    with Path(file_path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json_atomic(file_path, payload):
    target = Path(file_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, target)


def read_json(file_path):
    return json.loads(Path(file_path).read_text(encoding="utf-8"))
