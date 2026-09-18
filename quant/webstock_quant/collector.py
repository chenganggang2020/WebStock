from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests

from .manifest import file_sha256, manifest_sha256, read_json, write_json_atomic


SINA_KLINE_URL = (
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "CN_MarketData.getKLineData"
)
EASTMONEY_KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
EASTMONEY_KLINE_HTTP_FALLBACK_URL = "http://push2his.eastmoney.com/api/qt/stock/kline/get"
TENCENT_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/kline/kline"
TENCENT_FQ_KLINE_URL = "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_FQ_KLINE_ALTERNATE_URL = "https://ifzq.gtimg.cn/appstock/app/fqkline/get"
TENCENT_FQ_KLINE_PROXY_URL = (
    "https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get"
)
DATA_COLUMNS = ["date", "code", "name", "open", "high", "low", "close", "volume"]


def _normal_code(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits.zfill(6) if len(digits) <= 6 else digits[-6:]


def _is_current_st(name):
    return bool(re.match(r"^\*?ST", str(name or "").strip(), flags=re.IGNORECASE))


def _even_sample(items, limit):
    if not limit or limit >= len(items):
        return list(items)
    if limit == 1:
        return [items[0]]
    indexes = [round(index * (len(items) - 1) / (limit - 1)) for index in range(limit)]
    return [items[index] for index in dict.fromkeys(indexes)]


def select_universe(stocks, limit=None, codes=None):
    requested_codes = {_normal_code(code) for code in (codes or []) if str(code or "").strip()}
    eligible = []
    excluded = {"currentSt": 0, "invalid": 0, "notRequested": 0}
    seen = set()
    for item in stocks:
        code = _normal_code(item.get("code"))
        name = str(item.get("name") or code).strip()
        if not re.fullmatch(r"\d{6}", code) or code in seen:
            excluded["invalid"] += 1
            continue
        seen.add(code)
        if _is_current_st(name):
            excluded["currentSt"] += 1
            continue
        if requested_codes and code not in requested_codes:
            excluded["notRequested"] += 1
            continue
        eligible.append({"code": code, "name": name})
    eligible.sort(key=lambda item: item["code"])
    safe_limit = max(int(limit or 0), 0)
    return _even_sample(eligible, safe_limit), excluded


def _sina_symbol(code):
    if str(code).startswith("9"):
        return "bj" + code
    return ("sh" if re.match(r"^[56]", code) else "sz") + code


def _data_length(start_date, end_date):
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    calendar_days = max((end - start).days, 1)
    return min(max(math.ceil(calendar_days * 250 / 365) + 80, 120), 10000)


def fetch_sina_history(session, stock, start_date, end_date, retries=4):
    params = {
        "symbol": _sina_symbol(stock["code"]),
        "scale": "240",
        "ma": "no",
        "datalen": str(_data_length(start_date, end_date)),
    }
    last_error = None
    for attempt in range(retries + 1):
        try:
            response = session.get(
                SINA_KLINE_URL,
                params=params,
                headers={"Referer": "https://finance.sina.com.cn"},
                timeout=20,
            )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, list):
                raise ValueError("provider returned a non-list payload")
            frame = pd.DataFrame(payload)
            if frame.empty:
                raise ValueError("provider returned no rows")
            required = {"day", "open", "high", "low", "close", "volume"}
            if not required.issubset(frame.columns):
                raise ValueError("provider payload is missing K-line columns")
            frame = frame.rename(columns={"day": "date"})
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
            for column in ["open", "high", "low", "close", "volume"]:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            frame = frame[
                (frame["date"] >= pd.Timestamp(start_date))
                & (frame["date"] <= pd.Timestamp(end_date))
            ]
            frame = frame.dropna(subset=["date", "open", "high", "low", "close", "volume"])
            frame = frame[(frame["close"] > 0) & (frame["volume"] >= 0)].copy()
            if frame.empty:
                raise ValueError("provider returned no valid rows in the requested range")
            frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")
            frame["code"] = stock["code"]
            frame["name"] = stock["name"]
            return frame[DATA_COLUMNS].sort_values("date").drop_duplicates("date", keep="last")
        except Exception as error:
            last_error = error
            if attempt < retries:
                status = getattr(getattr(error, "response", None), "status_code", None)
                if status in (429, 456):
                    retry_after = getattr(error.response, "headers", {}).get("Retry-After")
                    try:
                        delay = max(float(retry_after), 1.0)
                    except (TypeError, ValueError):
                        delay = min(3 * (3 ** attempt), 60)
                    time.sleep(delay)
                else:
                    time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(str(last_error))


