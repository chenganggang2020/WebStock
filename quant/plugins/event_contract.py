"""Actual ordered trades / full displayed quote snapshots, with availability.

This validates source claims. It cannot certify exchange completeness, classify
aggressors, or infer hidden orders from OHLCV bars.
"""
from pathlib import Path
import csv
import numpy as np
import pandas as pd
from panel_contract import timestamps


def numeric(b, key, mask, positive=False):
    if key not in b:
        raise ValueError("Missing event field: " + key)
    values = pd.to_numeric(b.loc[mask, key], errors="raise").astype(float)
    if not np.isfinite(values).all() or (values > 1e15).any() or (values <= 0 if positive else values < 0).any():
        raise ValueError("Invalid event field: " + key)
    return values


def load_events(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        names = [x.strip().lower() for x in next(reader, [])]
        if any(len(row) != len(names) for row in reader):
            raise ValueError("Event row width differs from header")
    if not names or any(not x for x in names) or len(names) != len(set(names)):
        raise ValueError("Duplicate or empty event columns")
    b = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    b.columns = names
    required = {"time", "eventtime", "sequence", "session", "symbol", "eventtype", "source", "coverage", "currency", "volumeunit", "pricebasis"}
    if not required <= set(b):
        raise ValueError("Missing event fields: " + ", ".join(sorted(required-set(b))))
    if not 2 <= len(b) <= 100000 or len(names) > 64:
        raise ValueError("Events require 2–100000 rows and at most 64 columns")
    if b.symbol.nunique() != 1 or not b.symbol.str.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}").all():
        raise ValueError("One explicit security is required")
    for key in ("source", "coverage", "currency", "volumeunit", "pricebasis"):
        if b[key].nunique() != 1 or b[key].eq("").any() or b[key].str.len().gt(256).any():
            raise ValueError("One explicit event declaration required: " + key)
    if b.currency.iloc[0] not in ("CNY", "USD", "HKD") or not b.volumeunit.eq("share").all() or not b.pricebasis.eq("raw").all():
        raise ValueError("Events require raw prices, share units and CNY/USD/HKD")
    if b.coverage.iloc[0] not in ("events-complete", "sampled"):
        raise ValueError("Declare events-complete or sampled coverage")
    if not b.eventtype.isin(["trade", "quote"]).all():
        raise ValueError("Supported event types are trade and quote snapshots")
    for key in ("time", "eventtime"):
        b[key] = timestamps(b[key], key)
        if not b[key].is_monotonic_increasing:
            raise ValueError("Out-of-order arrival/event timestamps; normalize explicitly before import")
    if (b.eventtime > b.time).any():
        raise ValueError("Event cannot be available before it happened")
    if not b.session.str.fullmatch(r"\d{4}-\d{2}-\d{2}").all() or not b.session.is_monotonic_increasing:
        raise ValueError("Trading session date must be explicit and ordered")
    pd.to_datetime(b.session, format="%Y-%m-%d", errors="raise")
    if not b.sequence.str.fullmatch(r"[0-9]{1,15}").all():
        raise ValueError("Sequence must be a nonnegative integer of at most 15 digits")
    b["sequence"] = b.sequence.astype("int64")
    for _, rows in b.groupby("session", sort=False):
        delta = rows.sequence.diff().iloc[1:]
        if (delta <= 0).any() or (b.coverage.iloc[0] == "events-complete" and not delta.eq(1).all()):
            raise ValueError("Duplicate/reversed sequence or gap in claimed complete stream")
    trade = b.eventtype.eq("trade")
    if trade.any():
        numeric(b, "price", trade, positive=True); numeric(b, "size", trade, positive=True)
        if not {"aggressor", "sidebasis"} <= set(b) or not b.loc[trade, "aggressor"].isin(["buy", "sell", "unknown"]).all():
            raise ValueError("Each trade requires explicit buy/sell/unknown aggressor")
        if not b.loc[trade, "sidebasis"].isin(["exchange-provided", "upstream-classified", "unknown"]).all():
            raise ValueError("Trade direction provenance required")
        if (b.loc[trade, "aggressor"].eq("unknown") != b.loc[trade, "sidebasis"].eq("unknown")).any():
            raise ValueError("Unknown aggressor must have unknown classification basis")
    quote = b.eventtype.eq("quote")
    levels = set()
    for key in b.columns:
        import re
        match = re.fullmatch(r"(?:bid|ask)(?:price|size)([1-9]|10)", key)
        if match:
            levels.add(int(match[1]))
    if quote.any():
        if not levels or levels != set(range(1, max(levels)+1)):
            raise ValueError("Quote snapshots need contiguous depth levels starting at one")
        for level in sorted(levels):
            for side in ("bid", "ask"):
                price = numeric(b, f"{side}price{level}", quote, positive=True)
                numeric(b, f"{side}size{level}", quote, positive=True)
                if level > 1:
                    previous = b.loc[quote, f"{side}price{level-1}"].astype(float)
                    if (price >= previous if side == "bid" else price <= previous).any():
                        raise ValueError("Depth prices must be strictly ordered")
        if (b.loc[quote, "bidprice1"].astype(float) > b.loc[quote, "askprice1"].astype(float)).any():
            raise ValueError("Crossed quote snapshots require separate normalization")
    b.attrs["depthLevels"] = max(levels, default=0)
    return b
