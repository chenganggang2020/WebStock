"""Explicit AKShare/Eastmoney daily query; retain the returned and canonical data.

Volume units follow AKShare's own stock_zh_a_hist documentation. No silent data
provider fallback, cached sample substitution, fill-forward or synthetic amount.
"""
import base64
import hashlib
import importlib.metadata
from pathlib import Path
import tempfile
from datetime import date, datetime, timezone, timedelta
import re
import numpy as np
import pandas as pd
from worker import load_bars, table

DOC = "https://akshare.akfamily.xyz/data/stock/stock.html"
ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
REQUIRED = ["日期", "股票代码", "开盘", "收盘", "最高", "最低", "成交量", "成交额"]


def query_dates(p, today=None):
    if not re.fullmatch(r"[0-9]{6}",p["symbol"]):raise ValueError("需要六位A股代码")
    start=date.fromisoformat(p["startDate"]);end=date.fromisoformat(p["endDate"])
    today=today or datetime.now(timezone(timedelta(hours=8))).date()
    if start>end or start<date(1990,1,1):raise ValueError("日期范围无效")
    if end>=today:raise ValueError("本功能只取已结束的历史日期；结束日期必须早于上海当地今天")
    if p["adjustment"] not in ("unadjusted","forward","backward"):raise ValueError("价格口径无效")
    return start,end


def normalize(raw,p,acquired_at):
    start,end=query_dates(p)
    if raw.empty or not set(REQUIRED)<=set(raw.columns):raise ValueError("数据源未返回完整日线；不使用样本替代")
    if not raw["股票代码"].astype(str).str.zfill(6).eq(p["symbol"]).all():raise ValueError("返回股票代码与查询不符")
    # Preserve source order and reject duplicate/out-of-range rows, rather than
    # silently dropping or repairing them and hiding provider/schema failures.
    days=pd.to_datetime(raw["日期"],errors="raise")
    if days.isna().any() or not days.is_monotonic_increasing or days.duplicated().any():raise ValueError("返回日期有缺失、乱序或重复")
    if (days.dt.date<start).any() or (days.dt.date>end).any():raise ValueError("数据源返回范围外日期")
    frame=pd.DataFrame({"time":days.dt.strftime("%Y-%m-%d"),"symbol":p["symbol"]})
    for dest,source in (("open","开盘"),("high","最高"),("low","最低"),("close","收盘"),("volume","成交量"),("amount","成交额")):
        frame[dest]=pd.to_numeric(raw[source],errors="raise")
    if not np.isfinite(frame[["volume","amount"]].to_numpy()).all() or (frame.amount<0).any():raise ValueError("成交量或成交额缺失、无穷或为负")
    frame["volume"]=frame.volume*100  # source lots -> shares (AKShare docs).
    frame["priceadjustment"]=p["adjustment"];frame["volumeunit"]="share";frame["amountunit"]="CNY"
    frame["timezone"]="Asia/Shanghai";frame["source"]="AKShare/stock_zh_a_hist/Eastmoney"
    frame["acquiredatutc"]=acquired_at;frame["isclosed"]=True
    blob=frame.to_csv(index=False,lineterminator="\n").encode("utf-8-sig")
    # Reuse the same strict input contract used by downstream calculations.
    with tempfile.TemporaryDirectory(prefix="webstock-akshare-validate-") as folder:
        path=Path(folder)/"returned.csv";path.write_bytes(blob);load_bars(path)
    return frame,blob


def fetch(p):
    import akshare as ak
    start,end=query_dates(p)
    raw=ak.stock_zh_a_hist(symbol=p["symbol"],period="daily",start_date=start.strftime("%Y%m%d"),
                         end_date=end.strftime("%Y%m%d"),adjust={"unadjusted":"","forward":"qfq","backward":"hfq"}[p["adjustment"]],timeout=30)
    acquired=datetime.now(timezone.utc).isoformat()
    frame,blob=normalize(raw,p,acquired)
    source=raw.copy();source["日期"]=pd.to_datetime(source["日期"]).dt.strftime("%Y-%m-%d")
    source_blob=source.to_csv(index=False,lineterminator="\n").encode("utf-8")
    return {"kind":"data","engineVersion":importlib.metadata.version("akshare"),
        "formulaVersion":"akshare-eastmoney-daily-snapshot-v1","bars":len(frame),
        "tables":[table("market-data",frame),table("provider-return",source)],
        "generatedData":{"name":p["symbol"]+"-"+start.isoformat()+"-"+end.isoformat()+".csv",
            "mediaType":"text/csv","sha256":hashlib.sha256(blob).hexdigest(),"base64":base64.b64encode(blob).decode("ascii")},
        "provenance":{"provider":"Eastmoney","libraryFunction":"akshare.stock_zh_a_hist","endpoint":ENDPOINT,
            "documentation":DOC,"acquiredAtUtc":acquired,"requestedStart":start.isoformat(),"requestedEnd":end.isoformat(),
            "firstReturnedDate":frame.time.iloc[0],"lastReturnedDate":frame.time.iloc[-1],
            "sourceVolumeUnit":"lot of 100 shares","outputVolumeUnit":"share","amountUnit":"CNY",
            "adjustment":p["adjustment"],"sourceFrameCsvSha256":hashlib.sha256(source_blob).hexdigest(),
            "sourceFrameHashEncoding":"UTF-8 CSV, LF, no index; returned DataFrame, not raw HTTP body",
            "pointInTimeDataset":False},
        "warnings":["本次保存的是采集时取得的数据快照；不证明历史当时可见，也不证明交易所最终数据完全无误。",
            "成交量按该接口官方文档从手乘100转为股，成交额保留元；两张表保留转换前后数据。",
            "接口缺数、停牌或上市日期不会自动补齐；请求区间与实际返回区间分别保留。",
            "复权序列可能随公司行动修订；不复权序列含除权缺口。股票回测仍需另行处理公司行动和交易制度。"]}
