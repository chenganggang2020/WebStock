"""Availability and hand-calculated reported-factor cases; all synthetic."""
import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fundamental_research import calculate, OPERATIONS
from test_panel_research import fixture as panel_fixture, validated, result_frame


VALUES={"assets_y0":120.,"assets_y1":100.,"assets_y2":90.,"assets_y3":80.,"assets_y4":70.,"assets_y5":60.,
    "netincome_y0":12.,"netincome_y1":9.,"netincome_y2":7.,"netincome_y3":4.,"netincome_y4":3.,
    "bookequity_y0":60.,"bookequity_y1":50.,"cfo_y0":15.,"interestdebt_y0":30.,"preferredstock_y0":5.,
    "minorityinterest_y0":7.,"cash_y0":10.,"ebitda_y0":20.,"sales_y0":100.,"sales_y1":80.,
    "grossprofit_y0":30.,"grossprofit_y1":20.,"operatingprofit_y0":18.,"liabilities_y0":60.,"capex_y0":8.,
    "cashdividends_paid_y0":6.,"income_before_extra_y0":12.,"income_before_extra_y1":9.,
    "longtermdebt_includingcurrent_y0":10.,"longtermdebt_includingcurrent_y1":20.,
    "currentassets_y0":50.,"currentassets_y1":30.,"currentliabilities_y0":20.,"currentliabilities_y1":20.,"equity_issued_y0":0.,
    "marketcap":1000.,"freefloatmarketcap":600.,"eps_actual":1.2,"eps_consensus":1.,"eps_consensus_std":.1,
    "forecast_old":1.,"forecast_new":1.1,"shares_begin":100.,"shares_end":203.,"splitfactor":2.,
    "shares_issued":5.,"shares_repurchased":3.,"repurchase_announced":10.,"other_share_changes":1.}

FIELDS={
    "reported-valuation":["marketcap","netincome_y0","bookequity_y0","cfo_y0","interestdebt_y0","preferredstock_y0","minorityinterest_y0","cash_y0","ebitda_y0"],
    "reported-profitability":["assets_y0","assets_y1","bookequity_y0","bookequity_y1","netincome_y0","sales_y0","grossprofit_y0","operatingprofit_y0"],
    "reported-quality":["assets_y"+str(i) for i in range(6)]+["netincome_y"+str(i) for i in range(5)]+["liabilities_y0"],
    "investment-accrual":["assets_y0","assets_y1","netincome_y0","cfo_y0","capex_y0"],
    "reported-dividends":["marketcap","cashdividends_paid_y0","netincome_y0","cfo_y0"],
    "size-ranks":["marketcap","freefloatmarketcap"],"low-risk-ranks":[],
    "piotroski-fscore":["assets_y0","assets_y1","assets_y2","income_before_extra_y0","income_before_extra_y1","cfo_y0",
        "longtermdebt_includingcurrent_y0","longtermdebt_includingcurrent_y1","currentassets_y0","currentassets_y1","currentliabilities_y0","currentliabilities_y1",
        "sales_y0","sales_y1","grossprofit_y0","grossprofit_y1","equity_issued_y0"],
    "earnings-surprise":["eps_actual","eps_consensus","eps_consensus_std"],"forecast-revision":["forecast_old","forecast_new"],
    "share-capital-events":["shares_begin","shares_end","splitfactor","shares_issued","shares_repurchased","repurchase_announced","other_share_changes"]}


def parameters(name):
    if name=="piotroski-fscore":return {"turnoverAssets":"beginning"}
    if name=="low-risk-ranks":return {"period":20,"annualBars":252,"benchmark":"BENCH"}
    return {}


