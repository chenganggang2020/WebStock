from pathlib import Path
import sys
import unittest
from decimal import Decimal,ROUND_HALF_UP
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from hikyuu_adapter import calculate

PARAMETERS=dict(fast=5,slow=15,capital=100000.,quantity=100)


def fixture(n=220):
    x=np.arange(n);close=100+.03*x+8*np.sin(x/9)
    opening=np.r_[close[0],close[:-1]]+.15
    return pd.DataFrame(dict(time=pd.date_range('2020-01-01',periods=n).astype(str),open=opening,
        high=np.maximum(opening,close)+1,low=np.minimum(opening,close)-1,close=close,volume=10000.,amount=10000.*close))


def frame(r,name):
    t=next(t for t in r['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class HikyuuAdapter(unittest.TestCase):
    def test_date_roundtrip_initial_capital_and_independent_event_ledger(self):
        b=fixture();r=calculate(b,PARAMETERS);equity=frame(r,'equity');trades=frame(r,'trades')
        self.assertEqual(pd.Timestamp(trades.datetime.iloc[0]),pd.Timestamp(b.time.iloc[0]));self.assertEqual(equity.equity.iloc[0],100000.)
        self.assertTrue(pd.to_datetime(trades.datetime).dt.year.eq(2020).all())
        events=trades[trades.business.isin(['BUY','SELL'])];self.assertGreater(len(events),4)
        delta=pd.Series(0.,index=pd.to_datetime(b.time));cash_delta=delta.copy()
        for t in events.itertuples():
            date=pd.Timestamp(t.datetime);direction=1 if t.business=='BUY' else -1
            notional=float(Decimal(str(t.number*t.realPrice)).quantize(Decimal('.01'),rounding=ROUND_HALF_UP))
            delta.loc[date]+=direction*t.number;cash_delta.loc[date]-=direction*notional+t.cost_total
        position=delta.cumsum().to_numpy();cash=100000.+cash_delta.cumsum().to_numpy()
        np.testing.assert_allclose(equity.position,position,atol=1e-12);np.testing.assert_allclose(equity.cash,cash,atol=.011,rtol=0)
        np.testing.assert_allclose(equity.equity,cash+position*b.close.to_numpy(),atol=.011,rtol=0)

    def test_original_engine_signals_fill_next_input_open(self):
        b=fixture();trades=frame(calculate(b,PARAMETERS),'trades');fast=b.close.rolling(5).mean();slow=b.close.rolling(15).mean()
        self.assertGreater(len(trades[trades.business.isin(['BUY','SELL'])]),4)
        dates={pd.Timestamp(x):i for i,x in enumerate(b.time)}
        for t in trades[trades.business.isin(['BUY','SELL'])].itertuples():
            i=dates[pd.Timestamp(t.datetime)];self.assertGreaterEqual(i,16);self.assertAlmostEqual(t.realPrice,b.open.iloc[i],10)
            if t.business=='BUY':self.assertLessEqual(fast.iloc[i-2],slow.iloc[i-2]);self.assertGreater(fast.iloc[i-1],slow.iloc[i-1])
            else:self.assertGreaterEqual(fast.iloc[i-2],slow.iloc[i-2]);self.assertLess(fast.iloc[i-1],slow.iloc[i-1])

    def test_prefixes_and_future_prices_do_not_change_past_account(self):
        b=fixture();cut=140;full=calculate(b,PARAMETERS);prefix=calculate(b.iloc[:cut].copy(),PARAMETERS)
        changed=b.copy();changed.loc[cut:,['open','high','low','close']]*=2;future=calculate(changed,PARAMETERS)
        for name in ('equity','trades'):
            for result in (full,future):
                actual=frame(result,name);expected=frame(prefix,name)
                actual=actual.iloc[:cut] if name=='equity' else actual[pd.to_datetime(actual.datetime)<=pd.Timestamp(b.time.iloc[cut-1])]
                pd.testing.assert_frame_equal(actual.reset_index(drop=True),expected,check_dtype=False)

    def test_microsecond_input_unit_is_normalized_and_intraday_rejected(self):
        b=fixture(80);reference=frame(calculate(b,PARAMETERS),'equity')
        b['time']=pd.to_datetime(b.time).astype('datetime64[us]')
        actual=frame(calculate(b,PARAMETERS),'equity');np.testing.assert_allclose(actual.equity,reference.equity)
        b['time']=pd.to_datetime(b.time)+pd.Timedelta(hours=1)
        with self.assertRaisesRegex(ValueError,'calendar dates'):calculate(b,PARAMETERS)
        b['time']=pd.to_datetime(b.time).dt.normalize().dt.tz_localize('UTC')
        with self.assertRaisesRegex(ValueError,'calendar dates'):calculate(b,PARAMETERS)

    def test_missing_or_placeholder_amount_is_rejected(self):
        b=fixture(80)
        with self.assertRaisesRegex(ValueError,'requires actual amount'):calculate(b.drop(columns='amount'),PARAMETERS)
        b['amount']=0.
        with self.assertRaisesRegex(ValueError,'consistent zero'):calculate(b,PARAMETERS)


if __name__=='__main__':unittest.main()
