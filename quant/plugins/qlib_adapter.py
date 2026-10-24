"""Qlib's original Alpha158 expressions evaluated on a private frozen provider."""
import importlib.metadata
from pathlib import Path
import tempfile
import numpy as np
import pandas as pd
from worker import table


def calculate(frame):
    import qlib
    from qlib.config import REG_CN
    from qlib.data import D
    from qlib.contrib.data.loader import Alpha158DL
    from qlib.data.storage.file_storage import FileFeatureStorage
    dates=pd.to_datetime(frame.time)
    if dates.dt.normalize().duplicated().any():raise ValueError("Alpha158 adapter requires one completed bar per day")
    if "vwap" in frame:
        frame=frame.copy();frame["vwap"]=pd.to_numeric(frame.vwap,errors="raise")
        known=frame.vwap.dropna()
        if not np.isfinite(known).all() or (known<=0).any():raise ValueError("Provided VWAP must be positive and finite or missing")
    with tempfile.TemporaryDirectory(prefix="webstock-qlib-") as temporary:
        root=Path(temporary)
        for folder in ("calendars","instruments","features/input"):(root/folder).mkdir(parents=True,exist_ok=True)
        day_strings=dates.dt.strftime("%Y-%m-%d")
        (root/"calendars/day.txt").write_text("\n".join(day_strings)+"\n",encoding="utf-8")
        (root/"instruments/all.txt").write_text("INPUT\t"+day_strings.iloc[0]+"\t"+day_strings.iloc[-1]+"\n",encoding="utf-8")
        qlib.init(provider_uri=str(root),region=REG_CN,kernels=1,expression_cache=None,dataset_cache=None,
            exp_manager={"class":"MLflowExpManager","module_path":"qlib.workflow.expm", "kwargs":{
                "uri":"sqlite:///"+(root/"tracking.sqlite").as_posix(),"default_exp_name":"plugin-feature-calculation"}})
        # Original storage implementation controls the binary layout and float32 conversion.
        for field in ("open","high","low","close","volume","vwap"):
            values=frame[field].to_numpy() if field in frame else np.full(len(frame),np.nan)
            FileFeatureStorage("INPUT",field,"day",provider_uri=str(root)).write(values,index=0)
        fields,names=Alpha158DL.get_feature_config()
        output=D.features(["INPUT"],fields,start_time=day_strings.iloc[0],end_time=day_strings.iloc[-1],freq="day",disk_cache=0)
        output.columns=names
        output=output.reset_index(level="instrument",drop=True).reindex(pd.DatetimeIndex(day_strings))
        result_tables=[]
        for start in range(0,len(names),40):
            part=output.iloc[:,start:start+40].reset_index(drop=True)
            part.insert(0,"time",frame.time.to_numpy())
            result_tables.append(table("features-"+str(start//40+1),part))
        definitions=pd.DataFrame({"feature":names,"expression":fields,"nonMissingRows":output.notna().sum().to_numpy()})
        result_tables.append(table("feature-definitions",definitions))
        return {"kind":"indicator","engineVersion":importlib.metadata.version("pyqlib"),
            "formulaVersion":"qlib-alpha158-raw-no-label-v1","tables":result_tables,"featureCount":len(names),
            "missingFeatures":list(output.columns[output.isna().all()]),
            "warnings":["调用Qlib原版Alpha158表达式，仅生成原始特征；未训练模型、标准化、填补缺失或生成未来标签。",
                "若输入没有真实vwap列，VWAP0保持缺失；不以典型价格或零值冒充。",
                "临时交易日历仅含输入数据日期，不推断停牌和缺失交易日；原版二进制存储使用float32。",
                "Alpha158的BETA字段是价格回归斜率除以收盘价，不是个股相对市场的收益beta。"]}
