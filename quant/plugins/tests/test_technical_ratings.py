"""Public v3 condition branches, independent primitive math and causal history."""
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from technical_ratings import primitives,component_ratings,aggregate,rating_status,rma,calculate
from test_plugins import fixture
from test_learning_models import table


class TechnicalRatingTests(unittest.TestCase):
    def neutral(self,n=80):
        f=primitives(fixture(n));f[:]=0.;f['close']=100.
        for col in f:
            if col.startswith(('SMA','EMA','HMA','VWMA')):f[col]=100.
        f['RSI14']=50.;f['stochK']=50.;f['stochD']=50.;f['stochRsiK']=50.;f['stochRsiD']=50.
        f['WilliamsR']=-50.;f['UO']=50.
        return f

    def test_all_fourteen_ma_votes_and_ichimoku_displacement(self):
        f=self.neutral();keys=['SMA'+str(n) for n in (10,20,30,50,100,200)]+['EMA'+str(n) for n in (10,20,30,50,100,200)]+['HMA9','VWMA20']
        f.loc[78,keys]=99.;f.loc[79,keys]=101.;a,_=component_ratings(f)
        np.testing.assert_allclose(a.loc[78,keys],1.);np.testing.assert_allclose(a.loc[79,keys],-1.)
        f['spanA']=30.;f['spanB']=20.;f['base']=40.;f['conversion']=50.;f.loc[79,['spanA','spanB']]=[10.,200.]
        a,_=component_ratings(f);self.assertEqual(a.Ichimoku.iloc[-1],1.)
        f['spanA']=20.;f['spanB']=30.;f['base']=15.;f['conversion']=10.;f['close']=5.
        a,_=component_ratings(f);self.assertEqual(a.Ichimoku.iloc[-1],-1.)
        f.loc[79,'close']=11.;a,_=component_ratings(f);self.assertEqual(a.Ichimoku.iloc[-1],0.)

    def test_eleven_oscillators_both_condition_directions(self):
        cases={
            'RSI':({'RSI14':[20.,25.]},{'RSI14':[80.,75.]}),
            'Stochastic':({'stochK':[10.,15.],'stochD':[10.,10.]},{'stochK':[90.,85.],'stochD':[90.,90.]}),
            'CCI':({'CCI20close':[-150.,-120.]},{'CCI20close':[150.,120.]}),
            'ADX':({'ADX14':[21.,22.],'diPlus':[30.,30.],'diMinus':[10.,10.]},{'ADX14':[21.,22.],'diPlus':[10.,10.],'diMinus':[30.,30.]}),
            'AO':({'AO':[-1.,1.]},{'AO':[1.,-1.]}),
            'Momentum':({'momentum10':[0.,1.]},{'momentum10':[0.,-1.]}),
            'MACD':({'MACD':[0.,1.],'MACDsignal':[0.,0.]},{'MACD':[0.,-1.],'MACDsignal':[0.,0.]}),
            'StochRSI':({'EMA50':[110.,110.],'stochRsiK':[10.,15.],'stochRsiD':[10.,10.]},{'EMA50':[90.,90.],'stochRsiK':[90.,85.],'stochRsiD':[90.,90.]}),
            'WilliamsR':({'WilliamsR':[-95.,-85.]},{'WilliamsR':[-5.,-15.]}),
            'BullBearPower':({'EMA50':[90.,90.],'bearPower':[-10.,-5.]},{'EMA50':[110.,110.],'bullPower':[10.,5.]}),
            'Ultimate':({'UO':[50.,71.]},{'UO':[50.,29.]})}
        for key,(bull,bear) in cases.items():
            for changes,expected in ((bull,1.),(bear,-1.)):
                f=self.neutral(3)
                for col,values in changes.items():f.loc[1:2,col]=values
                _,o=component_ratings(f)
                with self.subTest(component=key,expected=expected):self.assertEqual(o[key].iloc[-1],expected)
        f=self.neutral(3);f['ADX14']=[22.,21.,20.5];f.diPlus=10.;f.diMinus=30.
        self.assertEqual(component_ratings(f)[1].ADX.iloc[-1],0.,'v3 sell requires rising ADX, unlike help-page text')

    def test_ao_turns_missing_guards_and_ema50_filter(self):
        for values,expected in (([3.,1.,2.],1.),([-3.,-1.,-2.],-1.)):
            f=self.neutral(3);f['AO']=values;self.assertEqual(component_ratings(f)[1].AO.iloc[-1],expected)
        f=self.neutral(3);f['RSI14']=[20.,np.nan,25.]
        self.assertTrue(np.isnan(component_ratings(f)[1].RSI.iloc[-1]))
        # Up/down is EMA50. Making EMA10 bearish must not enable a StochRSI buy.
        f=self.neutral(3);f.EMA50=90.;f.EMA10=110.;f.stochRsiK=15.;f.stochRsiD=10.
        self.assertEqual(component_ratings(f)[1].StochRSI.iloc[-1],0.)

    def test_group_weighting_missing_groups_and_exact_label_boundaries(self):
        ma=pd.DataFrame(np.ones((3,15)));osc=pd.DataFrame(-np.ones((3,11)));ma.loc[1:]=np.nan;osc.loc[2]=np.nan
        out=aggregate(ma,osc);self.assertEqual(out.overallRating.iloc[0],0.)
        self.assertNotAlmostEqual(out.overallRating.iloc[0],4/26)
        self.assertEqual(out.overallRating.iloc[1],-1.);self.assertTrue(np.isnan(out.overallRating.iloc[2]))
        values=pd.Series([np.nan,-.500001,-.5,-.100001,-.1,.1,.100001,.5,.500001])
        self.assertEqual(rating_status(values).tolist(),['unavailable','strong-sell','sell','sell','neutral','neutral','buy','buy','strong-buy'])

    def test_independent_primitives_complete_seed_and_zero_divisors(self):
        b=fixture(240);f=primitives(b);x=b.close.to_numpy();ema=x[0]
        for value in x[1:]:ema=2/201*value+199/201*ema
        self.assertAlmostEqual(f.EMA200.iloc[-1],ema,places=10)
        expected=(x[-1]-x[-20:].mean())/(.015*np.mean(np.abs(x[-20:]-x[-20:].mean())))
        self.assertAlmostEqual(f.CCI20close.iloc[-1],expected,places=10)
        extreme=b.copy();extreme.high*=2;np.testing.assert_allclose(primitives(extreme).CCI20close,f.CCI20close,equal_nan=True)
        weights=lambda a:sum((i+1)*v for i,v in enumerate(a))/sum(range(1,len(a)+1))
        hma=weights([2*weights(x[end-4:end])-weights(x[end-9:end]) for end in (len(x)-2,len(x)-1,len(x))])
        self.assertAlmostEqual(f.HMA9.iloc[-1],hma,places=10)
        np.testing.assert_allclose(rma(pd.Series([np.nan,1.,2.,3.,4.,np.nan,6.,7.,8.]),3),
            [np.nan,np.nan,np.nan,2.,8/3,np.nan,np.nan,np.nan,7.],equal_nan=True)
        flat=b.copy();flat[['open','high','low','close']]=100.;flat.volume=0.;f=primitives(flat)
        self.assertTrue(f[['VWMA20','RSI14','CCI20close','WilliamsR','UO']].isna().all().all())

    def test_full_outputs_are_prefix_invariant_and_components_reconcile(self):
        b=fixture(500);a=calculate(b);short=calculate(b.iloc[:320].copy());changed=b.copy()
        changed.loc[320:,['open','high','low','close']]*=10;c=calculate(changed)
        for t in a['tables']:
            x=table(a,t['id']).iloc[:320].reset_index(drop=True);y=table(short,t['id']);z=table(c,t['id']).iloc[:320].reset_index(drop=True)
            pd.testing.assert_frame_equal(x,y,check_dtype=False,rtol=1e-10,atol=1e-10)
            pd.testing.assert_frame_equal(x,z,check_dtype=False,rtol=1e-10,atol=1e-10)
        ma=table(a,'ma-components').drop(columns='time');other=table(a,'oscillator-components').drop(columns='time');summary=table(a,'indicators')
        self.assertEqual(ma.shape[1],15);self.assertEqual(other.shape[1],11)
        self.assertTrue(summary.availableMovingAverages.iloc[199:].eq(15).all());self.assertTrue(summary.availableOscillators.iloc[199:].eq(11).all())
        np.testing.assert_allclose(summary.overallRating,(ma.mean(axis=1)+other.mean(axis=1))/2,atol=1e-12)
        self.assertFalse(a['modelSemantics']['pineNumericalParityVerified'])


if __name__=='__main__':unittest.main()
