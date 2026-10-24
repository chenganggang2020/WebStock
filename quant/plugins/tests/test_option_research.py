import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.special import ndtr
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from option_research import load_options,price,implied,greeks,interpolation,calculate


def fixture(n=24):
    rows=[]
    for i,time in enumerate(pd.date_range('2020-01-01T16:00:00Z',periods=n)):
        spot=100+np.sin(i/5);quote=time-pd.Timedelta(seconds=2)
        for e,days in enumerate((90,180),1):
            expiry=pd.Timestamp('2020-01-01T16:00:00Z')+pd.Timedelta(days=days);t=(expiry-time).total_seconds()/(365*86400)
            for strike in (70,80,90,100,110,120,130):
                for right in ('call','put'):
                    sigma=.20+.02*e+.003*np.sin(i/4)+.04*(100-strike)/100
                    d1=(np.log(spot/strike)+(.02-.01+.5*sigma*sigma)*t)/(sigma*np.sqrt(t));d2=d1-sigma*np.sqrt(t)
                    value=spot*np.exp(-.01*t)*ndtr(d1)-strike*np.exp(-.02*t)*ndtr(d2) if right=='call' else strike*np.exp(-.02*t)*ndtr(-d2)-spot*np.exp(-.01*t)*ndtr(-d1)
                    rows.append(dict(time=time.isoformat(),contract=right[0].upper()+str(strike)+'E'+str(e),underlying='SYNTHETIC',expiry=expiry.isoformat(),right=right,style='european',
                        strike=strike,spot=spot,spotat=quote.isoformat(),spotknownat=time.isoformat(),bid=max(0,value-.005),ask=value+.005,
                        quoteat=quote.isoformat(),quoteknownat=time.isoformat(),rate=.02,rateknownat=quote.isoformat(),dividendyield=.01,yieldknownat=quote.isoformat(),
                        volume=100 if right=='call' else 200,volumestart=(time-pd.Timedelta(hours=8)).isoformat(),volumeat=time.isoformat(),volumeknownat=time.isoformat(),
                        openinterest=1000 if right=='call' else 3000,oiat=(time-pd.Timedelta(days=1)).isoformat(),oiknownat=quote.isoformat(),
                        multiplier=100,currency='USD',priceunit='per-underlying-unit',volumeunit='contract',universeid='synthetic-chain-v1',universecount=28,
                        source='synthetic-validation-only',modelbasis='continuous-r-q-act365f'))
    return pd.DataFrame(rows)


def loaded(b):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'options.csv';b.to_csv(p,index=False);return load_options(p)


