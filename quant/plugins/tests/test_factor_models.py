"""Independent PCA eigensolve, exact ranks/ties, causal signals and cash accounting."""
import argparse
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from factor_models import calculate
from learning_models import features
from test_learning_models import fixture as bars,table
from test_econometric_panel import fixture as market_panel
from test_panel_research import validated


def fixture(n=400):
    b=market_panel(n+20)
    for _,group in b.groupby('symbol'):
        r=group.close.pct_change(fill_method=None)
        b.loc[group.index,'factor_momentum']=group.close.pct_change(20,fill_method=None)
        b.loc[group.index,'factor_lowvol']=-r.rolling(20).std(ddof=1)
    b=b.iloc[80:].copy().reset_index(drop=True)
    for key in ('factor_momentum','factor_lowvol'):b[key+'_knownat']=b.time
    return b


def params():return dict(trainingRows=60,retrainEvery=30,components=3,symbols='000001,000002,000003',
    factorColumns='factor_momentum,factor_lowvol',factorWeights='1,2',topCount=1,minimumScore=.1,
    rebalanceEvery=10,maxExposure=.9,maxSecurityWeight=.6,capital=100000.,feeBps=5.)


class FactorTests(unittest.TestCase):
    def test_pca_matches_independent_eigendecomposition_and_saved_loadings(self):
        b=bars();p=params();r=calculate('trailing-pca',b,p);out=table(r,'indicators');loads=table(r,'loadings')
        x=features(b).to_numpy();sample=x[20:80];mu=sample.mean(axis=0);sd=sample.std(axis=0);z=(sample-mu)/sd
        eigen,axes=np.linalg.eigh(np.cov(z,rowvar=False,ddof=1));axes=axes[:,::-1].T[:3]
        for row in axes:
            if row[np.argmax(np.abs(row))]<0:row*=-1
        current=(x[80]-mu)/sd-z.mean(axis=0);expected=current@axes.T
        np.testing.assert_allclose(out.loc[80,['PC1','PC2','PC3']].astype(float),expected,atol=1e-11)
        saved=loads[loads.fitId.eq(0)]
        np.testing.assert_allclose(saved.loading.to_numpy().reshape(3,7),axes,atol=1e-11)
        np.testing.assert_allclose(saved.groupby('component').explainedFraction.first(),eigen[::-1][:3]/eigen.sum(),atol=1e-12)
        self.assertAlmostEqual(out.reconstructionRmseStandardized.iloc[80],np.sqrt(np.mean((current-expected@axes)**2)),places=12)
        audit=table(r,'training-audit');self.assertTrue((audit.lastTrainingBar<audit.observationBar).all())

    def test_all_operations_prefix_and_future_perturbation_preserve_past(self):
        for name in ('trailing-pca','factor-score','ranked-portfolio'):
            b=bars(260) if name=='trailing-pca' else validated(fixture(240));cut=sorted(b.time.unique())[179]
            prefix=b[b.time<=cut].copy();changed=b.copy();future=changed.time>cut
            for key in ('open','high','low','close'):changed.loc[future,key]*=5
            if name!='trailing-pca':changed['factor_momentum']=changed.factor_momentum.astype(float);changed.loc[future,'factor_momentum']+=1000
            original=calculate(name,b,params());short=calculate(name,prefix,params());altered=calculate(name,changed,params())
            for t in original['tables']:
                x=table(original,t['id']);y=table(short,t['id']);z=table(altered,t['id'])
                if 'time' in x:
                    x=x[pd.to_datetime(x.time,utc=True)<=pd.to_datetime(cut,utc=True)].reset_index(drop=True)
                    z=z[pd.to_datetime(z.time,utc=True)<=pd.to_datetime(cut,utc=True)].reset_index(drop=True)
                pd.testing.assert_frame_equal(x,y,check_dtype=False,atol=1e-10,rtol=1e-10)
                pd.testing.assert_frame_equal(x,z,check_dtype=False,atol=1e-10,rtol=1e-10)

    def test_current_observation_cannot_change_current_pca_fit(self):
        b=bars();changed=b.copy();changed.loc[80,['open','high','low','close']]*=2
        a=calculate('trailing-pca',b,params());c=calculate('trailing-pca',changed,params())
        x=table(a,'loadings');y=table(c,'loadings');pd.testing.assert_frame_equal(x[x.fitId.eq(0)],y[y.fitId.eq(0)])
        self.assertNotAlmostEqual(table(a,'indicators').PC1.iloc[80],table(c,'indicators').PC1.iloc[80])

    def test_rank_deficiency_and_missing_feature_do_not_create_fitted_values(self):
        b=bars(180);b[['open','high','low','close']]=100.;b.volume=1000.
        r=calculate('trailing-pca',b,params());self.assertEqual(r['modelSemantics']['successfulFits'],0)
        self.assertTrue(table(r,'indicators').PC1.isna().all());self.assertTrue(table(r,'training-audit').status.eq('unavailable').all())
        b=bars(180);b.loc[60:80,'volume']=0
        r=calculate('trailing-pca',b,params());self.assertEqual(table(r,'indicators').status.iloc[80],'current-features-unavailable')

    def test_exact_average_ranks_signed_weights_and_ties(self):
        b=validated(fixture(4));b['member']=b.symbol.ne('BENCH').astype(int)
        b['factor_momentum']=b.symbol.map({'000001':10.,'000002':20.,'000003':20.,'BENCH':0.})
        b['factor_lowvol']=7.
        p={**params(),'factorWeights':'-2,1'};r=calculate('factor-score',b,p);s=table(r,'scores').iloc[:3]
        np.testing.assert_allclose(s.rank_factor_momentum,[-1.,.5,.5]);np.testing.assert_allclose(s.rank_factor_lowvol,0.)
        np.testing.assert_allclose(s.score,[2/3,-1/3,-1/3])
        p={**params(),'factorWeights':'1,0','topCount':1,'minimumScore':0.}
        r=calculate('ranked-portfolio',b,p);targets=table(r,'target-weights')
        np.testing.assert_allclose(targets.targetWeight,[0.,.45,.45]);self.assertEqual(table(r,'selection-audit').chosenCount.iloc[0],2)
        equity=table(r,'equity');self.assertEqual(equity.cash.iloc[0],p['capital'])
        expected_post=100000/(1+.0005*.9);self.assertAlmostEqual(equity.equity.iloc[1],expected_post,places=7)
        self.assertAlmostEqual(equity.cash.iloc[1],expected_post*.1,places=7)

    def test_orders_cash_positions_membership_and_last_signal(self):
        b=validated(fixture(81));times=sorted(b.time.unique());b.loc[(b.time>=times[40]) & b.symbol.ne('BENCH'),'member']=0
        p=params();r=calculate('ranked-portfolio',b,p);equity=table(r,'equity');orders=table(r,'orders');positions=table(r,'positions')
        prices=b.pivot(index='time',columns='symbol',values='close');cash=p['capital'];shares={s:0. for s in p['symbols'].split(',')}
        self.assertTrue((orders.executionBar-orders.signalBar).eq(1).all());self.assertLess(orders.signalBar.max(),80)
        for row in equity.itertuples():
            for trade in orders[orders.time.eq(row.time)].itertuples():
                self.assertAlmostEqual(trade.price,prices.loc[pd.Timestamp(row.time),trade.symbol],places=12)
                self.assertAlmostEqual(trade.fee,abs(trade.price*trade.quantity)*.0005,places=10)
                cash-=trade.quantity*trade.price+trade.fee;shares[trade.symbol]+=trade.quantity
            self.assertAlmostEqual(row.cash,cash,places=7);self.assertGreaterEqual(row.cash,0)
            self.assertAlmostEqual(row.equity,cash+sum(shares[s]*prices.loc[pd.Timestamp(row.time),s] for s in shares),places=7)
            for position in positions[positions.time.eq(row.time)].itertuples():self.assertAlmostEqual(position.quantity,shares[position.symbol],places=8)
        self.assertAlmostEqual(equity.equity.iloc[41],equity.cash.iloc[41],places=8)

    def test_unavailable_factors_future_claims_and_delayed_execution_rejected(self):
        for key,value in [('factor_momentum',''),('factor_momentum_knownat','2099-01-01T00:00:00Z')]:
            b=fixture(50);b[key]=value
            with self.assertRaises(ValueError):calculate('factor-score',validated(b),params())
        b=validated(fixture(50))
        for alteration in ({'factorWeights':'0,0'},{'factorColumns':'close,volume'},{'symbols':'000001,000001'}):
            with self.assertRaises(ValueError):calculate('factor-score',b,{**params(),**alteration})
        delayed=b.copy();delayed.time+=pd.Timedelta(days=3)
        with self.assertRaisesRegex(ValueError,'already occurred'):calculate('ranked-portfolio',delayed,params())
        with self.assertRaisesRegex(ValueError,'synchronized'):calculate('factor-score',b.drop(b.index[1]),params())

    def test_single_member_is_unavailable_and_symbol_order_does_not_break_ties(self):
        b=validated(fixture(10));b['member']=b.symbol.eq('000001').astype(int)
        r=calculate('ranked-portfolio',b,params());self.assertTrue(table(r,'scores').score.isna().all())
        self.assertEqual(len(table(r,'orders')),0);self.assertTrue(table(r,'equity').cash.eq(100000.).all())
        b=validated(fixture(10));b['factor_momentum']=5.;b['factor_lowvol']=2.
        p={**params(),'factorWeights':'1e308,-1e308','minimumScore':0.,'topCount':1}
        a=table(calculate('ranked-portfolio',b,p),'target-weights').sort_values(['time','symbol']).reset_index(drop=True)
        c=table(calculate('ranked-portfolio',b,{**p,'symbols':'000003,000001,000002'}),'target-weights').sort_values(['time','symbol']).reset_index(drop=True)
        pd.testing.assert_frame_equal(a,c);np.testing.assert_allclose(a.targetWeight,.3)


if __name__=='__main__':
    if '--write-fixture' in sys.argv:
        parser=argparse.ArgumentParser();parser.add_argument('--write-fixture',type=Path,required=True);args=parser.parse_args()
        fixture().to_csv(args.write_fixture,index=False)
    else:unittest.main()
