"""Read-only consistent snapshot of the native cache for a new preview root."""
from pathlib import Path
import shutil
import sqlite3
import sys

source, destination = (Path(p).resolve() for p in sys.argv[1:])
if destination.exists():
    raise SystemExit("Destination already exists; refusing to alter a preview cache")
destination.mkdir(parents=True)
database = source / "market-v1.sqlite"
if database.is_file():
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as reader:
        with sqlite3.connect(destination / database.name) as writer:
            reader.backup(writer)
            if writer.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise SystemExit("Market cache snapshot failed integrity check")
for path in source.glob("*.json"):
    if path.is_file():
        shutil.copy2(path, destination / path.name)
