"""Explicit offline conversion; reads an existing dataset, never installs or calls providers."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

def package_dataset(directory):
    import pandas as pd
    root = Path(directory).resolve()
    raw = (root / "manifest.json").read_bytes()
    manifest = json.loads(raw)
    unsigned = dict(manifest)
    claimed = unsigned.pop("manifestSha256", "")
    canonical = json.dumps(unsigned, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    if hashlib.sha256(canonical).hexdigest() != claimed:
        raise ValueError("legacy manifest hash mismatch")
    bars, artifacts = [], []
    for spec in manifest["files"]:
        relative = spec["path"]
        file = (root / relative).resolve()
        if root not in file.parents:
            raise ValueError("artifact outside dataset")
        content = file.read_bytes()
        if hashlib.sha256(content).hexdigest() != spec["sha256"]:
            raise ValueError("legacy artifact hash mismatch: " + relative)
        artifacts.append({"path": relative, "sha256": spec["sha256"], "bytesBase64": base64.b64encode(content).decode()})
        if relative.startswith("raw/") and relative.endswith(".parquet"):
            frame = pd.read_parquet(file)
            if len(frame) != spec["rows"]:
                raise ValueError("legacy artifact row count mismatch")
            for row in frame.to_dict(orient="records"):
                row["date"] = str(row["date"])[:10]
                # No code/market inference, missing value fill, future fill or deduplication.
                if not isinstance(row["code"], str):
                    raise ValueError("legacy codes need explicit six-character identity")
                bars.append({key: row[key] for key in ("date", "code", "name", "open", "high", "low", "close", "volume")})
    if not bars:
        raise ValueError("no legacy raw parquet artifacts")
    result = {
        "schema": "quant-native-dataset/v1", "datasetId": manifest["datasetId"],
        "asOf": manifest["asOf"], "source": json.dumps(manifest["source"], ensure_ascii=False, sort_keys=True),
        "adjustmentMode": manifest["adjustmentMode"], "membershipMode": manifest["universe"]["membershipMode"],
        "bars": bars,
        "legacyDatasetEvidence": {
            "manifestUtf8": raw.decode("utf-8"), "manifestFileSha256": hashlib.sha256(raw).hexdigest(),
            "manifestSha256": claimed, "artifacts": artifacts,
            "conversion": "explicit-offline-parquet-to-bars",
            "nativeLimitation": "native verifies embedded file bytes; parquet-to-bars conversion is not independently parsed on device",
        },
    }
    encoded = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    if len(encoded) > 32 * 1024 * 1024 or len(bars) > 100000:
        raise ValueError("native package bound exceeded; use an explicitly scoped dataset, never truncate")
    return encoded

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset_directory")
    parser.add_argument("output_json")
    args = parser.parse_args()
    output = Path(args.output_json).resolve()
    source = Path(args.dataset_directory).resolve()
    if output == source or source in output.parents:
        raise ValueError("output must be outside original dataset")
    data = package_dataset(source)
    # Exclusive creation prevents accidental replacement of existing evidence.
    with output.open("xb") as stream:
        stream.write(data)
    print("Offline package created:", output, len(data), "bytes; original dataset unchanged")
