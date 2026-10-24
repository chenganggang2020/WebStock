"""Independent linear solves, fit-time isolation and matured outcome tests."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from learning_models import calculate,features,OPERATIONS


def fixture(n=260):
    rng=np.random.default_rng(7913);close=100*np.exp(np.cumsum(rng.normal(0,.02,n)))
    opening=close*(1+rng.normal(0,.005,n))
    return pd.DataFrame({"time":pd.date_range("2020-01-01",periods=n).astype(str),"open":opening,"high":np.maximum(opening,close)+.1,
        "low":np.minimum(opening,close)-.1,"close":close,"volume":rng.integers(100,10000,n).astype(float),"datasetkind":"synthetic-test"})


def params():
    return dict(trainingRows=60,horizon=3,purgeBars=2,retrainEvery=20,seed=2026,alpha=2.,regularizationC=1.,estimators=8,maxDepth=2,minLeaf=5,learningRate=.1)


def table(result,name):
    t=next(t for t in result["tables"] if t["id"]==name);return pd.DataFrame(t["rows"],columns=t["columns"])


class LearningTests(unittest.TestCase):
    def test_all_estimators_fit_mature_labels_and_preserve_prefix(self):
        b=fixture();prefix=b.iloc[:210].copy()
        for name in sorted(OPERATIONS):
            with self.subTest(model=name):
                full=calculate(name,b,params());short=calculate(name,prefix,params())
                for t in full["tables"]:
                    a=table(full,t["id"]);c=table(short,t["id"])
                    a=a[a.time<=prefix.time.iloc[-1]].reset_index(drop=True)
                    pd.testing.assert_frame_equal(a,c,check_dtype=False,rtol=1e-10,atol=1e-10)
                audit=table(full,"training-audit")
                self.assertTrue((audit.lastOutcomeBar<=audit.predictionBar-2).all())
                self.assertTrue((audit.trainingRows==60).all())
                artifact=full["generatedData"];raw=base64.b64decode(artifact["base64"],validate=True)
                self.assertEqual(hashlib.sha256(raw).hexdigest(),artifact["sha256"])
                state=json.loads(raw);self.assertEqual(state["operation"],name);self.assertLess(state["trainLastOutcomeBar"],len(b))

    def test_linear_and_ridge_equal_independent_matrix_solve(self):
        b=fixture();p=params();x=features(b).to_numpy();h=p['horizon'];y=b.close.shift(-h)/b.close-1
        for name in ('linear','ridge'):
            r=calculate(name,b,p);audit=table(r,'training-audit').iloc[0];i=int(audit.predictionBar)
            train=np.arange(int(audit.firstFeatureBar),int(audit.lastFeatureBar)+1);a=x[train]
            means=a.mean(axis=0);scale=a.std(axis=0,ddof=0);scale[scale==0]=1
            z=(a-means)/scale;current=(x[i]-means)/scale;targets=y.iloc[train].to_numpy()
            if name=='linear':
                beta=np.linalg.lstsq(np.column_stack([np.ones(len(z)),z]),targets,rcond=None)[0]
                expected=np.r_[1,current]@beta
            else:
                beta=np.linalg.solve(z.T@z+p['alpha']*np.eye(z.shape[1]),z.T@(targets-targets.mean()))
                expected=targets.mean()+current@beta
            self.assertAlmostEqual(table(r,'indicators').prediction.iloc[i],expected,places=11)
            preprocessing=table(r,'training-preprocessing');first=preprocessing[preprocessing.fitId==1]
            np.testing.assert_allclose(first['mean'],means);np.testing.assert_allclose(first.scale,scale)

    def test_evaluation_only_appears_when_outcome_matures(self):
        b=fixture();p=params();r=calculate('ridge',b,p);pred=table(r,'indicators');eva=table(r,'matured-evaluation')
        self.assertTrue((eva.outcomeBar-eva.predictionBar==3).all())
        self.assertEqual(eva.time.iloc[0],b.time.iloc[int(eva.outcomeBar.iloc[0])])
        self.assertAlmostEqual(eva.actual.iloc[0],b.close.iloc[int(eva.outcomeBar.iloc[0])]/b.close.iloc[int(eva.predictionBar.iloc[0])]-1)
        self.assertAlmostEqual(eva.cumulativeMse.iloc[-1],np.mean((eva.actual-eva.predicted)**2))
        self.assertEqual(pred.prediction.notna().sum()-len(eva),3)
        self.assertNotIn('actual',pred.columns)

    def test_single_class_is_explicit_prior_not_fake_fit(self):
        b=fixture();b['close']=100*1.01**np.arange(len(b));b['open']=b.close;b['high']=b.close*1.001;b['low']=b.close*.999
        r=calculate('logistic',b,params());a=table(r,'training-audit');pred=table(r,'indicators')
        self.assertTrue(a.fitStatus.eq('constant-single-class').all());self.assertTrue(pred.prediction.dropna().eq(1.).all())
        self.assertTrue(table(r,'matured-evaluation').cumulativeMse.eq(0.).all())

    def test_missing_features_and_insufficient_data_fail_explicitly(self):
        with self.assertRaisesRegex(ValueError,'Not enough'):calculate('ridge',fixture(70),params())
        b=fixture();b['volume']=0
        with self.assertRaisesRegex(ValueError,'Not enough'):calculate('ridge',b,params())
        b=fixture(1200);p=params();p['trainingRows']=40;p['retrainEvery']=1
        with self.assertRaisesRegex(ValueError,'1000'):calculate('ridge',b,p)

    def test_changed_future_does_not_change_earlier_learning_state(self):
        b=fixture();changed=b.copy();changed.loc[210:,['open','high','low','close']]*=7;changed.loc[210:,'volume']*=23
        for name in ('ridge','random-forest','lightgbm'):
            a=calculate(name,b,params());c=calculate(name,changed,params())
            for t in a['tables']:
                x=table(a,t['id']);y=table(c,t['id']);cutoff=b.time.iloc[209]
                pd.testing.assert_frame_equal(x[x.time<=cutoff].reset_index(drop=True),y[y.time<=cutoff].reset_index(drop=True),check_dtype=False,atol=1e-10,rtol=1e-10)


if __name__=='__main__':unittest.main()
