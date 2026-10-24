"""Historical membership, availability, missingness and numerical tests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from panel_contract import load_panel
from panel_research import calculate


PARAMETERS={"market-breadth":{"period":20},"beta-correlation":{"period":20,"benchmark":"BENCH"},
    "cross-sectional-momentum":{"period":20,"skip":1},"cross-sectional-reversal":{"period":20},
    "industry-relative-strength":{"period":20,"benchmark":"BENCH"},"equal-cap-weight-indices":{},
    "cross-sectional-dispersion":{"period":20},"free-float-turnover":{},"actual-participation":{}}


def fixture(n=80):
    rng=np.random.default_rng(935);r=rng.normal(.001,.01,n);rows=[]
    prices={s:100*np.cumprod(1+factor*r) for s,factor in (("000001",1),("000002",2),("000003",-1),("BENCH",1))}
    for i,day in enumerate(pd.date_range("2020-01-01",periods=n,tz="UTC")):
        decision=day+pd.Timedelta(hours=16);end=day+pd.Timedelta(hours=15)
        for j,(symbol,values) in enumerate(prices.items()):
            close=values[i];member=symbol!="BENCH" and (symbol!="000003" or i>=20)
            rows.append({"time":decision.isoformat(),"symbol":symbol,"barend":end.isoformat(),"availableat":(end+pd.Timedelta(seconds=1)).isoformat(),
                "membershipknownat":day.isoformat(),"member":int(member),"universecount":3 if i>=20 else 2,
                "open":close,"close":close,"high":close*1.01,"low":close*.99,"volume":1000.,"currency":"CNY","volumeunit":"share",
                "pricebasis":"total-return","isclosed":True,"datasetkind":"synthetic-test","industry":"I1" if j<2 else "I2","industry_knownat":day.isoformat(),
                "marketcap":(j+1)*1000000.,"marketcap_knownat":day.isoformat(),"freefloatshares":100000.,"freefloatshares_knownat":day.isoformat(),
                "executedshares":100.,"executedshares_knownat":(end+pd.Timedelta(seconds=1)).isoformat()})
    return pd.DataFrame(rows)


def validated(frame):
    with tempfile.TemporaryDirectory() as directory:
        p=Path(directory)/"panel.csv";frame.to_csv(p,index=False);return load_panel(p)


def result_frame(result,number=0):
    t=result['tables'][number];return pd.DataFrame(t['rows'],columns=t['columns'])


class PanelTests(unittest.TestCase):
    def test_future_claims_incomplete_universe_and_naive_times_rejected(self):
        b=fixture(8)
        mutations=[lambda a:a.assign(availableat="2030-01-01T00:00:00Z"),
            lambda a:a.assign(membershipknownat="2030-01-01T00:00:00Z"),
            lambda a:a.assign(industry_knownat="2030-01-01T00:00:00Z"),
            lambda a:a.assign(time="2020-01-01 16:00:00"),lambda a:a.assign(universecount=99),
            lambda a:a[a.symbol!="000002"],lambda a:pd.concat([a,a.iloc[:1]]),lambda a:a.assign(isclosed=False),
            lambda a:a.assign(volumeunit="lot"),lambda a:a.assign(barend="2030-01-01T00:00:00Z")]
        for mutate in mutations:
            with self.subTest(mutation=mutate),self.assertRaises(ValueError):validated(mutate(b.copy()))
        good=validated(b);self.assertIn("000001",good.symbol.tolist())

    def test_every_operation_preserves_historical_prefix(self):
        b=validated(fixture());prefix=b[b.time<=b.time.unique()[59]].copy()
        for name,params in PARAMETERS.items():
            with self.subTest(operation=name):
                full=calculate(name,b,params);short=calculate(name,prefix,params)
                for t,u in zip(full['tables'],short['tables']):
                    if t['id']=='latest-correlation-matrix':continue
                    old=pd.DataFrame(t['rows'],columns=t['columns']);new=pd.DataFrame(u['rows'],columns=u['columns'])
                    old=old[pd.to_datetime(old.time,utc=True)<=prefix.time.max()].reset_index(drop=True)
                    pd.testing.assert_frame_equal(old,new,check_dtype=False,atol=1e-10,rtol=1e-10)

    def test_beta_and_matrix_for_known_two_times_returns(self):
        b=validated(fixture());a=result_frame(calculate("beta-correlation",b,PARAMETERS['beta-correlation']))
        values=a[a.symbol=="000002"].beta.dropna()
        np.testing.assert_allclose(values,2,rtol=1e-10,atol=1e-10)
        matrix=result_frame(calculate("beta-correlation",b,PARAMETERS['beta-correlation']),1)
        row=matrix[(matrix.symbolA=="000001")&(matrix.symbolB=="000003")].iloc[0]
        self.assertAlmostEqual(row.correlation,-1);self.assertEqual(row.observations,20)

    def test_breadth_counts_follow_historical_membership(self):
        b=validated(fixture());out=result_frame(calculate("market-breadth",b,{"period":3}))
        self.assertEqual(out.universeCount.iloc[19],2);self.assertEqual(out.universeCount.iloc[20],3)
        self.assertEqual(out.returnCoverage.iloc[0],0)
        np.testing.assert_allclose(out.advances+out.declines+out.unchanged,out.returnCoverage)
        self.assertTrue(out.mcclellanRatioAdjusted.iloc[:39].isna().all())
        np.testing.assert_allclose(out.advancePct.iloc[1:],100*out.advances.iloc[1:]/out.returnCoverage.iloc[1:])
        np.testing.assert_allclose(out.mcclellanSummation.iloc[39:],out.mcclellanRatioAdjusted.iloc[39:].cumsum())

    def test_indices_use_previous_caps_and_do_not_drop_missing_holdings(self):
        raw=fixture(8);b=validated(raw);original=result_frame(calculate("equal-cap-weight-indices",b,{}))
        prices=b.pivot(index='time',columns='symbol',values='close');r=prices.pct_change(fill_method=None).iloc[1]
        self.assertAlmostEqual(original.equalWeightReturn.iloc[1],(r['000001']+r['000002'])/2)
        self.assertAlmostEqual(original.capWeightReturn.iloc[1],(r['000001']+2*r['000002'])/3)
        changed=raw.copy();stamp=changed.time.unique()[3]
        changed.loc[(changed.time==stamp)&(changed.symbol=='000001'),'marketcap']=1e15
        revised=result_frame(calculate("equal-cap-weight-indices",validated(changed),{}))
        np.testing.assert_allclose(original.capWeightReturn.iloc[1:4],revised.capWeightReturn.iloc[1:4])
        self.assertNotAlmostEqual(original.capWeightReturn.iloc[4],revised.capWeightReturn.iloc[4])
        # A removed member can be absent now; a portfolio which held it yesterday
        # still needs its terminal return. Universe-count checks alone cannot fix this.
        missing=raw[~((raw.time==stamp)&(raw.symbol=='000002'))].copy()
        missing.loc[missing.time==stamp,'universecount']=1
        broken=result_frame(calculate("equal-cap-weight-indices",validated(missing),{}))
        self.assertTrue(broken.equalWeightIndex.iloc[3:].isna().all())

    def test_actual_shares_and_execution_are_required(self):
        b=validated(fixture(8))
        turnover=result_frame(calculate("free-float-turnover",b,{}));np.testing.assert_allclose(turnover.turnoverPct,1.)
        participation=result_frame(calculate("actual-participation",b,{}));np.testing.assert_allclose(participation.participationPct,10.)
        with self.assertRaises(ValueError):calculate("free-float-turnover",b.drop(columns='freefloatshares_knownat'),{})
        b.loc[0,'volume']=0
        with self.assertRaises(ValueError):calculate("actual-participation",b,{})

    def test_momentum_ranking_and_industry_wealth_ratio(self):
        b=validated(fixture());out=result_frame(calculate("cross-sectional-momentum",b,{"period":3,"skip":1}))
        close=b.pivot(index='time',columns='symbol',values='close')
        row=out[(out.time==str(close.index[10]))&(out.symbol=='000001')].iloc[0]
        self.assertAlmostEqual(row.pastReturn,close['000001'].iloc[9]/close['000001'].iloc[6]-1)
        relative=result_frame(calculate('industry-relative-strength',b,{'period':3,'benchmark':'BENCH'}))
        np.testing.assert_allclose(relative.loc[relative.symbol=='000001','relativeToBenchmark'].dropna(),0,atol=1e-12)
        self.assertTrue(relative.industryCoverage.ge(0).all())


if __name__=='__main__':
    if '--write-fixture' in sys.argv:
        target=Path(sys.argv[sys.argv.index('--write-fixture')+1]);target.parent.mkdir(parents=True,exist_ok=True)
        fixture().to_csv(target,index=False);print(json.dumps({'fixture':str(target),'synthetic':True,'rows':320}))
    else:unittest.main(verbosity=2)
