import sys
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from pattern_research import calculate,impulse,harmonic,TEMPLATES


def bars(prices):
    c=np.asarray(prices,dtype=float)
    return pd.DataFrame({'time':pd.date_range('2020-01-01',periods=len(c)).astype(str),'open':c,'high':c+1.,'low':c-1.,'close':c,'volume':1000.})


def path(points):
    return bars(np.r_[np.concatenate([np.linspace(a,b,9)[:-1] for a,b in zip(points,points[1:])]),points[-1]])


def params():return dict(period=20,momentumPeriod=20,bbMultiple=2.,kcMultiple=1.5,reversalPct=5.,pattern='abcd',tolerancePct=5.)


def frame(result,name='indicators'):
    t=next(t for t in result['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class Patterns(unittest.TestCase):
    def test_regression_matches_independent_least_squares_and_band_calculation(self):
        b=bars(100+np.arange(100)*.1+np.sin(np.arange(100)*.8)*2);p={**params(),'period':7,'momentumPeriod':5}
        o=frame(calculate('squeeze-regression',b,p));delta=[]
        for i in range(4,len(b)):
            window=b.iloc[i-4:i+1];delta.append(b.close.iloc[i]-((window.high.max()+window.low.min())/2+sum(window.close)/5)/2)
        for i in range(8,len(b)):
            coefficients=np.linalg.lstsq(np.column_stack([np.ones(5),np.arange(5)]),np.array(delta[i-8:i-3]),rcond=None)[0]
            self.assertAlmostEqual(o.momentum.iloc[i],coefficients[0]+coefficients[1]*4,places=11)
        self.assertTrue(o.momentum.iloc[:8].isna().all())
        for i in range(6,len(b)):
            closes=b.close.iloc[i-6:i+1].tolist();mu=sum(closes)/7;sd=(sum((x-mu)**2 for x in closes)/7)**.5
            tr=[max(b.high.iloc[j]-b.low.iloc[j],abs(b.high.iloc[j]-b.close.iloc[j-1]),abs(b.low.iloc[j]-b.close.iloc[j-1])) if j else 2 for j in range(i-6,i+1)]
            self.assertAlmostEqual(o.bbUpper.iloc[i],mu+2*sd);self.assertAlmostEqual(o.kcLower.iloc[i],mu-1.5*sum(tr)/7)

    def test_squeeze_flat_boundary_release_and_zero_momentum(self):
        b=bars([100.]*80);o=frame(calculate('squeeze-regression',b,params()))
        self.assertTrue(o.squeezeState.iloc[19:].eq(1).all());self.assertTrue(o.momentum.iloc[38:].eq(0).all())
        b.high=b.close;b.low=b.close;o=frame(calculate('squeeze-regression',b,params()))
        self.assertTrue(o.squeezeState.iloc[19:].eq(0).all());self.assertTrue(o.release.iloc[20:].eq(0).all())
        b=bars(np.r_[[100.]*45,110+np.arange(55)*4]);o=frame(calculate('squeeze-regression',b,params()))
        self.assertGreater(o.release.sum(),0)
        for i in o.index[o.release.eq(1)]:self.assertEqual((o.squeezeState.iloc[i-1],o.squeezeState.iloc[i]),(1,-1))

    def test_impulse_exact_rules_and_both_directions(self):
        valid=[100,120,110,145,125,155]
        self.assertEqual(impulse(valid)[0],1);self.assertEqual(impulse(400-np.array(valid))[0],-1)
        for points,rule in [([100,120,99,145,125,155],'wave2HoldsStart'),([100,120,110,119,115,130],'wave3ExtendsWave1'),
                ([100,120,110,145,120,155],'wave4NoOverlap'),([100,120,110,145,125,145],'wave5ExtendsWave3'),
                ([100,130,110,135,132,165],'wave3NotShortest')]:
            direction,audit=impulse(points);self.assertEqual(direction,0);self.assertFalse(audit[rule])

    def test_harmonic_known_ratios_and_reflections_for_every_template(self):
        points={'abcd':[200,140,180,120], 'retracement-618-786':[100,200,138.2,183.2,121.4],
                'retracement-382-500-886':[100,200,150,178,111.4], 'extension-786-1270':[100,200,121.4,171,73],
                'extension-382-618-1618':[100,200,150,193,38.2]}
        for template,values in points.items():
            with self.subTest(template=template):
                direction,audit=harmonic(values,template,.05);self.assertEqual(direction,1)
                self.assertEqual(harmonic(400-np.array(values),template,.05)[0],-1)
                self.assertAlmostEqual(audit['cdAb'],abs(values[-1]-values[-2])/abs(values[1]-values[0]) if template=='abcd' else abs(values[-1]-values[-2])/abs(values[2]-values[1]))
                if template!='abcd':self.assertAlmostEqual(audit['adXa'],abs(values[4]-values[1])/abs(values[1]-values[0]))
                self.assertEqual(harmonic([100,200,200,150,110] if template!='abcd' else [200,140,140,100],template,.05)[0],0)
        self.assertEqual(harmonic([100,200,138.2,183.2,99],'retracement-618-786',.2)[0],0)

    def test_actual_pivot_confirmation_not_historical_extreme(self):
        for operation,points in [('impulse-candidate',[100,120,110,145,125,155,140]),('harmonic-candidate',[200,140,180,120,135])]:
            b=path(points);r=calculate(operation,b,params());o=frame(r);hits=o[o.matchedDirection.ne(0)]
            self.assertEqual(len(hits),1);last_pivot=8*(len(points)-2);signal=int(hits.index[0]);self.assertGreater(signal,last_pivot)
            self.assertEqual(hits.pivotBar.iloc[0],last_pivot);self.assertEqual(o.matchedDirection.iloc[last_pivot],0)
            audit=frame(r,'candidate-audit');self.assertTrue((audit.confirmedBar>=audit.filter(regex='KnownBar$').max(axis=1)).all())

    def test_zero_tolerance_accepts_decimal_roundoff_but_not_ratio_drift(self):
        values=[100,200,138.2,183.2,121.4]
        self.assertEqual(harmonic(values,'retracement-618-786',0.)[0],1)
        self.assertEqual(harmonic([100,200,138.2,183.2,121.400001],'retracement-618-786',0.)[0],0)

    def test_every_operation_prefix_and_future_extremes_preserve_all_tables(self):
        b=bars(np.exp(np.log(100)+np.cumsum(np.random.default_rng(77).normal(0,.03,400))));cut=213;future=b.copy()
        future.loc[cut:,['open','high','low','close']]*=7
        for operation in ('squeeze-regression','impulse-candidate','harmonic-candidate'):
            for template in (('abcd',*TEMPLATES) if operation=='harmonic-candidate' else ('abcd',)):
                p={**params(),'pattern':template};a=calculate(operation,b,p);c=calculate(operation,future,p);s=calculate(operation,b.iloc[:cut],p)
                for short in s['tables']:
                    name=short['id'];x=frame(a,name);y=frame(c,name);z=frame(s,name)
                    x=x[x.time<=b.time.iloc[cut-1]].reset_index(drop=True);y=y[y.time<=b.time.iloc[cut-1]].reset_index(drop=True)
                    pd.testing.assert_frame_equal(x,z,check_dtype=False);pd.testing.assert_frame_equal(x,y,check_dtype=False)

    def test_no_unfinished_endpoint_or_zero_divisor_pattern(self):
        for operation in ('impulse-candidate','harmonic-candidate'):
            r=calculate(operation,bars(np.arange(100)+100),params())
            self.assertTrue(frame(r).matchedDirection.eq(0).all());self.assertTrue(frame(r,'candidate-audit').empty)
        self.assertEqual(harmonic([100,100,100,100],'abcd',.05)[0],0)
        with self.assertRaises(ValueError):calculate('harmonic-candidate',bars(np.arange(100)+100),{**params(),'tolerancePct':21})


if __name__=='__main__':unittest.main()
