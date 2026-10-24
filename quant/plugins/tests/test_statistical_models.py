"""Independent recurrences and causal endpoint checks for original estimators."""
import base64
import json
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from statistical_models import calculate,fit_window,OPERATIONS


def fixture(n=360):
    rng=np.random.default_rng(2019)
    r=np.array([rng.normal(-.9,.5) if (i//25)%2==0 else rng.normal(.8,1.4) for i in range(n)])
    close=100*np.exp(np.cumsum(r)/100)
    return pd.DataFrame(dict(time=pd.date_range('2020-01-01',periods=n).astype(str),open=close,high=close*1.01,low=close*.99,
                             close=close,volume=1000.,datasetkind='synthetic-test'))


def params():
    return dict(trainingRows=120,forecastEvery=40,maxIterations=500,states=2,seed=2026,annualBars=252,
                arOrder=0,differenceOrder=1,maOrder=0)


def frame(r,name):
    t=next(t for t in r['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class StatisticalTests(unittest.TestCase):
    def test_every_model_preserves_prefix_and_records_only_known_endpoint(self):
        b=fixture()
        for name in sorted(OPERATIONS):
            with self.subTest(model=name):
                a=calculate(name,b,params());c=calculate(name,b.iloc[:280].copy(),params())
                for t in a['tables']:
                    x=frame(a,t['id']);y=frame(c,t['id'])
                    x=x[x.time<=b.time.iloc[279]].reset_index(drop=True)
                    pd.testing.assert_frame_equal(x,y,check_dtype=False,atol=1e-9,rtol=1e-9)
                audit=frame(a,'training-audit');self.assertTrue((audit.observations==120).all())
                self.assertEqual(audit.lastTrainingBar.iloc[0],120)
                self.assertEqual(audit.time.iloc[0],b.time.iloc[120])
                state=json.loads(base64.b64decode(a['generatedData']['base64']))
                self.assertEqual(state['operation'],name);self.assertEqual(state['horizonBars'],1)

    def test_hmm_last_probability_equals_independent_forward_filter(self):
        b=fixture();r=100*np.log(b.close).diff().iloc[1:181].to_numpy();p=params()
        values,state=fit_window('gaussian-hmm',r,np.log(b.close.iloc[1:181].to_numpy()),p)
        mu=np.array(state['meansPercent']);var=np.array(state['variancesPercentSquared']);transition=np.array(state['transitionRowsFromColumnsTo'])
        alpha=np.array(state['initialProbabilities'])
        for i,x in enumerate(r):
            if i:alpha=alpha@transition
            density=np.exp(-.5*(x-mu)**2/var)/np.sqrt(2*np.pi*var)
            alpha*=density;alpha/=alpha.sum()
        order=state['meanRankToOriginalState'];nextp=alpha@transition
        for rank,k in enumerate(order):
            self.assertAlmostEqual(values[f'filteredProbability{rank+1}'],alpha[k],places=10)
            self.assertAlmostEqual(values[f'nextProbability{rank+1}'],nextp[k],places=10)

    def test_arch_forecasts_equal_independent_one_step_recurrences(self):
        b=fixture();r=100*np.log(b.close).diff().iloc[1:301].to_numpy();p=params()
        for name in ('garch','egarch','gjr-garch'):
            values,state=fit_window(name,r,np.array([]),p)
            params0=state['originalParameters'];eps=state['lastResidualPercent'];var=state['lastConditionalVariancePercentSquared']
            if name=='egarch':
                z=eps/np.sqrt(var);expected=np.exp(params0['omega']+params0['alpha[1]']*(abs(z)-np.sqrt(2/np.pi))+params0['gamma[1]']*z+params0['beta[1]']*np.log(var))
            else:
                expected=params0['omega']+params0['alpha[1]']*eps**2+params0['beta[1]']*var
                if name=='gjr-garch':expected+=params0['gamma[1]']*(eps<0)*eps**2
            self.assertAlmostEqual(values['nextVariance'],expected/10000,places=10)
            self.assertAlmostEqual(values['nextAnnualizedVolatility'],np.sqrt(expected/10000*252),places=10)

    def test_arima_random_walk_median_is_last_price(self):
        b=fixture();logs=np.log(b.close.iloc[:200].to_numpy());values,state=fit_window('arima',np.array([]),logs,params())
        self.assertAlmostEqual(values['nextLogPrice'],logs[-1],places=10)
        self.assertAlmostEqual(values['nextMedianPrice'],b.close.iloc[199],places=9)
        self.assertLess(values['priceLower95'],values['nextMedianPrice']);self.assertGreater(values['priceUpper95'],values['nextMedianPrice'])

    def test_markov_transition_uses_current_filtered_probability(self):
        b=fixture();r=100*np.log(b.close).diff().iloc[1:301].to_numpy();values,state=fit_window('markov-switching',r,np.array([]),params())
        order=state['meanRankToOriginalState'];current=np.zeros(2)
        for rank,k in enumerate(order):current[k]=values[f'filteredProbability{rank+1}']
        expected=current@np.array(state['transitionRowsFromColumnsTo'])
        self.assertAlmostEqual(sum(expected),1)
        for rank,k in enumerate(order):self.assertAlmostEqual(values[f'nextProbability{rank+1}'],expected[k],places=12)

    def test_degenerate_windows_remain_failed_without_future_fill(self):
        b=fixture();b.loc[:160,['open','high','low','close']]=100.
        result=calculate('garch',b,params());out=frame(result,'indicators');audit=frame(result,'training-audit')
        self.assertEqual(out.status.iloc[0],'fit-unavailable');self.assertTrue(pd.isna(out.nextVariance.iloc[0]))
        self.assertEqual(audit.status.iloc[0],'fit-unavailable');self.assertGreater(result['modelSemantics']['unavailableFits'],0)
        b['close']=100
        with self.assertRaisesRegex(ValueError,'No converged'):calculate('garch',b,params())


if __name__=='__main__':unittest.main()
