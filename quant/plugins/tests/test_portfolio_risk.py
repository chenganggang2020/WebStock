"""Flow-adjusted risk, independent risk budgets, fees and causal ledger checks."""
import argparse
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from portfolio_contract import load_portfolio
from portfolio_risk import calculate,solve_budget,post_fee_rebalance
from test_learning_models import table
from test_econometric_panel import fixture as panel_fixture,validated as panel_validated


def fixture(n=320):
    rng=np.random.default_rng(9174);ret=rng.normal(.0004,.008,n);equity=100000.;rows=[]
    for i,time in enumerate(pd.date_range('2020-01-01',periods=n,tz='UTC')):
        flow=1000. if i and i%31==0 else -500. if i and i%23==0 else 0.
        if i:equity=equity*(1+ret[i])+flow
        rows.append(dict(time=time.isoformat(),valuationat=time.isoformat(),availableat=time.isoformat(),equity=equity,
            externalflow=flow,flowtiming='end',feesincluded='true',currency='CNY',source='synthetic-test-v1',datasetkind='synthetic-test'))
    return pd.DataFrame(rows)


def validated(b):
    with tempfile.TemporaryDirectory() as tmp:
        p=Path(tmp)/'ledger.csv';b.to_csv(p,index=False);return load_portfolio(p)


def params():return dict(period=40,annualBars=252,minimumReturnPerBar=0.,targetVolatility=.15,maxExposure=.9,
    symbols='000001,000002',riskBudgets='1,2',rebalanceEvery=20,shrinkage=.1,maxSecurityWeight=.6,capital=100000.,feeBps=5.)