def fetch_eastmoney_history(
    session, stock, start_date, end_date, retries=3, adjustment_mode="unadjusted"
):
    if adjustment_mode not in ("unadjusted", "forward-adjusted"):
        raise ValueError("unsupported adjustment mode")
    market = "1" if re.match(r"^[56]", stock["code"]) else "0"
    params = {
        "secid": f"{market}.{stock['code']}",
        "fields1": "f1,f2,f3",
        "fields2": "f51,f52,f53,f54,f55,f56",
        "klt": "101",
        "fqt": "1" if adjustment_mode == "forward-adjusted" else "0",
        "beg": pd.Timestamp(start_date).strftime("%Y%m%d"),
        "end": pd.Timestamp(end_date).strftime("%Y%m%d"),
    }
    last_error = None
    for attempt in range(retries + 1):
        try:
            source_id = "eastmoney-public-kline"
            if adjustment_mode == "forward-adjusted":
                source_id += "-forward-adjusted"
            try:
                response = session.get(EASTMONEY_KLINE_URL, params=params, timeout=20)
            except requests.ConnectionError:
                response = session.get(
                    EASTMONEY_KLINE_HTTP_FALLBACK_URL,
                    params=params,
                    headers={"Referer": "https://quote.eastmoney.com/"},
                    timeout=20,
                )
                source_id = "eastmoney-public-kline-http-fallback"
                if adjustment_mode == "forward-adjusted":
                    source_id += "-forward-adjusted"
            response.raise_for_status()
            payload = response.json()
            klines = ((payload or {}).get("data") or {}).get("klines") or []
            rows = [str(item).split(",")[:6] for item in klines]
            frame = pd.DataFrame(rows, columns=["date", "open", "close", "high", "low", "volume"])
            if frame.empty:
                raise ValueError("fallback provider returned no rows")
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
            for column in ["open", "high", "low", "close", "volume"]:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            frame = frame.dropna(subset=["date", "open", "high", "low", "close", "volume"])
            frame = frame[(frame["close"] > 0) & (frame["volume"] >= 0)].copy()
            if frame.empty:
                raise ValueError("fallback provider returned no valid rows")
            frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")
            frame["code"] = stock["code"]
            frame["name"] = stock["name"]
            result = frame[DATA_COLUMNS].sort_values("date").drop_duplicates("date", keep="last")
            result.attrs["source_id"] = source_id
            return result
        except Exception as error:
            last_error = error
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(str(last_error))


def fetch_tencent_history(session, stock, start_date, end_date, retries=3):
    symbol = _sina_symbol(stock["code"])
    params = {
        "param": ",".join([
            symbol, "day", pd.Timestamp(start_date).strftime("%Y-%m-%d"),
            pd.Timestamp(end_date).strftime("%Y-%m-%d"), str(_data_length(start_date, end_date)),
        ])
    }
    last_error = None
    for attempt in range(retries + 1):
        try:
            response = session.get(TENCENT_KLINE_URL, params=params, timeout=20)
            response.raise_for_status()
            payload = response.json()
            rows = (((payload or {}).get("data") or {}).get(symbol) or {}).get("day") or []
            frame = pd.DataFrame(
                [list(item)[:6] for item in rows],
                columns=["date", "open", "close", "high", "low", "volume"],
            )
            if frame.empty:
                raise ValueError("second fallback provider returned no rows")
            frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
            for column in ["open", "high", "low", "close", "volume"]:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            frame = frame.dropna(subset=["date", "open", "high", "low", "close", "volume"])
            frame = frame[(frame["close"] > 0) & (frame["volume"] >= 0)].copy()
            if frame.empty:
                raise ValueError("second fallback provider returned no valid rows")
            frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")
            frame["code"] = stock["code"]
            frame["name"] = stock["name"]
            return frame[DATA_COLUMNS].sort_values("date").drop_duplicates("date", keep="last")
        except Exception as error:
            last_error = error
            if attempt < retries:
                time.sleep(min(3 * (2 ** attempt), 30))
    raise RuntimeError(str(last_error))


