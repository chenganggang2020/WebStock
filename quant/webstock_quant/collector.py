import json
import math
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from .manifest import file_sha256, manifest_sha256, write_json_atomic


SINA_KLINE_URL = (
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/"
    "CN_MarketData.getKLineData"
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
    return ("sh" if re.match(r"^[569]", code) else "sz") + code


def _data_length(start_date, end_date):
    start = pd.Timestamp(start_date)
    end = pd.Timestamp(end_date)
    calendar_days = max((end - start).days, 1)
    return min(max(math.ceil(calendar_days * 250 / 365) + 80, 120), 10000)


def fetch_sina_history(session, stock, start_date, end_date, retries=2):
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
                time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(str(last_error))


def collect_dataset(
    universe_file,
    dataset_dir,
    dataset_id,
    start_date="2019-01-01",
    end_date=None,
    limit=None,
    codes=None,
    sleep_ms=120,
    emit=None,
):
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
    failures = []
    files = []
    total_rows = 0
    actual_start = None
    actual_end = None
    session = requests.Session()

    for index, stock in enumerate(selected, start=1):
        if emit:
            emit({
                "stage": "collect",
                "current": index,
                "total": len(selected),
                "code": stock["code"],
                "message": f"正在采集 {stock['code']} {stock['name']}",
            })
        try:
            frame = fetch_sina_history(session, stock, start_day, end_day)
            target = raw_dir / f"{stock['code']}.parquet"
            frame.to_parquet(target, index=False, compression="zstd")
            row_start = frame["date"].iloc[0]
            row_end = frame["date"].iloc[-1]
            actual_start = row_start if actual_start is None else min(actual_start, row_start)
            actual_end = row_end if actual_end is None else max(actual_end, row_end)
            total_rows += len(frame)
            files.append({
                "path": target.relative_to(root).as_posix(),
                "sha256": file_sha256(target),
                "rows": int(len(frame)),
                "code": stock["code"],
                "name": stock["name"],
                "start": row_start,
                "end": row_end,
            })
        except Exception as error:
            failures.append({"code": stock["code"], "name": stock["name"], "reason": str(error)[:500]})
        if sleep_ms:
            time.sleep(max(int(sleep_ms), 0) / 1000.0)

    if not files:
        raise RuntimeError("the provider did not return any usable daily data")

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
        "数据来自 WebStock 已使用的公开日线接口，仅用于研究试跑，条款与完整性未独立验证。",
        "股票池由当前 stocks.json 生成，不包含已退市股的完整点时点名单，存在幸存者偏差。",
        "ST 只按当前名称排除，未重建历史每日 ST 状态。",
        "日线价格未复权，除权除息可能污染动量与收益标签。",
    ]
    if failures:
        warnings.append(f"{len(failures)} 只证券采集失败，已从本次数据集排除。")

    manifest = {
        "schema": "webstock.quant.dataset.v1",
        "datasetId": dataset_id,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "asOf": actual_end,
        "source": {
            "id": "sina-public-kline",
            "name": "Sina public daily K-line endpoint",
            "accessMode": "public-http",
            "endpoint": SINA_KLINE_URL,
            "termsVerified": False,
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
        "adjustmentMode": "unadjusted",
        "coverage": {
            "requested": len(selected),
            "succeeded": len(files) - 1,
            "failed": len(failures),
            "rows": total_rows,
        },
        "files": files,
        "eligibility": "exploratory_only",
        "warnings": warnings,
    }
    manifest["manifestSha256"] = manifest_sha256(manifest)
    manifest_path = root / "manifest.json"
    write_json_atomic(manifest_path, manifest)
    if emit:
        emit({
            "stage": "collect-complete",
            "current": len(selected),
            "total": len(selected),
            "message": f"数据采集完成：{len(files) - 1}/{len(selected)} 只成功",
        })
    return manifest_path, manifest