class PortfolioRiskTests(unittest.TestCase):
    def test_cashflows_do_not_become_returns_or_hide_drawdown(self):
        b=fixture(4);b['equity']=[100.,160.,144.,170.];b['externalflow']=[0.,50.,0.,10.]
        result=calculate('equity-drawdown',validated(b),{**params(),'period':2});out=table(result,'indicators')
        np.testing.assert_allclose(out.unitNav,[1.,1.1,.99,1.1],atol=1e-12)
        np.testing.assert_allclose(out.drawdown,[0.,0.,-.1,0.],atol=1e-12)
        self.assertAlmostEqual(out.downsideDeviation.iloc[2],np.sqrt(.01/2*252),places=12)
        self.assertAlmostEqual(out.maximumDrawdownToDate.iloc[-1],-.1,places=12)

    def test_target_volatility_matches_independent_sample_risk_and_zero_is_unavailable(self):
        b=validated(fixture());p=params();out=table(calculate('target-volatility',b,p),'indicators')
        ret=(b.equity-b.externalflow)/b.equity.shift()-1
        sigma=np.std(ret.iloc[1:41],ddof=1)*np.sqrt(252)
        self.assertAlmostEqual(out.proposedExposure.iloc[40],min(.9,.15/sigma),places=12)
        b['equity']=100000.;b['externalflow']=0.;out=table(calculate('target-volatility',b,p),'indicators')
        self.assertTrue(out.proposedExposure.isna().all());self.assertTrue(out.exposureStatus.iloc[40:].eq('zero-risk-estimate-unavailable').all())

    def test_all_risk_results_preserve_history_prefix(self):
        for name in ('equity-drawdown','target-volatility','risk-budget'):
            b=panel_validated(panel_fixture(240)) if name=='risk-budget' else validated(fixture(240))
            times=sorted(b.time.unique());cut=times[179];a=calculate(name,b,params());c=calculate(name,b[b.time<=cut].copy(),params())
            for t in a['tables']:
                x=table(a,t['id']);y=table(c,t['id']);x=x[pd.to_datetime(x.time,utc=True)<=cut].reset_index(drop=True)
                pd.testing.assert_frame_equal(x,y,check_dtype=False,rtol=1e-10,atol=1e-10)

    def test_risk_budget_diagonal_solution_and_correlated_contributions(self):
        budget=np.array([.2,.3,.5]);sigma=np.array([.1,.2,.3]);cov=np.diag(sigma**2)
        w,_,err=solve_budget(cov,budget);expected=np.sqrt(budget)/sigma;expected/=expected.sum()
        np.testing.assert_allclose(w,expected,atol=1e-10);self.assertLess(err,1e-10)
        cov=np.array([[.04,.006,-.001],[.006,.09,.003],[-.001,.003,.01]])
        w,_,_=solve_budget(cov,budget);np.testing.assert_allclose(w*(cov@w)/(w@cov@w),budget,atol=1e-9)

    def test_first_fee_has_closed_form_and_accounting_never_borrows(self):
        values,cash,fee=post_fee_rebalance(100000.,np.zeros(2),np.array([.4,.6]),.001)
        self.assertAlmostEqual(values.sum(),100000/1.001,places=8);self.assertAlmostEqual(cash,0.,places=8)
        self.assertAlmostEqual(fee,values.sum()*.001,places=8)
        values,cash,fee=post_fee_rebalance(110000.,np.array([50000.,55000.]),np.zeros(2),.001)
        self.assertEqual(fee,105.);self.assertEqual(cash,109895.);self.assertEqual(values.sum(),0.)

    def test_actual_orders_prices_cash_positions_and_risk_constraints_reconcile(self):
        b=panel_validated(panel_fixture(240));p=params();r=calculate('risk-budget',b,p)
        equity=table(r,'equity');orders=table(r,'orders');positions=table(r,'positions');weights=table(r,'target-weights')
        self.assertTrue((orders.executionBar-orders.signalBar).eq(1).all())
        price=b.pivot(index='time',columns='symbol',values='close');shares={s:0. for s in ['000001','000002']};cash=p['capital']
        for i,row in equity.iterrows():
            trades=orders[orders.time.eq(row.time)];hold=positions[positions.time.eq(row.time)]
            for trade in trades.itertuples():
                self.assertAlmostEqual(trade.price,price.loc[pd.Timestamp(trade.time),trade.symbol],places=12)
                self.assertAlmostEqual(trade.fee,abs(trade.quantity*trade.price)*.0005,places=8)
                cash-=trade.quantity*trade.price+trade.fee;shares[trade.symbol]+=trade.quantity
            self.assertAlmostEqual(cash,row.cash,places=7);self.assertGreaterEqual(row.cash,0.)
            value=cash+sum(shares[s]*price.loc[pd.Timestamp(row.time),s] for s in shares)
            self.assertAlmostEqual(value,row.equity,places=7)
            for h in hold.itertuples():self.assertAlmostEqual(h.quantity,shares[h.symbol],places=9)
        self.assertTrue(weights.targetWeight.le(.6+1e-12).all());self.assertTrue(weights.groupby('time').targetWeight.sum().le(.9+1e-12).all())
        np.testing.assert_allclose(weights.riskContributionFraction,weights.riskBudget,atol=1e-9)

    def test_inactive_members_liquidate_next_input_and_missing_prices_are_rejected(self):
        b=panel_validated(panel_fixture(240));times=sorted(b.time.unique());mask=b.time>=times[100]
        # Keep unrelated benchmark/member rows, as required by the panel contract.
        b.loc[mask & b.symbol.isin(['000001','000002']),'member']=0
        r=calculate('risk-budget',b,params());equity=table(r,'equity')
        self.assertAlmostEqual(equity.cash.iloc[101],equity.equity.iloc[101],places=8)
        self.assertTrue(table(r,'risk-audit').status.eq('no-active-members-cash').any())
        missing=b.drop(b.index[b.symbol.eq('000002')][120])
        with self.assertRaisesRegex(ValueError,'synchronized'):calculate('risk-budget',missing,params())

    def test_invalid_ledger_claims_and_zero_covariance_fail(self):
        original=fixture()
        for column,value in [('feesincluded','false'),('flowtiming','begin'),('currency','EUR'),('source',''),('equity',0.),('availableat','2099-01-01T00:00:00Z')]:
            b=original.copy();b.loc[50,column]=value
            with self.subTest(column=column),self.assertRaises(ValueError):validated(b)
        b=original.copy();b.loc[0,'externalflow']=1
        with self.assertRaises(ValueError):validated(b)
        b=panel_validated(panel_fixture(120));b['close']=100.
        with self.assertRaisesRegex(ValueError,'No valid'):calculate('risk-budget',b,params())
        with self.assertRaisesRegex(ValueError,'risk budget'):calculate('risk-budget',b,{**params(),'riskBudgets':'1,-2'})

    def test_delayed_source_does_not_allow_filling_a_past_close(self):
        b=panel_validated(panel_fixture(120));b['time']=b.time+pd.Timedelta(days=3)
        with self.assertRaisesRegex(ValueError,'already occurred'):calculate('risk-budget',b,params())


if __name__=='__main__':
    if '--write-fixture' in sys.argv:
        parser=argparse.ArgumentParser();parser.add_argument('--write-fixture',type=Path,required=True);args=parser.parse_args()
        fixture().to_csv(args.write_fixture,index=False)
    else:unittest.main()
