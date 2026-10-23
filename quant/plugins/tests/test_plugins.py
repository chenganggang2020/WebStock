"""Numerical, temporal and input-contract checks for the shipped adapters."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

import numpy as np
import pandas as pd

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from core_indicators import calculate
from worker import compute, load_bars, validate_parameters


def fixture(n=400):
    rng=np.random.default_rng(7291)
    close=np.exp(np.log(100)+np.cumsum(rng.normal(0,.012,n)))
    opening=close*(1+rng.normal(0,.004,n))
    return pd.DataFrame({"time":pd.date_range("2020-01-01",periods=n).astype(str),"open":opening,
        "high":np.maximum(close,opening)+.7,"low":np.minimum(close,opening)-.7,"close":close,
        "volume":rng.integers(100,10000,n).astype(float),"amount":close*rng.integers(100,10000,n),
        "volumeunit":"share","amountunit":"CNY","timezone":"Asia/Shanghai"})


class PluginTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package_root=Path(sys.argv_package_root)
        cls.manifests=[json.loads(p.read_text(encoding="utf-8"))["manifest"] for p in cls.package_root.glob("*.wspkg")]
        cls.bars=fixture()

    def test_all_talib_functions_accept_declared_defaults(self):
        manifest=next(m for m in self.manifests if m["id"]=="org.webstock.talib")
        import talib
        self.assertEqual(len(manifest["operations"]),len(talib.get_functions()))
        for operation in manifest["operations"]:
            with self.subTest(operation=operation["id"]):
                result=compute(manifest,operation,self.bars,validate_parameters(operation,{}))
                self.assertEqual(len(result["tables"][0]["rows"]),len(self.bars))
                self.assertEqual(result["formulaVersion"],operation["formulaVersion"])
                self.assertTrue(result["kernelVersion"].startswith("TA-Lib/"))

    def test_ohlc_volatility_flat_and_overnight_gap(self):
        bars=fixture(5)
        for col in ("open","high","low","close"):bars[col]=[10.,10.,20.,20.,20.]
        out,_=calculate("ohlc-volatility",bars,{"period":2,"annualBars":1})
        # Every individual session is flat; only the observed overnight jump
        # contributes to YZ's sample variance, not the intraday estimators.
        np.testing.assert_allclose(out[["parkinson","garmanKlass","rogersSatchell"]].iloc[1:],0)
        np.testing.assert_allclose(out.yangZhang.iloc[2:4],np.log(2)/np.sqrt(2))
        self.assertTrue(out.yangZhang.iloc[:2].isna().all());self.assertEqual(out.yangZhang.iloc[4],0)
        bars=fixture(4);bars["open"]=10.;bars["close"]=10.;bars["high"]=20.;bars["low"]=5.
        out,_=calculate("ohlc-volatility",bars,{"period":2,"annualBars":1})
        self.assertAlmostEqual(out.parkinson.iloc[-1],np.sqrt(np.log(2)))
        self.assertAlmostEqual(out.garmanKlass.iloc[-1],np.sqrt(2)*np.log(2))
        self.assertAlmostEqual(out.rogersSatchell.iloc[-1],np.sqrt(2)*np.log(2))

    def test_actual_vwap_resets_and_refuses_unknown_units(self):
        b=fixture(3);b["time"]=["2020-01-01 10:00:00","2020-01-01 11:00:00","2020-01-02 10:00:00"]
        b["volume"]=100.;b["amount"]=[1000.,2000.,3000.]
        out,_=calculate("vwap-actual-day",b,{})
        np.testing.assert_allclose(out.vwap,[10,15,30])
        out,_=calculate("vwap-actual-anchor",b,{"anchorDate":"2020-01-01"})
        np.testing.assert_allclose(out.vwap,[10,15,20])
        out,_=calculate("vwap-actual-anchor",b,{"anchorDate":"2020-01-02"})
        np.testing.assert_allclose(out.vwap,[np.nan,np.nan,30],equal_nan=True)
        with self.assertRaises(ValueError):calculate("vwap-actual-day",b.drop(columns="amount"),{})
        b["volumeunit"]="lot"
        with self.assertRaises(ValueError):calculate("vwap-actual-day",b,{})
        b["volumeunit"]="share";b.loc[0,"volume"]=0
        with self.assertRaises(ValueError):calculate("vwap-actual-day",b,{})

    def test_supertrend_hand_calculated_state_changes(self):
        bars=fixture(6);bars["close"]=[10,10,13,12,7,8];bars["open"]=bars.close
        bars["high"]=bars.close+1;bars["low"]=bars.close-1
        out,_=calculate("supertrend",bars,{"period":2,"multiple":1.})
        np.testing.assert_allclose(out.supertrend,[np.nan,12,10,10,11.25,11.125],equal_nan=True)
        np.testing.assert_allclose(out.direction,[np.nan,-1,1,1,-1,-1],equal_nan=True)

    def test_displaced_indicators_use_information_time(self):
        bars=fixture(12)
        out,_=calculate("ichimoku",bars,{"conversion":2,"base":3,"span":4,"displacement":2})
        np.testing.assert_allclose(out.cloudAAtCurrentBar,out.senkouAComputedNow.shift(2),equal_nan=True)
        np.testing.assert_allclose(out.chikouValueKnownNow,bars.close)
        dpo,_=calculate("dpo",bars,{"period":4})
        self.assertAlmostEqual(dpo.dpoKnownNow.iloc[5],bars.close.iloc[2]-bars.close.iloc[2:6].mean())

    def test_flat_volume_conventions_and_actual_adv(self):
        bars=fixture(12);bars[["open","close"]]=100.;bars["high"]=101.;bars["low"]=99.;bars["volume"]=100.
        out,_=calculate("brar-cr-vr-psy",bars,{"period":3})
        for key in ("ar","br","cr","vr"):self.assertAlmostEqual(out[key].iloc[-1],100.)
        self.assertEqual(out.psy.iloc[-1],0.)
        amount,_=calculate("amount-adv",bars,{"period":3})
        self.assertAlmostEqual(amount.priorAmountADV.iloc[4],bars.amount.iloc[1:4].mean())
        with self.assertRaises(ValueError):calculate("amount-adv",bars.drop(columns="amount"),{"period":3})

    def test_emv_volume_scale_and_zero_volume(self):
        bars=fixture(12)
        a,_=calculate("emv",bars,{"period":3,"volumeScale":100.})
        b,_=calculate("emv",bars.assign(volume=bars.volume*10),{"period":3,"volumeScale":100.})
        np.testing.assert_allclose(a.emv/10,b.emv,equal_nan=True)
        z,_=calculate("emv",bars.assign(volume=0.),{"period":3,"volumeScale":100.})
        self.assertTrue(z.emv.isna().all())

    def test_every_formula_is_prefix_invariant(self):
        # Future data cannot change already-computed historical indicator values.
        for manifest in self.manifests:
            if manifest["id"] not in ("org.webstock.talib","org.webstock.core-indicators"):continue
            for operation in manifest["operations"]:
                with self.subTest(plugin=manifest["id"],operation=operation["id"]):
                    params=validate_parameters(operation,{})
                    full=compute(manifest,operation,self.bars,params)["tables"][0]["rows"]
                    prefix=compute(manifest,operation,self.bars.iloc[:250].copy(),params)["tables"][0]["rows"]
                    np.testing.assert_allclose(np.array([r[1:] for r in full[:250]],dtype=float),
                        np.array([r[1:] for r in prefix],dtype=float),rtol=1e-10,atol=1e-10,equal_nan=True)

    def test_prior_boundaries_and_zero_volume(self):
        bars=fixture(6);bars["high"]=[1,2,3,4,100,6];bars["low"]=[0,1,2,3,4,5];bars["volume"]=[10,20,30,40,1000,60]
        out,_=calculate("donchian-prior",bars,{"period":3})
        self.assertEqual(out.priorHigh.iloc[4],4)
        out,_=calculate("rvol",bars,{"period":3})
        self.assertAlmostEqual(out.rvol.iloc[4],1000/30)
        bars["volume"]=0
        out,_=calculate("rvol",bars,{"period":3})
        self.assertTrue(out.rvol.isna().all())

    def test_rsi_versions_are_not_silently_equated(self):
        import talib
        out,_=calculate("rsi-rolling",self.bars,{"period":14})
        self.assertGreater(np.nanmax(np.abs(out["rsi-rolling"]-talib.RSI(self.bars.close.to_numpy(),14))),1)

    def test_input_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"input.csv"
            for mutate in [lambda b:b.iloc[::-1],lambda b:pd.concat([b,b.iloc[:1]]),
                           lambda b:b.assign(close=np.nan),lambda b:b.assign(high=b.low-1),
                           lambda b:b.assign(isclosed=False),lambda b:b.assign(symbol=["A","B"]*(len(b)//2))]:
                with self.subTest(mutate=mutate):
                    mutate(self.bars.copy()).to_csv(path,index=False)
                    with self.assertRaises(ValueError):load_bars(path)
            self.bars.to_csv(path,index=False);self.assertEqual(len(load_bars(path)),len(self.bars))
            path.write_text("time,open,high,low,close,volume,close\n2024-01-01,1,2,1,1,10,1\n",encoding="utf-8")
            with self.assertRaisesRegex(ValueError,"Duplicate"):load_bars(path)

    def test_missing_actual_amount_not_estimated(self):
        with self.assertRaisesRegex(ValueError,"actual amount"):
            calculate("amihud",self.bars.drop(columns="amount"),{"period":20})


if __name__=="__main__":
    sys.argv_package_root=sys.argv.pop(1)
    unittest.main(verbosity=2)
