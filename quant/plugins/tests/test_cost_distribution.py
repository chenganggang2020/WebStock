import math
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from cost_distribution import calculate,allocations
from worker import load_bars


def fixture(n=320):
    i=np.arange(n);end=pd.date_range('2020-01-01T15:00:00+08:00',periods=n);close=20+i*.01+np.sin(i*.15)
    free=np.where(i<120,1000000,1200000);volume=30000+(i%13)*2000.
    if n>50:volume[50]=0
    if n>150:volume[150]=2000000
    return pd.DataFrame({'time':(end+pd.Timedelta(minutes=5)).astype(str),'barend':end.astype(str),
        'availableat':(end+pd.Timedelta(minutes=1)).astype(str),'open':close,'high':close+.3,'low':close-.3,'close':close,'volume':volume,
        'freefloatshares':free,'freefloatknownat':(end-pd.Timedelta(hours=1)).astype(str),'regimeid':np.where(i<200,'synthetic-A','synthetic-B'),
        'adjustment':'unadjusted','volumeunit':'share','currency':'CNY','sessionindex':i,'calendarid':'synthetic-calendar-v1'})


def loaded(b):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'input.csv';b.to_csv(p,index=False);return load_bars(p)


def frame(result,name='indicators'):
    t=next(t for t in result['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class CostModel(unittest.TestCase):
    def test_hand_calculated_mass_cost_profit_and_interpolated_quantiles(self):
        b=fixture(3);b['freefloatshares']=100;b['volume']=[99,50,0]
        b['open']=b['close']=[100.5,101.,101.5];b['low']=[100.,100.,101.];b['high']=[101.,102.,102.]
        r=calculate(loaded(b),{'binWidth':1.,'retention':'linear-capped'});o=frame(r);hist=frame(r,'model-cost-profile')
        np.testing.assert_allclose(hist.modelWeight,[.75,.25]);np.testing.assert_allclose(o.modelMeanCost,[100.5,100.75,100.75])
        np.testing.assert_allclose(o.modelProfitFraction,[.5,.75,.875]);np.testing.assert_allclose(o.initialAssumptionWeight,[1.,.5,.5])
        self.assertAlmostEqual(o.cost05.iloc[1],100+.05/.75);self.assertAlmostEqual(o.cost95.iloc[1],101+.2/.25)
        self.assertTrue(pd.isna(o.retainedPreviousFraction.iloc[0]));self.assertEqual(o.resetReason.iloc[0],'initial-close-bin')

    def test_poisson_retention_and_greater_than_full_turnover(self):
        b=fixture(2);b['freefloatshares']=100;b['volume']=[1000,150]
        b['open']=b['close']=[100.5,101.];b['low']=100.;b['high']=102.
        for mode in ('poisson','linear-capped'):
            r=calculate(loaded(b),{'binWidth':1.,'retention':mode});r0=math.exp(-1.5) if mode=='poisson' else 0
            o=frame(r);h=frame(r,'model-cost-profile');np.testing.assert_allclose(h.modelWeight,[(1+r0)/2,(1-r0)/2])
            self.assertAlmostEqual(o.initialAssumptionWeight.iloc[-1],r0);self.assertAlmostEqual(o.turnoverFraction.iloc[-1],1.5)

    def test_uniform_overlap_and_flat_price_allocation(self):
        self.assertEqual(allocations(10.,10.,1.),{10:1.})
        a=allocations(10.25,12.25,1.);self.assertEqual(a,{10:.375,11:.5,12:.125})
        self.assertEqual(allocations(10.,12.,1.),{10:.5,11:.5})
        with self.assertRaises(ValueError):allocations(1.,5000.,1.)

    def test_share_or_regime_changes_reset_with_explicit_reason(self):
        b=loaded(fixture());r=calculate(b,{'binWidth':.5,'retention':'linear-capped'});o=frame(r)
        self.assertEqual(o.resetReason.iloc[120],'free-float-changed');self.assertEqual(o.resetReason.iloc[200],'regime-changed')
        for i in (0,120,200):
            self.assertEqual(o.initialAssumptionWeight.iloc[i],1.);self.assertAlmostEqual(o.modelMeanCost.iloc[i],(math.floor(b.close.iloc[i]/.5)+.5)*.5)
        self.assertEqual(o.modelGeneration.iloc[-1],3);self.assertFalse(r['modelSemantics']['actualHolderLedger'])

    def test_all_past_summaries_survive_future_perturbation_and_prefix_cuts(self):
        b=loaded(fixture());future=b.copy();future.loc[181:,['open','high','low','close']]*=2
        for mode in ('linear-capped','poisson'):
            p={'binWidth':.5,'retention':mode};a=calculate(b,p);c=calculate(future,p);s=calculate(b.iloc[:181],p)
            pd.testing.assert_frame_equal(frame(a).iloc[:181],frame(s),check_dtype=False)
            pd.testing.assert_frame_equal(frame(a).iloc[:181],frame(c).iloc[:181],check_dtype=False)
            profile=frame(s,'model-cost-profile');self.assertAlmostEqual(profile.modelWeight.sum(),1.,places=14)
            self.assertTrue(profile.time.eq(frame(s).time.iloc[-1]).all())

    def test_unit_scaling_keeps_weights_and_probabilities(self):
        b=loaded(fixture(100));scaled=b.copy();scaled[['open','high','low','close']]*=10
        a=calculate(b,{'binWidth':.5,'retention':'poisson'});c=calculate(scaled,{'binWidth':5.,'retention':'poisson'})
        np.testing.assert_allclose(frame(a).modelMeanCost*10,frame(c).modelMeanCost,rtol=1e-12)
        np.testing.assert_allclose(frame(a).modelProfitFraction,frame(c).modelProfitFraction,atol=1e-12)
        np.testing.assert_allclose(frame(a,'model-cost-profile').modelWeight,frame(c,'model-cost-profile').modelWeight,atol=1e-12)

    def test_invalid_known_time_units_missing_sessions_and_float_rejected(self):
        raw=fixture(20)
        for key,value in [('freefloatknownat','2040-01-01T00:00:00Z'),('availableat','2040-01-01T00:00:00Z'),
            ('barend','2040-01-01T00:00:00Z'),('adjustment','forward'),('volumeunit','lot'),('freefloatshares',0),
            ('freefloatshares',100.5),('sessionindex',4),('currency','USD'),('regimeid',np.nan),('calendarid','')]:
            b=raw.copy();b[key]=b[key].astype(object);b.loc[10,key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):calculate(loaded(b),{'binWidth':.5,'retention':'linear-capped'})
        with self.assertRaises(ValueError):calculate(loaded(raw.drop(columns='freefloatknownat')),{'binWidth':.5,'retention':'linear-capped'})

    def test_final_contiguous_profile_and_bounded_mass(self):
        for mode in ('linear-capped','poisson'):
            r=calculate(loaded(fixture()),{'binWidth':.5,'retention':mode});p=frame(r,'model-cost-profile');o=frame(r)
            np.testing.assert_allclose(p.priceLower.diff().iloc[1:],.5);self.assertTrue((p.modelWeight>=0).all());self.assertAlmostEqual(p.modelWeight.sum(),1.,places=14)
            self.assertTrue(o.modelProfitFraction.between(0.,1.).all());self.assertTrue(o.cost05.le(o.cost95).all())
            self.assertTrue(o.initialAssumptionWeight.between(0.,1.).all())


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--fixture':fixture().to_csv(sys.argv[2],index=False)
    else:unittest.main()