def fetch_tencent_forward_adjusted_history(
    session, stock, start_date, end_date, retries=2, page_size=640
):
    symbol = _sina_symbol(stock["code"])
    start_day = pd.Timestamp(start_date)
    cursor = pd.Timestamp(end_date)
    collected = []
    used_qfq_day_series = False
    endpoint_keys = ["primary", "alternate", "finance-proxy"]
    endpoint_urls = {
        "primary": TENCENT_FQ_KLINE_URL,
        "alternate": TENCENT_FQ_KLINE_ALTERNATE_URL,
        "finance-proxy": TENCENT_FQ_KLINE_PROXY_URL,
    }
    endpoint_key = getattr(session, "_webstock_tencent_fq_endpoint", "primary")
    if endpoint_key not in endpoint_urls:
        endpoint_key = "primary"
    page_size = min(max(int(page_size), 2), 640)
    for _ in range(10):
        last_error = None
        rows = []
        for attempt in range(retries + 1):
            try:
                params = {
                    "param": ",".join([
                        symbol,
                        "day",
                        start_day.strftime("%Y-%m-%d"),
                        cursor.strftime("%Y-%m-%d"),
                        str(page_size),
                        "qfq",
                    ])
                }
                while True:
                    response = session.get(
                        endpoint_urls[endpoint_key], params=params, timeout=20
                    )
                    try:
                        response.raise_for_status()
                        break
                    except requests.HTTPError as error:
                        status = getattr(
                            getattr(error, "response", None), "status_code", None
                        )
                        endpoint_index = endpoint_keys.index(endpoint_key)
                        if status != 501 or endpoint_index >= len(endpoint_keys) - 1:
                            raise
                        endpoint_key = endpoint_keys[endpoint_index + 1]
                        try:
                            session._webstock_tencent_fq_endpoint = endpoint_key
                        except Exception:
                            pass
                payload = response.json()
                symbol_payload = (
                    ((payload or {}).get("data") or {}).get(symbol) or {}
                )
                rows = symbol_payload.get("qfqday") or []
                if not rows and not symbol.startswith("bj"):
                    rows = symbol_payload.get("day") or []
                    used_qfq_day_series = bool(rows)
                break
            except Exception as error:
                last_error = error
                if attempt < retries:
                    time.sleep(min(1.5 * (2 ** attempt), 10))
        if last_error is not None and not rows:
            raise RuntimeError(str(last_error))
        if not rows:
            break
        collected.extend([list(item)[:6] for item in rows])
        earliest = pd.Timestamp(rows[0][0])
        if len(rows) < page_size or earliest <= start_day:
            break
        next_cursor = earliest - timedelta(days=1)
        if next_cursor >= cursor:
            break
        cursor = next_cursor

    frame = pd.DataFrame(
        collected,
        columns=["date", "open", "close", "high", "low", "volume"],
    )
    if frame.empty:
        raise ValueError("Tencent adjusted provider returned no rows")
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    for column in ["open", "high", "low", "close", "volume"]:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    frame = frame[
        (frame["date"] >= start_day)
        & (frame["date"] <= pd.Timestamp(end_date))
    ]
    frame = frame.dropna(subset=["date", "open", "high", "low", "close", "volume"])
    frame = frame[(frame["close"] > 0) & (frame["volume"] >= 0)].copy()
    if frame.empty:
        raise ValueError("Tencent adjusted provider returned no valid rows")
    frame["date"] = frame["date"].dt.strftime("%Y-%m-%d")
    frame["code"] = stock["code"]
    frame["name"] = stock["name"]
    result = frame[DATA_COLUMNS].sort_values("date").drop_duplicates("date", keep="last")
    source_ids = {
        "primary": "tencent-public-kline-forward-adjusted",
        "alternate": "tencent-public-kline-forward-adjusted-alternate-host",
        "finance-proxy": "tencent-public-kline-forward-adjusted-finance-proxy",
    }
    result.attrs["source_id"] = (
        "tencent-public-kline-qfq-request-day-series"
        if used_qfq_day_series
        else source_ids[endpoint_key]
    )
    return result


