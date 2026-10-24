"""Data-contract tests without network; use --live for a real provider request."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import unittest
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from akshare_adapter import normalize, query_dates, fetch

PARAMS=dict(symbol="000001",startDate="2020-01-01",endDate="2020-12-31",adjustment="unadjusted")


class DataTests(unittest.TestCase):
    def raw(self):
        return pd.DataFrame({"日期":["2020-01-02","2020-01-03"],"股票代码":["000001","000001"],
            "开盘":[10.,11.],"收盘":[11.,10.5],"最高":[12.,12.],"最低":[9.,10.],"成交量":[10.,20.],"成交额":[10500.,21000.]})

    def test_units_dates_and_provenance_retained(self):
        raw=self.raw();out,blob=normalize(raw,PARAMS,"2026-10-24T00:00:00Z")
        self.assertEqual(out.volume.tolist(),[1000.,2000.]);self.assertEqual(out.amount.tolist(),raw["成交额"].tolist())
        self.assertTrue(out.symbol.eq("000001").all());self.assertTrue(out.acquiredatutc.eq("2026-10-24T00:00:00Z").all())
        self.assertTrue(blob.startswith(b"\xef\xbb\xbf"));self.assertIn(b"000001",blob)

    def test_no_duplicate_or_missing_price_repair(self):
        for col,value in [("日期","2020-01-02"),("收盘",float("nan")),("成交额",-1),("股票代码","600000"),("日期","2021-01-01")]:
            with self.subTest(column=col,value=value):
                raw=self.raw();raw.loc[1,col]=value
                with self.assertRaises(ValueError):normalize(raw,PARAMS,"test")
        with self.assertRaises(ValueError):normalize(pd.DataFrame(),PARAMS,"test")

    def test_future_or_reversed_query_rejected(self):
        from datetime import date
        for overrides in ({"endDate":"2026-10-24"},{"startDate":"2021-01-01"},{"symbol":"1"},{"adjustment":"auto"}):
            with self.subTest(overrides=overrides):
                with self.assertRaises(ValueError):query_dates({**PARAMS,**overrides},today=date(2026,10,24))


if __name__=="__main__":
    if "--live" in sys.argv:
        result=fetch(PARAMS);artifact=result["generatedData"]
        assert hashlib.sha256(base64.b64decode(artifact["base64"],validate=True)).hexdigest()==artifact["sha256"]
        assert result["bars"]>100 and result["provenance"]["pointInTimeDataset"] is False
        print(json.dumps({"bars":result["bars"],"provenance":result["provenance"],"csvSha256":artifact["sha256"]},ensure_ascii=True))
    else:unittest.main()
