"""Hand calculations, prefix invariance and actual event input boundary tests."""
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from event_contract import load_events
from event_research import calculate


def fixture(n=240):
    rows = []
    for i in range(n):
        stamp = pd.Timestamp("2020-01-02T09:30:00+08:00") + pd.Timedelta(seconds=i)
        bid = round(10+(i//16)*.01, 2); ask = round(bid+.02, 2)
        r = dict(time=(stamp+pd.Timedelta(milliseconds=1)).isoformat(), eventtime=stamp.isoformat(),
                 sequence=i+100, session="2020-01-02", symbol="000001", source="synthetic-test-generator",
                 coverage="events-complete", currency="CNY", volumeunit="share", pricebasis="raw", datasetkind="synthetic-test")
        if i%2 == 0:
            r.update(eventtype="quote", bidprice1=bid, askprice1=ask, bidsize1=100+i, asksize1=200-i//2,
                     bidprice2=round(bid-.01,2), askprice2=round(ask+.01,2), bidsize2=300+i, asksize2=400+i)
        else:
            side = "unknown" if i%31 == 0 else "buy" if i%3 == 0 else "sell"
            r.update(eventtype="trade", price=ask if side=="buy" else bid, size=10+i,
                     aggressor=side, sidebasis="unknown" if side=="unknown" else "exchange-provided")
        rows.append(r)
    return pd.DataFrame(rows)


def validated(b):
    with tempfile.TemporaryDirectory() as folder:
        p=Path(folder)/"events.csv"; b.to_csv(p,index=False); return load_events(p)


def frame(r, i=0):
    t=r["tables"][i]; return pd.DataFrame(t["rows"], columns=t["columns"])


class EventTests(unittest.TestCase):
    def test_timestamp_sequence_and_quote_contract(self):
        raw=fixture()
        mutations=[lambda x:x.assign(time="2010-01-01T00:00:00Z"),lambda x:x.assign(time="2020-01-02 01:30:00"),
                   lambda x:x.assign(sequence=1),lambda x:x.drop(index=3),lambda x:x.assign(pricebasis="forward"),
                   lambda x:x.assign(volumeunit="lot"),lambda x:x.assign(source=""),
                   lambda x:x.assign(askprice1=1),lambda x:x.assign(bidsize2=0),lambda x:x.assign(bidprice2=11),
                   lambda x:x.assign(aggressor="unknown",sidebasis="exchange-provided")]
        for change in mutations:
            with self.subTest(change=change),self.assertRaises(ValueError):validated(change(raw.copy()))
        b=validated(raw); self.assertEqual(b.symbol.iloc[0],"000001");self.assertEqual(b.attrs['depthLevels'],2)
        with self.assertRaises(ValueError):calculate("quote-liquidity",b,{"depth":3})
        sampled=validated(raw.drop(index=3).assign(coverage="sampled"))
        with self.assertRaises(ValueError):calculate("order-flow-imbalance",sampled,{"period":2})

    def test_forward_event_outputs_preserve_prefix(self):
        b=validated(fixture()); prefix=b.iloc[:120].copy()
        for name,p in [("quote-liquidity",{"depth":2}),("queue-imbalance",{"depth":2}),
                       ("trade-delta",{}),("order-flow-imbalance",{"period":4})]:
            a=frame(calculate(name,b,p));c=frame(calculate(name,prefix,p))
            a=a[pd.to_datetime(a.time,utc=True)<=prefix.time.max()].reset_index(drop=True)
            pd.testing.assert_frame_equal(a,c,check_dtype=False,rtol=1e-12,atol=1e-12)

    def test_quote_liquidity_and_queue_hand_values(self):
        b=validated(fixture());a=frame(calculate("quote-liquidity",b,{"depth":2})).iloc[0]
        self.assertAlmostEqual(a.spread,.02);self.assertAlmostEqual(a.spreadBps,10000*.02/10.01)
        self.assertEqual(a.bidDepthShares,400);self.assertEqual(a.askDepthShares,600)
        self.assertAlmostEqual(a.bidDepthNotional,10*100+9.99*300)
        q=frame(calculate("queue-imbalance",b,{"depth":2})).iloc[0]
        self.assertAlmostEqual(q.bestQueueImbalance,-1/3);self.assertAlmostEqual(q.depthImbalance,-.2)
        self.assertAlmostEqual(q.sizeWeightedMidPrice,(10.02*100+10*200)/300)

    def test_ofi_hand_quote_changes_and_session_resets(self):
        raw=fixture(6).copy(); raw['eventtype']='quote'
        quotes=[(10,11,100,200),(10,11,120,180),(10.5,11,60,180),(10,11,90,180),(10,10.8,90,50),(10,11,90,200)]
        for i,(bid,ask,bq,aq) in enumerate(quotes):
            for key,value in dict(bidprice1=bid,askprice1=ask,bidsize1=bq,asksize1=aq,bidprice2=bid-.1,askprice2=ask+.1,bidsize2=50,asksize2=50).items():raw.loc[i,key]=value
        b=validated(raw);out=frame(calculate("order-flow-imbalance",b,{"period":2}))
        self.assertTrue(pd.isna(out.ofiEventShares.iloc[0]));np.testing.assert_allclose(out.ofiEventShares.iloc[1:],[40,60,-60,-50,50])
        np.testing.assert_allclose(out.ofiCumulativeShares,[0,40,100,40,-10,40])
        np.testing.assert_allclose(out.ofiRollingShares.iloc[2:],[100,0,-110,0])
        raw.loc[3:,'session']='2020-01-03';raw.loc[3:,'sequence']=[0,1,2]
        out=frame(calculate("order-flow-imbalance",validated(raw),{"period":2}))
        self.assertTrue(pd.isna(out.ofiEventShares.iloc[3]));self.assertEqual(out.ofiCumulativeShares.iloc[3],0)

    def test_unknown_direction_never_becomes_zero_cvd(self):
        raw=fixture(8);raw=raw[raw.eventtype.eq('trade')].reset_index(drop=True);raw.sequence=range(4)
        raw['aggressor']=['buy','sell','unknown','buy'];raw['sidebasis']=['exchange-provided','upstream-classified','unknown','exchange-provided'];raw['size']=[10,3,8,5]
        out=frame(calculate('trade-delta',validated(raw),{}))
        np.testing.assert_allclose(out.classifiedCvdShares,[10,7,7,12]);np.testing.assert_allclose(out.unknownShares,[0,0,8,8])
        self.assertTrue(out.cvdShares.iloc[2:].isna().all());self.assertAlmostEqual(out.classifiedVolumePct.iloc[-1],100*18/26)
        raw.loc[3,'session']='2020-01-03';raw.loc[3,'sequence']=0
        reset=frame(calculate('trade-delta',validated(raw),{}));self.assertEqual(reset.cvdShares.iloc[3],5)

    def test_selected_range_profile_exact_bins_ties_coverage_and_time(self):
        raw=fixture(10);raw=raw[raw.eventtype.eq('trade')].reset_index(drop=True);raw.sequence=range(5)
        raw['price']=[10.01,10.02,10.03,10.04,10.05];raw['size']=[20,30,40,30,10]
        b=validated(raw);r=calculate('volume-profile',b,{'binSize':.01,'valueAreaFraction':.7});a=frame(r).iloc[0];levels=frame(r,1)
        self.assertAlmostEqual(a.pocBinLower,10.03);self.assertAlmostEqual(a.valueAreaLow,10.02);self.assertAlmostEqual(a.valueAreaHigh,10.05)
        self.assertAlmostEqual(a.achievedValueAreaFraction,100/130);self.assertEqual(levels.volumeShares.sum(),130)
        self.assertEqual(pd.Timestamp(a.time),b.time.iloc[-1]);self.assertEqual(len(frame(r)),1)
        np.testing.assert_allclose(levels.volumeShares,[20,30,40,30,10])
        raw['size']=[40,40,5,5,5]
        a=frame(calculate('volume-profile',validated(raw),{'binSize':.01,'valueAreaFraction':1.})).iloc[0]
        self.assertAlmostEqual(a.pocBinLower,10.01);self.assertAlmostEqual(a.achievedValueAreaFraction,1.)
        raw.loc[4,'session']='2020-01-03'
        with self.assertRaises(ValueError):calculate('volume-profile',validated(raw),{'binSize':.01,'valueAreaFraction':.7})

    def test_profile_gap_and_limit(self):
        raw=fixture(4);raw=raw[raw.eventtype.eq('trade')].reset_index(drop=True);raw.sequence=[0,1]
        raw['price']=[10.,10.03];raw['size']=[10,20]
        r=calculate('volume-profile',validated(raw),{'binSize':.01,'valueAreaFraction':1.})
        np.testing.assert_allclose(frame(r,1).volumeShares,[10,0,0,20]);self.assertEqual(frame(r).iloc[0].achievedValueAreaFraction,1)
        with self.assertRaises(ValueError):calculate('volume-profile',validated(raw),{'binSize':.000001,'valueAreaFraction':.7})


if __name__ == '__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--write-fixture':
        fixture().to_csv(sys.argv[2],index=False)
    else:unittest.main()