def _request_sha256(
    dataset_id, start_day, end_day, selected, adjustment_mode, base_dataset_id=""
):
    payload = {
        "datasetId": dataset_id,
        "start": start_day,
        "end": end_day,
        "adjustmentMode": adjustment_mode,
        "codes": [item["code"] for item in selected],
    }
    if base_dataset_id:
        payload["baseDatasetId"] = base_dataset_id
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _verified_base_dataset(base_dataset_dir, adjustment_mode, start_day, end_day):
    if not base_dataset_dir:
        return None
    root = Path(base_dataset_dir).resolve()
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise ValueError("base dataset manifest is missing")
    manifest = read_json(manifest_path)
    if manifest.get("manifestSha256") != manifest_sha256(manifest):
        raise ValueError("base dataset manifest hash is invalid")
    if manifest.get("adjustmentMode") != adjustment_mode:
        raise ValueError("base dataset adjustment mode does not match")
    base_start = str((manifest.get("dateRange") or {}).get("start") or "")
    base_end = str((manifest.get("dateRange") or {}).get("end") or "")
    if not base_start or not base_end:
        raise ValueError("base dataset date range is missing")
    if base_start > start_day:
        raise ValueError("base dataset starts after the requested date range")
    if base_end > end_day:
        raise ValueError("base dataset ends after the requested date range")
    artifacts = {
        str(item.get("code")): item
        for item in manifest.get("files", [])
        if item.get("code") and str(item.get("path") or "").startswith("raw/")
    }
    return {
        "root": root,
        "datasetId": str(manifest.get("datasetId") or root.name),
        "manifestSha256": manifest["manifestSha256"],
        "artifacts": artifacts,
    }


def _normalize_frame(frame, stock, start_day, end_day, strict=False):
    required = set(DATA_COLUMNS)
    if not required.issubset(frame.columns):
        raise ValueError("cached K-line file is missing required columns")
    prepared = frame[DATA_COLUMNS].copy()
    prepared["date"] = pd.to_datetime(prepared["date"], errors="coerce")
    codes = prepared["code"].map(_normal_code)
    if strict and (codes != stock["code"]).any():
        raise ValueError("cached K-line file contains another security")
    for column in ["open", "high", "low", "close", "volume"]:
        prepared[column] = pd.to_numeric(prepared[column], errors="coerce")
    prepared = prepared[
        (prepared["date"] >= pd.Timestamp(start_day))
        & (prepared["date"] <= pd.Timestamp(end_day))
    ]
    prepared = prepared.dropna(subset=["date", "open", "high", "low", "close", "volume"])
    duplicate_rows = int(prepared.duplicated("date", keep=False).sum())
    price_high = prepared[["open", "close", "low"]].max(axis=1)
    price_low = prepared[["open", "close", "high"]].min(axis=1)
    invalid_mask = (
        (prepared["close"] <= 0)
        | (prepared["open"] <= 0)
        | (prepared["high"] < price_high)
        | (prepared["low"] > price_low)
        | (prepared["volume"] < 0)
    )
    invalid_rows = int(invalid_mask.sum())
    if strict and (duplicate_rows or invalid_rows):
        raise ValueError("cached K-line file failed OHLC or duplicate checks")
    prepared = prepared.loc[~invalid_mask].sort_values("date").drop_duplicates("date", keep="last")
    if prepared.empty:
        raise ValueError("K-line file has no valid rows in the requested range")
    prepared["date"] = prepared["date"].dt.strftime("%Y-%m-%d")
    prepared["code"] = stock["code"]
    prepared["name"] = stock["name"]
    return prepared[DATA_COLUMNS], {"invalidRows": invalid_rows, "duplicateRows": duplicate_rows}


def _artifact_for(target, root, stock, frame, quality, source_id="unknown-resumed"):
    return {
        "path": target.relative_to(root).as_posix(),
        "sha256": file_sha256(target),
        "rows": int(len(frame)),
        "code": stock["code"],
        "name": stock["name"],
        "start": str(frame["date"].iloc[0]),
        "end": str(frame["date"].iloc[-1]),
        "invalidRows": int(quality.get("invalidRows", 0)),
        "duplicateRows": int(quality.get("duplicateRows", 0)),
        "sourceId": source_id,
    }


def _read_cached_artifact(target, root, stock, start_day, end_day, source_id="unknown-resumed"):
    frame, quality = _normalize_frame(
        pd.read_parquet(target), stock, start_day, end_day, strict=True
    )
    return _artifact_for(target, root, stock, frame, quality, source_id=source_id)


def _write_parquet_atomic(target, frame):
    temporary = target.with_name(
        target.name + f".tmp-{os.getpid()}-{threading.get_ident()}"
    )
    try:
        frame.to_parquet(temporary, index=False, compression="zstd")
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()