def frame(r,name='indicators'):
    t=next(x for x in r['tables'] if x['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class Options(unittest.TestCase):
    def test_known_price_iv_parity_and_greeks(self):
        self.assertAlmostEqual(price(100,100,1,0,0,.2,'call'),7.965567455405804,12)
        self.assertAlmostEqual(implied(7.965567455405804,100,100,1,0,0,'call')[0],.2,12)
        for right in ('call','put'):
            s,k,t,r,q,v=104.,100.,.75,.03,.015,.28
            delta,gamma,vega=greeks(s,k,t,r,q,v,right);h=.01
            mid=price(s,k,t,r,q,v,right)
            self.assertAlmostEqual(delta,(price(s+h,k,t,r,q,v,right)-price(s-h,k,t,r,q,v,right))/(2*h),7)
            self.assertAlmostEqual(gamma,(price(s+h,k,t,r,q,v,right)-2*mid+price(s-h,k,t,r,q,v,right))/h**2,7)
            self.assertAlmostEqual(vega,(price(s,k,t,r,q,v+1e-5,right)-price(s,k,t,r,q,v-1e-5,right))/2e-5/100,7)
        self.assertAlmostEqual(price(s,k,t,r,q,v,'call')-price(s,k,t,r,q,v,'put'),s*np.exp(-q*t)-k*np.exp(-r*t),12)

    def test_price_bounds_bracket_and_zero_boundary(self):
        self.assertEqual(implied(0,100,100,1,0,0,'call'),(0.,'zero-volatility-boundary'))
        self.assertEqual(implied(100,100,100,1,0,0,'call')[1],'outside-price-bounds')
        self.assertEqual(implied(-1,100,100,1,0,0,'put')[1],'outside-price-bounds')
        self.assertEqual(implied(20,100,100,1,0,0,'call',.2)[1],'above-volatility-bracket')
        for s,k in ((1.,1000.),(1000.,1.)):
            self.assertGreaterEqual(price(s,k,.01,.02,.01,.2,'call'),0)

    def test_independent_surface_recovery_and_ratios(self):
        b=loaded(fixture(3));r=calculate('option-iv',b,{});v=frame(r,'option-values');out=frame(r)
        self.assertEqual(len(out),3);self.assertTrue(out.contract.eq('C100E1').all())
        for row in v[v.strike.between(90,110)].itertuples():
            i=(pd.Timestamp(row.time)-b.time.iloc[0]).days;e=1 if row.contract.endswith('E1') else 2
            expected=.2+.02*e+.003*np.sin(i/4)+.04*(100-row.strike)/100
            self.assertAlmostEqual(row.midIV,expected,10)
        summary=frame(r,'expiry-summary');self.assertTrue(summary.volumePCR.eq(2).all());self.assertTrue(summary.openInterestPCR.eq(3).all())
        self.assertTrue(summary.oiAgeSeconds.eq(86400).all());self.assertTrue(summary.put25MinusCall25IV.gt(0).all())
        for row in summary.itertuples():
            q=v[v.time.eq(row.time)&v.expiry.eq(row.expiry)].set_index('contract')
            a=q.loc[row.atmCallLeftContract];z=q.loc[row.atmCallRightContract]
            w=-np.log(a.strike/row.forward)/(np.log(z.strike/row.forward)-np.log(a.strike/row.forward))
            self.assertAlmostEqual(row.atmCallIV,a.midIV*(1-w)+z.midIV*w,12)

    def test_no_extrapolation_ambiguity_and_zero_denominators(self):
        self.assertEqual(interpolation([(.3,.2,'A'),(.4,.3,'B')],.25)[1],'no-observed-bracket')
        self.assertEqual(interpolation([(.2,.2,'A'),(.2,.3,'B')],.25)[1],'ambiguous-abscissa')
        self.assertAlmostEqual(interpolation([(.2,.2,'A'),(.3,.4,'B')],.25)[0],.3,14)
        raw=fixture(2);raw.loc[raw.right.eq('call'),['volume','openinterest']]=0
        out=frame(calculate('option-term-pcr',loaded(raw),{}));self.assertTrue(out.volumePCR.isna().all());self.assertTrue(out.openInterestPCR.isna().all())

    def test_stale_prices_and_invalid_prices_are_explicit(self):
        raw=fixture(2);raw.loc[raw.contract.eq('C100E1'),'quoteat']='2019-12-01T00:00:00Z'
        out=frame(calculate('option-iv',loaded(raw),{}));self.assertTrue(out.midIV.isna().all());self.assertTrue(out.midStatus.eq('stale-quote-or-spot').all())
        raw=fixture(2);raw.loc[raw.contract.eq('C100E1'),['bid','ask']]=200
        out=frame(calculate('option-iv',loaded(raw),{}));self.assertTrue(out.midStatus.eq('outside-price-bounds').all())

    def test_missing_selection_and_expiry_rank(self):
        b=loaded(fixture(2));out=frame(calculate('option-iv',b,{'contractId':'unknown'}));self.assertTrue(out.midIV.isna().all())
        out=frame(calculate('option-term-pcr',b,{'expiryRank':3}));self.assertTrue(out.atmCallIV.isna().all())
        out=frame(calculate('option-skew',b,{'expiryRank':2}));self.assertEqual(pd.Timestamp(out.expiry.iloc[0]),b.expiry.max())

    def test_prefix_and_future_perturbation_all_tables(self):
        b=loaded(fixture(5));cut=b.time.unique()[2]
        for operation in ('option-iv','option-skew','option-term-pcr'):
            full=calculate(operation,b,{});prefix=calculate(operation,b[b.time<=cut],{})
            future=b.copy();future.loc[future.time>cut,['bid','ask']]*=1.5;changed=calculate(operation,future,{})
            for t in full['tables']:
                name=t['id'];a=frame(full,name);c=frame(changed,name);expected=frame(prefix,name)
                pd.testing.assert_frame_equal(a[pd.to_datetime(a.time)<=cut].reset_index(drop=True),expected,check_dtype=False)
                pd.testing.assert_frame_equal(c[pd.to_datetime(c.time)<=cut].reset_index(drop=True),expected,check_dtype=False)

    def test_invalid_contracts_units_availability_and_universe(self):
        for key,value in (('style','american'),('priceunit','per-contract'),('volumeunit','share'),('universecount',27),('bid',-1),('volume',.5),
                          ('quoteknownat','2030-01-01T00:00:00Z'),('rateknownat','2030-01-01T00:00:00Z'),('oiat','2030-01-01T00:00:00Z'),('expiry','2019-01-01T00:00:00Z')):
            raw=fixture(2);raw.loc[0,key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):loaded(raw)
        for key,value in (('strike',72),('multiplier',50),('volumeat','2020-01-01T15:00:00Z'),('spot',101)):
            raw=fixture(2);raw.loc[28,key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):loaded(raw)


if __name__=='__main__':unittest.main()