def fixture(name):
    b=panel_fixture()
    base=["time","symbol","barend","availableat","membershipknownat","member","universecount","open","high","low","close","volume","currency","pricebasis","volumeunit","isclosed","datasetkind"]
    b=b[base].copy();b["financialunit"]="currency-unit"
    fields=FIELDS[name]
    lags=[int(key.rsplit('_y',1)[1]) for key in fields if '_y' in key]
    for lag in range(max(lags,default=-1)+1):b['fiscalend_y'+str(lag)]=str(2019-lag)+'-12-31'
    for key in fields:
        b[key]=VALUES[key]
        lag=int(key.rsplit('_y',1)[1]) if '_y' in key else 0
        b[key+'_knownat']=str(2020-lag)+'-01-01T00:00:00Z'
    if name=='reported-dividends' or name=='reported-valuation':b['fiscalend_y0']='2019-12-31'
    if name=='earnings-surprise':
        b['earningsperiod']='2019-12-31';b['eps_actual_knownat']='2020-01-01T13:00:00Z'
        for key in ('eps_consensus_knownat','eps_consensus_std_knownat'):b[key]='2019-12-30T15:00:00Z'
    if name=='forecast-revision':
        b['forecastperiod']='2020-12-31';b['forecast_old_knownat']='2019-12-31T12:00:00Z';b['forecast_new_knownat']='2020-01-01T13:00:00Z'
    if name=='share-capital-events':b['capitalperiod_start']='2019-01-01';b['capitalperiod_end']='2019-12-31'
    return b