def _quality_summary(artifacts, selected_count, failure_count, resumed_files, invalid_cached_files):
    rows = sorted(int(item["rows"]) for item in artifacts)
    latest = max((str(item["end"]) for item in artifacts), default="")
    stale_cutoff = (pd.Timestamp(latest).date() - timedelta(days=10)) if latest else None
    stale = sum(
        1 for item in artifacts
        if stale_cutoff is not None and pd.Timestamp(item["end"]).date() < stale_cutoff
    )
    p10_index = max(math.ceil(len(rows) * 0.1) - 1, 0) if rows else 0
    median = rows[len(rows) // 2] if rows else 0
    return {
        "coverageRate": round(len(artifacts) / selected_count, 6) if selected_count else 0.0,
        "successfulSecurities": len(artifacts),
        "failedSecurities": int(failure_count),
        "resumedFiles": int(resumed_files),
        "invalidCachedFiles": int(invalid_cached_files),
        "minimumRowsPerSecurity": rows[0] if rows else 0,
        "p10RowsPerSecurity": rows[p10_index] if rows else 0,
        "medianRowsPerSecurity": median,
        "maximumRowsPerSecurity": rows[-1] if rows else 0,
        "staleSecurityCount": int(stale),
        "invalidRows": sum(int(item.get("invalidRows", 0)) for item in artifacts),
        "duplicateRows": sum(int(item.get("duplicateRows", 0)) for item in artifacts),
    }


def collect_dataset(
    universe_file,
    dataset_dir,
    dataset_id,
    start_date="2019-01-01",
    end_date=None,
    limit=None,
    codes=None,
    adjustment_mode="unadjusted",
    base_dataset_dir=None,
    sleep_ms=120,
    workers=3,
    emit=None,
):
    if adjustment_mode not in ("unadjusted", "forward-adjusted"):
        raise ValueError("unsupported adjustment mode")
    end_date = end_date or date.today().isoformat()
    start_day = pd.Timestamp(start_date).strftime("%Y-%m-%d")
    end_day = pd.Timestamp(end_date).strftime("%Y-%m-%d")
    if start_day > end_day:
        raise ValueError("start date must not be after end date")

    stocks = json.loads(Path(universe_file).read_text(encoding="utf-8"))
    selected, prefilter_excluded = select_universe(stocks, limit=limit, codes=codes)
    if not selected:
        raise ValueError("the selected universe is empty")

    root = Path(dataset_dir)
    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    base_dataset = _verified_base_dataset(
        base_dataset_dir, adjustment_mode, start_day, end_day
    )
    base_dataset_id = base_dataset["datasetId"] if base_dataset else ""
    request_sha256 = _request_sha256(
        dataset_id,
        start_day,
        end_day,
        selected,
        adjustment_mode,
        base_dataset_id=base_dataset_id,
    )
    manifest_path = root / "manifest.json"
    if manifest_path.exists():
        try:
            existing_manifest = read_json(manifest_path)
            same_request = (
                existing_manifest.get("requestSha256") == request_sha256
                and existing_manifest.get("manifestSha256") == manifest_sha256(existing_manifest)
                and existing_manifest.get("coverage", {}).get("failed") == 0
            )
            if same_request:
                for artifact in existing_manifest.get("files", []):
                    if str(artifact.get("path", "")).startswith("raw/"):
                        target = root / artifact["path"]
                        if not target.exists() or file_sha256(target) != artifact.get("sha256"):
                            raise ValueError("completed dataset artifact changed")
                return manifest_path, existing_manifest
        except Exception:
            pass

    state_path = root / "collection-state.json"
    state = read_json(state_path) if state_path.exists() else {}
    if state and state.get("requestSha256") not in (None, request_sha256):
        raise ValueError("dataset directory contains a different collection request")
    failures_by_code = {
        str(item.get("code")): item for item in state.get("failures", []) if item.get("code")
    }
    sources_by_code = dict(state.get("sourcesByCode") or {})
    files_by_code = {}
    resumed_files = 0
    invalid_cached_files = 0
    pending = []
    last_checkpoint = 0
    state_revision = 0
    processed_pending = 0
    current_run_failures = 0

    def persist_state(status, force=False):
        nonlocal last_checkpoint
        if not force and state_revision - last_checkpoint < 10:
            return
        write_json_atomic(state_path, {
            "schema": "webstock.quant.collection-state.v1",
            "datasetId": dataset_id,
            "requestSha256": request_sha256,
            "status": status,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "requestedDateRange": {"start": start_day, "end": end_day},
            "adjustmentMode": adjustment_mode,
            "baseDatasetId": base_dataset_id or None,
            "selectedCount": len(selected),
            "completedCodes": sorted(files_by_code),
            "failures": [failures_by_code[code] for code in sorted(failures_by_code)],
            "sourcesByCode": {code: sources_by_code[code] for code in sorted(sources_by_code)},
        })
        last_checkpoint = state_revision

    for stock in selected:
        target = raw_dir / f"{stock['code']}.parquet"
        if target.exists():
            try:
                files_by_code[stock["code"]] = _read_cached_artifact(
                    target, root, stock, start_day, end_day,
                    source_id=sources_by_code.get(stock["code"], "unknown-resumed"),
                )
                failures_by_code.pop(stock["code"], None)
                resumed_files += 1
                continue
            except Exception:
                invalid_cached_files += 1
                target.unlink(missing_ok=True)
        pending.append(stock)

    persist_state("running", force=True)
    thread_state = threading.local()
    request_gate = threading.Lock()
    next_request_at = [0.0]
    provider_lock = threading.Lock()
    sina_disabled_until = [0.0]
    eastmoney_disabled_until = [0.0]

    def pace_request():
        interval = max(int(sleep_ms or 0), 0) / 1000.0
        if interval <= 0:
            return
        with request_gate:
            delay = next_request_at[0] - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            next_request_at[0] = time.monotonic() + interval

    def fetch_public_history(stock, fetch_start, fetch_end):
        if adjustment_mode == "forward-adjusted":
            with provider_lock:
                use_eastmoney = time.monotonic() >= eastmoney_disabled_until[0]
            frame = None
            if use_eastmoney:
                try:
                    pace_request()
                    frame = fetch_eastmoney_history(
                        thread_state.session,
                        stock,
                        fetch_start,
                        fetch_end,
                        retries=0,
                        adjustment_mode=adjustment_mode,
                    )
                except Exception:
                    with provider_lock:
                        eastmoney_disabled_until[0] = time.monotonic() + 300
            if frame is None:
                pace_request()
                frame = fetch_tencent_forward_adjusted_history(
                    thread_state.session, stock, fetch_start, fetch_end, retries=1
                )
            source_id = frame.attrs.get(
                "source_id", "unknown-public-kline-forward-adjusted"
            )
            return frame, source_id
        with provider_lock:
            use_sina = time.monotonic() >= sina_disabled_until[0]
        source_id = "sina-public-kline"
        if use_sina:
            try:
                pace_request()
                frame = fetch_sina_history(
                    thread_state.session, stock, fetch_start, fetch_end, retries=0
                )
            except Exception as error:
                if "456" in str(error) or "429" in str(error):
                    with provider_lock:
                        sina_disabled_until[0] = time.monotonic() + 300
                with provider_lock:
                    use_eastmoney = time.monotonic() >= eastmoney_disabled_until[0]
                if use_eastmoney:
                    try:
                        pace_request()
                        frame = fetch_eastmoney_history(
                            thread_state.session, stock, fetch_start, fetch_end, retries=0
                        )
                        source_id = frame.attrs.get("source_id", "eastmoney-public-kline")
                    except Exception:
                        with provider_lock:
                            eastmoney_disabled_until[0] = time.monotonic() + 300
                        pace_request()
                        frame = fetch_tencent_history(
                            thread_state.session, stock, fetch_start, fetch_end
                        )
                        source_id = "tencent-public-kline"
                else:
                    pace_request()
                    frame = fetch_tencent_history(
                        thread_state.session, stock, fetch_start, fetch_end
                    )
                    source_id = "tencent-public-kline"
        else:
            with provider_lock:
                use_eastmoney = time.monotonic() >= eastmoney_disabled_until[0]
            if use_eastmoney:
                try:
                    pace_request()
                    frame = fetch_eastmoney_history(
                        thread_state.session, stock, fetch_start, fetch_end, retries=0
                    )
                    source_id = frame.attrs.get("source_id", "eastmoney-public-kline")
                except Exception:
                    with provider_lock:
                        eastmoney_disabled_until[0] = time.monotonic() + 300
                    pace_request()
                    frame = fetch_tencent_history(
                        thread_state.session, stock, fetch_start, fetch_end
                    )
                    source_id = "tencent-public-kline"
            else:
                pace_request()
                frame = fetch_tencent_history(
                    thread_state.session, stock, fetch_start, fetch_end
                )
                source_id = "tencent-public-kline"
        return frame, source_id

    def collect_one(stock):
        if not hasattr(thread_state, "session"):
            thread_state.session = requests.Session()
        base_frame = None
        base_source_id = ""
        fetch_start = start_day
        if base_dataset:
            base_artifact = base_dataset["artifacts"].get(stock["code"])
            if base_artifact:
                base_target = (base_dataset["root"] / base_artifact["path"]).resolve()
                if base_dataset["root"] not in base_target.parents:
                    raise ValueError("base dataset artifact path escapes its dataset directory")
                if not base_target.is_file() or file_sha256(base_target) != base_artifact.get("sha256"):
                    raise ValueError("base dataset artifact hash is invalid")
                base_frame, _ = _normalize_frame(
                    pd.read_parquet(base_target), stock, start_day, end_day, strict=True
                )
                base_source_id = str(base_artifact.get("sourceId") or "unknown")
                fetch_start = (
                    pd.Timestamp(base_frame["date"].iloc[-1]) + timedelta(days=1)
                ).strftime("%Y-%m-%d")

        source_id = base_source_id
        frames = [base_frame] if base_frame is not None else []
        if fetch_start <= end_day:
            update_frame, update_source_id = fetch_public_history(
                stock, fetch_start, end_day
            )
            frames.append(update_frame)
            source_id = (
                f"incremental:{base_dataset_id}+{update_source_id}"
                if base_frame is not None
                else update_source_id
            )
        if not frames:
            raise ValueError("no baseline or provider rows are available")
        frame = pd.concat(frames, ignore_index=True)
        frame, quality = _normalize_frame(frame, stock, start_day, end_day)
        target = raw_dir / f"{stock['code']}.parquet"
        _write_parquet_atomic(target, frame)
        return _artifact_for(target, root, stock, frame, quality, source_id=source_id)

    def record_result(stock, artifact=None, error=None):
        nonlocal state_revision, processed_pending, current_run_failures
        processed_pending += 1
        if artifact is not None:
            files_by_code[stock["code"]] = artifact
            sources_by_code[stock["code"]] = artifact.get("sourceId", "unknown")
            failures_by_code.pop(stock["code"], None)
        else:
            current_run_failures += 1
            failures_by_code[stock["code"]] = {
                "code": stock["code"],
                "name": stock["name"],
                "reason": str(error)[:500],
            }
        completed = resumed_files + processed_pending
        state_revision += 1
        if emit:
            emit({
                "stage": "collect",
                "current": completed,
                "total": len(selected),
                "code": stock["code"],
                "succeeded": len(files_by_code),
                "failed": current_run_failures,
                "resumed": resumed_files,
                "message": f"全市场采集 {completed}/{len(selected)}：{stock['code']} {stock['name']}",
            })
        persist_state("running")

    worker_count = min(max(int(workers or 1), 1), 8)
    try:
        if worker_count == 1:
            for stock in pending:
                try:
                    record_result(stock, artifact=collect_one(stock))
                except Exception as error:
                    record_result(stock, error=error)
        else:
            executor = ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="webstock-collect")
            futures = {executor.submit(collect_one, stock): stock for stock in pending}
            try:
                for future in as_completed(futures):
                    stock = futures[future]
                    try:
                        record_result(stock, artifact=future.result())
                    except Exception as error:
                        record_result(stock, error=error)
            except BaseException:
                executor.shutdown(wait=False, cancel_futures=True)
                raise
            else:
                executor.shutdown(wait=True)
    finally:
        persist_state("interrupted", force=True)

    files = [files_by_code[code] for code in sorted(files_by_code)]
    failures = [failures_by_code[code] for code in sorted(failures_by_code)]

    if not files:
        raise RuntimeError("the provider did not return any usable daily data")

    total_rows = sum(int(item["rows"]) for item in files)
    actual_start = min(str(item["start"]) for item in files)
    actual_end = max(str(item["end"]) for item in files)

    universe_path = root / "universe.json"
    write_json_atomic(universe_path, {
        "selected": selected,
        "failures": failures,
        "prefilterExcluded": prefilter_excluded,
    })
    files.append({
        "path": universe_path.relative_to(root).as_posix(),
        "sha256": file_sha256(universe_path),
        "rows": len(selected),
        "kind": "universe",
    })

    warnings = [
        (
            "数据来自东方财富及腾讯公开前复权日线接口，仅用于研究试跑，条款与完整性未独立验证。"
            if adjustment_mode == "forward-adjusted"
            else "数据来自新浪、东方财富及腾讯公开日线接口，仅用于研究试跑，条款与完整性未独立验证。"
        ),
        "股票池由当前 stocks.json 生成，不包含已退市股的完整点时点名单，存在幸存者偏差。",
        "ST 只按当前名称排除，未重建历史每日 ST 状态。",
    ]
    if adjustment_mode == "unadjusted":
        warnings.append("日线价格未复权，除权除息可能污染动量与收益标签。")
    else:
        warnings.append("前复权降低了公司行动造成的价格跳变，但当前成分和历史 ST 偏差仍然存在。")
    if base_dataset:
        warnings.append(
            f"本数据集基于已校验基线 {base_dataset_id} 增量生成；基线文件保持不变。"
        )
    if failures:
        warnings.append(f"{len(failures)} 只证券采集失败，已从本次数据集排除。")
    provider_counts = {}
    for artifact in files[:-1]:
        source_id = artifact.get("sourceId", "unknown")
        provider_counts[source_id] = provider_counts.get(source_id, 0) + 1
    if len(provider_counts) > 1:
        warnings.append("数据集混合多个公开来源；成交量单位和历史修订差异可能影响横截面比较。")

    if any(key.startswith("eastmoney-public-kline-http-fallback") for key in provider_counts):
        warnings.append(
            "部分东方财富公开日线在 HTTPS 连接被远端断开后使用了已声明的 HTTP 回退。"
            "文件哈希可固定采集后的内容，但这些响应的传输端身份未经过认证。"
        )
    if "tencent-public-kline-qfq-request-day-series" in provider_counts:
        warnings.append(
            "部分非北交所证券在明确请求 qfq 时仅返回 day 序列；该序列单独标记来源，"
            "不等同于已独立核验公司行动调整因子。"
        )

    manifest = {
        "schema": "webstock.quant.dataset.v1",
        "datasetId": dataset_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "requestSha256": request_sha256,
        "asOf": actual_end,
        "source": {
            "id": (
                "mixed-public-forward-adjusted-kline"
                if adjustment_mode == "forward-adjusted"
                else "mixed-public-kline"
            ),
            "name": (
                "Eastmoney and Tencent public forward-adjusted daily K-line endpoints"
                if adjustment_mode == "forward-adjusted"
                else "Sina, Eastmoney and Tencent public daily K-line endpoints"
            ),
            "accessMode": "public-http",
            "endpoint": (
                EASTMONEY_KLINE_URL
                if adjustment_mode == "forward-adjusted"
                else SINA_KLINE_URL
            ),
            "termsVerified": False,
            "providers": (
                [
                    EASTMONEY_KLINE_URL,
                    EASTMONEY_KLINE_HTTP_FALLBACK_URL,
                    TENCENT_FQ_KLINE_URL,
                    TENCENT_FQ_KLINE_ALTERNATE_URL,
                    TENCENT_FQ_KLINE_PROXY_URL,
                ]
                if adjustment_mode == "forward-adjusted"
                else [
                    SINA_KLINE_URL,
                    EASTMONEY_KLINE_URL,
                    EASTMONEY_KLINE_HTTP_FALLBACK_URL,
                    TENCENT_KLINE_URL,
                ]
            ),
            "providerCounts": provider_counts,
        },
        "universe": {
            "policy": "current-a-share-ex-st",
            "membershipMode": "current-list",
            "requestedCount": len(selected),
            "includedCount": len(files) - 1,
            "excludedCount": len(failures),
            "prefilterExcluded": prefilter_excluded,
        },
        "requestedDateRange": {"start": start_day, "end": end_day},
        "dateRange": {"start": actual_start, "end": actual_end},
        "columns": DATA_COLUMNS,
        "adjustmentMode": adjustment_mode,
        "coverage": {
            "requested": len(selected),
            "succeeded": len(files) - 1,
            "failed": len(failures),
            "rows": total_rows,
        },
        "quality": _quality_summary(
            files[:-1], len(selected), len(failures), resumed_files, invalid_cached_files
        ),
        "collection": {
            "workers": worker_count,
            "sleepMsPerWorker": max(int(sleep_ms), 0),
            "resumable": True,
            "baseDatasetId": base_dataset_id or None,
            "baseManifestSha256": (
                base_dataset["manifestSha256"] if base_dataset else None
            ),
        },
        "files": files,
        "eligibility": "exploratory_only",
        "warnings": warnings,
    }
    manifest["manifestSha256"] = manifest_sha256(manifest)
    write_json_atomic(manifest_path, manifest)
    persist_state("completed", force=True)
    if emit:
        emit({
            "stage": "collect-complete",
            "current": len(selected),
            "total": len(selected),
            "message": f"数据采集完成：{len(files) - 1}/{len(selected)} 只成功",
        })
    return manifest_path, manifest
