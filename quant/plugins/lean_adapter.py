"""Run the original local LEAN .NET launcher against a frozen custom daily feed."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from xml.sax.saxutils import escape
import pandas as pd
from worker import table


def run_process(args,cwd,log,timeout):
    with log.open("wb") as stream:
        result=subprocess.run(args,cwd=cwd,stdout=stream,stderr=subprocess.STDOUT,timeout=timeout,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0)
    if result.returncode:
        raise RuntimeError("LEAN process failed: "+log.read_text(encoding="utf-8",errors="replace")[-5000:])


def calculate(frame,p):
    if p["fast"]>=p["slow"]:raise ValueError("Fast period must be shorter than slow")
    if not p.get("engineDirectory"):raise ValueError("请选择已构建的LEAN目录（其中应有Launcher/bin/Release及Data）")
    engine=Path(p["engineDirectory"]).resolve();binaries=engine/"Launcher/bin/Release";data=engine/"Data"
    launcher=binaries/"QuantConnect.Lean.Launcher.dll"
    if not launcher.is_file() or not (data/"market-hours/market-hours-database.json").is_file():
        raise ValueError("LEAN目录缺少Release构建或市场基础文件")
    dotnet=shutil.which("dotnet")
    if not dotnet:raise ValueError("此运行环境需要.NET 10 SDK及已构建的LEAN")
    days=pd.to_datetime(frame.time)
    if days.dt.normalize().duplicated().any():raise ValueError("此LEAN功能每个日期只接受一根日线")
    if len(frame)<=p["slow"]:raise ValueError("历史长度不足慢速均线")
    source=Path(__file__).parent/"lean/WebStockFrozenAlgorithm.cs"
    with tempfile.TemporaryDirectory(prefix="webstock-lean-") as tmp:
        root=Path(tmp);project=root/"algorithm";project.mkdir();output=root/"results";output.mkdir()
        shutil.copyfile(source,project/source.name)
        references="".join('<Reference Include="'+n+'"><HintPath>'+escape(str(binaries/(n+'.dll')))+'</HintPath><Private>false</Private></Reference>'
            for n in ("QuantConnect.Algorithm","QuantConnect.Common","QuantConnect.Configuration","QuantConnect.Indicators","QuantConnect.Lean.Engine","NodaTime","Newtonsoft.Json","Python.Runtime"))
        (project/"WebStockLean.csproj").write_text('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><AssemblyName>WebStockLean</AssemblyName><EnableDefaultCompileItems>true</EnableDefaultCompileItems></PropertyGroup><ItemGroup>'+references+'</ItemGroup></Project>',encoding="utf-8")
        run_process([dotnet,"build",str(project/"WebStockLean.csproj"),"-c","Release","--nologo","--verbosity","quiet"],root,root/"build.log",180)
        dll=project/"bin/Release/net10.0/WebStockLean.dll"
        bars=frame[["time","open","high","low","close","volume"]].copy();bars["time"]=days.dt.strftime("%Y-%m-%d")
        feed=root/"input.csv";bars.to_csv(feed,index=False,lineterminator="\n")
        adapter_output=root/"adapter-result.json"
        config={"environment":"webstock-local","algorithm-type-name":"WebStockFrozenAlgorithm","algorithm-language":"CSharp",
            "algorithm-location":str(dll),"plugin-directory":str(dll.parent),"data-folder":str(data),"webstock-input":str(feed),"live-mode":False,
            "debugging":False,"close-automatically":True,"job-user-id":"0","api-access-token":"",
            "job-organization-id":"","force-exchange-always-open":True,
            "results-destination-folder":str(output),"log-file":str(root/"engine.log"),"object-store-root":str(root/"storage"),
            "log-handler":"QuantConnect.Logging.CompositeLogHandler","messaging-handler":"QuantConnect.Messaging.Messaging",
            "job-queue-handler":"QuantConnect.Queues.JobQueue","api-handler":"QuantConnect.Api.Api",
            "map-file-provider":"QuantConnect.Data.Auxiliary.LocalDiskMapFileProvider",
            "factor-file-provider":"QuantConnect.Data.Auxiliary.LocalDiskFactorFileProvider",
            "data-provider":"QuantConnect.Lean.Engine.DataFeeds.DefaultDataProvider","data-channel-provider":"DataChannelProvider",
            "object-store":"QuantConnect.Lean.Engine.Storage.LocalObjectStore","data-aggregator":"QuantConnect.Lean.Engine.DataFeeds.AggregationManager",
            "parameters":{k:str(p[k]) for k in ("fast","slow","quantity","capital","feeBps")},
            "environments":{"webstock-local":{"live-mode":False,"setup-handler":"QuantConnect.Lean.Engine.Setup.BacktestingSetupHandler",
                "result-handler":"WebStockResultHandler","data-feed-handler":"QuantConnect.Lean.Engine.DataFeeds.FileSystemDataFeed",
                "real-time-handler":"QuantConnect.Lean.Engine.RealTime.BacktestingRealTimeHandler",
                "history-provider":["QuantConnect.Lean.Engine.HistoricalData.SubscriptionDataReaderHistoryProvider"],
                "transaction-handler":"QuantConnect.Lean.Engine.TransactionHandlers.BacktestingTransactionHandler"}}}
        config["parameters"].update(start=bars.time.iloc[0],end=bars.time.iloc[-1],adapterOutput=str(adapter_output))
        path=root/"config.json";path.write_text(json.dumps(config),encoding="utf-8")
        run_process([dotnet,str(launcher),"--config",str(path)],binaries,root/"launch.log",180)
        result=json.loads(adapter_output.read_text(encoding="utf-8"))
        equity=pd.DataFrame(result["equity"],columns=["time","observedAtUtc","equity","cash","position","close"])
        if equity.time.tolist()!=bars.time.tolist():raise ValueError("LEAN did not consume every frozen daily bar exactly once")
        orders=pd.DataFrame(result["orders"],columns=["time","eventAtUtc","orderId","status","quantity","price","fee","currency","signalTag","message"])
        signals=pd.DataFrame(result["signals"],columns=["time","observedAtUtc","side","fast","slow"])
        return {"kind":"backtest","engineVersion":result["engineVersion"],"formulaVersion":"lean-lagged-sma-cross-close-v1",
            "tables":[table("equity",equity),table("orders",orders),table("signals",signals)],
            "engineAssemblySha256":{n:hashlib.sha256((binaries/n).read_bytes()).hexdigest() for n in
                ("QuantConnect.Lean.Launcher.dll","QuantConnect.Lean.Engine.dll","QuantConnect.Algorithm.dll","QuantConnect.Indicators.dll")},
            "adapterSourceSha256":hashlib.sha256(source.read_bytes()).hexdigest(),
            "executionPolicy":{"input":"custom daily BaseData, no fill-forward","signal":"completed bar SMA cross","execution":"submit at next input daily close",
                "calendar":"virtual always open; only supplied bars are consumed","fee":"notional * feeBps / 10000, no minimum",
                "currency":"USD virtual accounting unit; no FX conversion of input values","leverage":1,"benchmark":"constant 1 technical reference"},
            "resultHandler":"Original BacktestingResultHandler subclass; optional heuristic ResultsAnalysis disabled, accounting and statistics unchanged",
            "warnings":["原版LEAN本地.NET引擎，使用自定义日线数据；不会联网取行情或下实盘订单。",
                "日线信息在下一日00:00虚拟UTC可知，上一根信号在下一输入根收盘提交；结果分别记录输入日期和观察时间。",
                "通用虚拟证券账户，不代表A股交易日历、涨跌停、T+1、税费或公司行动已实现。",
                "相同数值以USD记账仅为引擎账户单位，不进行人民币兑美元换算；技术基准不是市场收益基准。"]}