class FundamentalTests(unittest.TestCase):
    def test_every_operation_validates_and_preserves_prefix(self):
        self.assertEqual(set(FIELDS),OPERATIONS)
        for name in sorted(OPERATIONS):
            with self.subTest(operation=name):
                b=validated(fixture(name));short=b[b.time<=b.time.unique()[59]].copy()
                full=result_frame(calculate(name,b,parameters(name)));prefix=result_frame(calculate(name,short,parameters(name)))
                full=full[pd.to_datetime(full.time,utc=True)<=short.time.max()].reset_index(drop=True)
                pd.testing.assert_frame_equal(full,prefix,check_dtype=False,rtol=1e-10,atol=1e-10)

    def test_valuation_and_negative_earnings_convention(self):
        b=validated(fixture('reported-valuation'));a=result_frame(calculate('reported-valuation',b,{})).iloc[0]
        self.assertAlmostEqual(a.earningsYield,.012);self.assertAlmostEqual(a.bookYield,.06)
        self.assertAlmostEqual(a.cashflowYield,.015);self.assertAlmostEqual(a.enterpriseValue,1032);self.assertAlmostEqual(a.evEbitda,51.6)
        b['netincome_y0']=-12
        a=result_frame(calculate('reported-valuation',b,{})).iloc[0]
        self.assertEqual(a.earningsYield,-.012);self.assertIsNone(a.priceEarnings)

    def test_profitability_investment_and_paid_dividends(self):
        a=result_frame(calculate('reported-profitability',validated(fixture('reported-profitability')),{})).iloc[0]
        self.assertAlmostEqual(a.roaAverageAssets,12/110);self.assertAlmostEqual(a.roeAverageEquity,12/55)
        self.assertAlmostEqual(a.grossMargin,.3);self.assertAlmostEqual(a.netMargin,.12)
        a=result_frame(calculate('investment-accrual',validated(fixture('investment-accrual')),{})).iloc[0]
        self.assertAlmostEqual(a.assetGrowth,.2);self.assertAlmostEqual(a.cashflowAccrualToAverageAssets,-3/110)
        a=result_frame(calculate('reported-dividends',validated(fixture('reported-dividends')),{})).iloc[0]
        self.assertAlmostEqual(a.reportedAnnualDividendYield,.006);self.assertAlmostEqual(a.earningsPayout,.5)

    def test_fscore_all_nine_signals_and_explicit_issuance(self):
        b=validated(fixture('piotroski-fscore'));a=result_frame(calculate('piotroski-fscore',b,parameters('piotroski-fscore'))).iloc[0]
        self.assertEqual(a.fscore,9);self.assertAlmostEqual(a.leverageCurrent,10/110)
        b['equity_issued_y0']=1
        self.assertEqual(result_frame(calculate('piotroski-fscore',b,parameters('piotroski-fscore'))).iloc[0].fscore,8)
        with self.assertRaises(ValueError):calculate('piotroski-fscore',b.drop(columns='equity_issued_y0'),parameters('piotroski-fscore'))
        b['equity_issued_y0']=0;b['sales_y1']=88
        self.assertEqual(result_frame(calculate('piotroski-fscore',b,{'turnoverAssets':'beginning'})).iloc[0].improvedTurnover,1)
        self.assertEqual(result_frame(calculate('piotroski-fscore',b,{'turnoverAssets':'average'})).iloc[0].improvedTurnover,0)

    def test_future_filing_bad_period_and_unknown_units_rejected(self):
        b=fixture('reported-profitability')
        bad=b.copy();bad['netincome_y0_knownat']='2030-01-01T00:00:00Z'
        with self.assertRaises(ValueError):validated(bad)
        bad=validated(b);bad['netincome_y0_knownat']='2019-01-01T00:00:00Z'
        with self.assertRaises(ValueError):calculate('reported-profitability',bad,{})
        bad=validated(b);bad['netincome_y0_knownat']='2019-12-31T12:00:00Z'
        with self.assertRaises(ValueError):calculate('reported-profitability',bad,{})
        bad=validated(b);bad['fiscalend_y1']='2019-09-30'
        with self.assertRaises(ValueError):calculate('reported-profitability',bad,{})
        bad=validated(b);bad['financialunit']='thousand-CNY'
        with self.assertRaises(ValueError):calculate('reported-profitability',bad,{})

    def test_surprise_uses_pre_announcement_snapshot_and_revision_same_horizon(self):
        b=validated(fixture('earnings-surprise'));a=result_frame(calculate('earnings-surprise',b,{})).iloc[0]
        self.assertAlmostEqual(a.epsDifference,.2);self.assertAlmostEqual(a.surpriseInForecastStd,2)
        b['eps_consensus_knownat']='2020-01-01T14:00:00Z'
        with self.assertRaises(ValueError):calculate('earnings-surprise',b,{})
        b=validated(fixture('forecast-revision'));a=result_frame(calculate('forecast-revision',b,{})).iloc[0]
        self.assertAlmostEqual(a.revision,.1);self.assertEqual(a.forecastPeriod,'2020-12-31')

    def test_share_changes_reconcile_split_and_execution(self):
        b=validated(fixture('share-capital-events'));a=result_frame(calculate('share-capital-events',b,{})).iloc[0]
        self.assertEqual(a.shareReconciliationResidual,0);self.assertEqual(a.netIssuedShares,2)
        self.assertAlmostEqual(a.splitAdjustedShareChange,.015);self.assertAlmostEqual(a.repurchaseCompletion,.3)
        b['shares_end']=210
        self.assertEqual(result_frame(calculate('share-capital-events',b,{})).iloc[0].shareReconciliationResidual,7)

    def test_quality_uses_five_distinct_years_and_low_risk_keeps_beta_sign(self):
        b=validated(fixture('reported-quality'));a=result_frame(calculate('reported-quality',b,{})).iloc[0]
        self.assertAlmostEqual(a.roaBeginningAssets,.12)
        self.assertAlmostEqual(a.roaFiveYearStd,np.std([.12,.1,7/80,4/70,.05]))
        self.assertAlmostEqual(a.liabilitiesToAssets,.5)
        b=validated(fixture('low-risk-ranks'));a=result_frame(calculate('low-risk-ranks',b,parameters('low-risk-ranks')))
        latest=a[a.time==a.time.max()].set_index('symbol')
        self.assertAlmostEqual(latest.loc['000002','beta'],2)
        self.assertAlmostEqual(latest.loc['000003','beta'],-1)
        self.assertAlmostEqual(latest.loc['000002','annualVolatility']/latest.loc['000001','annualVolatility'],2)
        self.assertGreater(latest.loc['000003','lowBetaRank'],latest.loc['000002','lowBetaRank'])

    def test_size_rank_uses_historical_members_and_valid_free_float(self):
        b=validated(fixture('size-ranks'))
        b['marketcap']=b.symbol.map({'000001':1000.,'000002':2000.,'000003':3000.,'BENCH':999999.})
        a=result_frame(calculate('size-ranks',b,{}));latest=a[a.time==a.time.max()].set_index('symbol')
        self.assertAlmostEqual(latest.loc['000001','marketCapPercentile'],1/3)
        self.assertAlmostEqual(latest.loc['000003','marketCapPercentile'],1)
        self.assertNotIn('BENCH',latest.index)
        b['freefloatmarketcap']=1e9
        with self.assertRaises(ValueError):calculate('size-ranks',b,{})


if __name__=='__main__':
    if '--write-fixtures' in sys.argv:
        target=Path(sys.argv[sys.argv.index('--write-fixtures')+1]);target.mkdir(parents=True,exist_ok=True)
        for name in sorted(OPERATIONS):fixture(name).to_csv(target/(name+'.csv'),index=False)
        print('Wrote 11 explicitly synthetic financial fixtures')
    else:unittest.main(verbosity=2)
