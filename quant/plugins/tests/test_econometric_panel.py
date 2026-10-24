"""Synchronized two-security windows and independent least-squares checks."""
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from econometric_panel import calculate,OPERATIONS
from test_panel_research import fixture as panel_fixture,validated


def fixture(n=400):
    b=panel_fixture(n);rng=np.random.default_rng(8259)
    x=4+np.cumsum(rng.normal(0,.008,n));noise=np.zeros(n)
    for i in range(1,n):noise[i]=.6*noise[i-1]+rng.normal(0,.004)
    logs={'000001':.8+1.1*x+noise,'000002':x,'000003':4+np.cumsum(rng.normal(0,.015,n)),'BENCH':4+np.cumsum(rng.normal(0,.01,n))}
    for symbol,values in logs.items():
        mask=b.symbol.eq(symbol);price=np.exp(values)
        for column,factor in [('open',1.),('high',1.01),('low',.99),('close',1.)]:b.loc[mask,column]=price*factor
    return b


def params():return dict(trainingRows=80,forecastEvery=25,security='000001',reference='000002',lags=1,adfLags=1)


def frame(result,name):
    t=next(t for t in result['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class EconometricTests(unittest.TestCase):
    def test_all_operations_preserve_prefix_and_known_training_boundary(self):
        b=validated(fixture());prefix=b[b.time<=b.time.unique()[299]].copy()
        for name in sorted(OPERATIONS):
            a=calculate(name,b,params());c=calculate(name,prefix,params())
            for t in a['tables']:
                x=frame(a,t['id']);y=frame(c,t['id']);x=x[pd.to_datetime(x.time,utc=True)<=prefix.time.max()].reset_index(drop=True)
                pd.testing.assert_frame_equal(x,y,check_dtype=False,atol=1e-10,rtol=1e-10)
            audit=frame(a,'training-audit')
            if name=='var':self.assertTrue(audit.lastOutcomeBar.eq(audit.predictionBar).all())
            else:self.assertTrue((audit.lastOutcomeBar<audit.predictionBar).all())

    def test_pair_beta_and_current_z_match_independent_matrix_solve(self):
        b=validated(fixture());p=params();result=calculate('cointegration-pair',b,p)
        row=frame(result,'indicators').iloc[0];w=b.pivot(index='time',columns='symbol',values='close');logs=np.log(w[['000001','000002']].to_numpy())
        x=np.column_stack([np.ones(80),logs[:80,1]]);beta=np.linalg.lstsq(x,logs[:80,0],rcond=None)[0]
        residuals=logs[:80,0]-x@beta;current=logs[80,0]-np.r_[1,logs[80,1]]@beta
        self.assertAlmostEqual(row.hedgeElasticity,beta[1],places=10)
        self.assertAlmostEqual(row.residualZ,(current-residuals.mean())/residuals.std(ddof=2),places=9)
        self.assertTrue(0<=row.engleGrangerPValue<=1)

    def test_arx_and_var_predictions_match_independent_lag_regressions(self):
        b=validated(fixture());w=b.pivot(index='time',columns='symbol',values='close');logs=np.log(w[['000001','000002']].to_numpy())
        returns=np.diff(logs,axis=0,prepend=np.full((1,2),np.nan));p=params()
        arx=frame(calculate('arx',b,p),'indicators').iloc[0]
        design=np.column_stack([np.ones(80),returns[1:81]]);target=returns[2:82,0]
        beta=np.linalg.lstsq(design,target,rcond=None)[0];expected=np.r_[1,returns[82]]@beta
        self.assertAlmostEqual(arx.nextLogReturn,expected,places=12)
        var=frame(calculate('var',b,p),'indicators').iloc[0]
        design=np.column_stack([np.ones(79),returns[1:80]]);target=returns[2:81]
        beta=np.linalg.lstsq(design,target,rcond=None)[0];expected=np.r_[1,returns[80]]@beta
        np.testing.assert_allclose([var.nextSecurityLogReturn,var.nextReferenceLogReturn],expected,atol=1e-12,rtol=1e-12)

    def test_missing_duplicate_and_singular_securities_are_rejected(self):
        b=validated(fixture());p=params()
        with self.assertRaisesRegex(ValueError,'distinct'):calculate('var',b,{**p,'reference':'000001'})
        with self.assertRaisesRegex(ValueError,'missing'):calculate('arx',b,{**p,'reference':'MISSING'})
        bad=b.drop(index=b.index[(b.symbol=='000002')][100])
        with self.assertRaisesRegex(ValueError,'synchronized'):calculate('var',bad,p)
        bad=b.copy();bad.loc[bad.symbol=='000001','close']=100.
        with self.assertRaisesRegex(ValueError,'No valid'):calculate('var',bad,p)


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--write-fixture':fixture().to_csv(sys.argv[2],index=False)
    else:unittest.main()
