import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from panel_contract import load_panel
from limit_research import calculate,load_limit_events,ticks


def panel_fixture(n=40):
    rows=[]
    for i,start in enumerate(pd.date_range('2020-01-01T09:30:00+08:00',periods=n)):
        end=start+pd.Timedelta(hours=5,minutes=30);time=end+pd.Timedelta(minutes=5)
        for j,symbol in enumerate(('A','B','C')):
            traded=not(j==1 and i%7==0);unbounded=j==2 and i%5==0
            close=11. if j==0 and i%8<3 else 9. if j==1 and i%8==3 else 10.
            high=max(close,10.5);low=min(close,9.5)
            rows.append(dict(time=time.isoformat(),symbol=symbol,barend=end.isoformat(),availableat=time.isoformat(),membershipknownat=start.isoformat(),
                member=1,universecount=3,open=close,high=high,low=low,close=close,volume=1000 if traded else 0,currency='CNY',pricebasis='raw',volumeunit='share',isclosed=1,
                sessionstart=start.isoformat(),limitknownat=(start-pd.Timedelta(hours=1)).isoformat(),limitstatus='unbounded' if unbounded else 'bounded',
                upperlimit='' if unbounded else '11',lowerlimit='' if unbounded else '9',pricetick='.01',ruleid='synthetic-bound-v1',source='synthetic-only',
                sessionindex=i,calendarid='synthetic-calendar-v1',traded=int(traded)))
    return pd.DataFrame(rows)


def event_fixture(n=120):
    rows=[];states=['normal','up','up','normal','up','other','up','normal','down','normal']
    for i in range(n):
        session=i//60;start=pd.Timestamp('2020-01-01T09:30:00+08:00')+pd.Timedelta(days=session);event=start+pd.Timedelta(seconds=i%60+1)
        state=states[i%len(states)];up=state in ('up','other');down=state=='down'
        rows.append(dict(time=event.isoformat(),eventtime=event.isoformat(),availableat=event.isoformat(),sequence=i+1,symbol='A',coverage='events-complete',
            phase='other' if state=='other' else 'continuous',bidprice='' if down else '11' if up else '10',bidsize=0 if down else 1000,
            askprice='' if up else '9' if down else '10.01',asksize=0 if up else 2000,lastprice='11' if up else '9' if down else '10',lasttradetime=event.isoformat(),
            currency='CNY',volumeunit='share',pricebasis='raw',sessionstart=start.isoformat(),limitknownat=(start-pd.Timedelta(hours=1)).isoformat(),
            limitstatus='bounded',upperlimit='11',lowerlimit='9',pricetick='.01',ruleid='synthetic-bound-v1',source='synthetic-only',
            sessionindex=session,calendarid='synthetic-calendar-v1'))
    return pd.DataFrame(rows)


def loaded(b,events=False):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'input.csv';b.to_csv(p,index=False);return load_limit_events(p) if events else load_panel(p)


def frame(r,name='indicators'):
    t=next(t for t in r['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


class Limits(unittest.TestCase):
    def test_breadth_known_counts_streaks_and_left_censoring(self):
        r=calculate('limit-breadth',loaded(panel_fixture()),{});o=frame(r);a=frame(r,'security-limit-audit');stock=a[a.symbol.eq('A')].reset_index(drop=True)
        self.assertEqual(o.closedUpper.iloc[:4].tolist(),[1,1,1,0]);self.assertEqual(o.closedLower.iloc[3],1)
        self.assertEqual(o.unboundedCount.iloc[0],1);self.assertEqual(o.tradedCount.iloc[0],2)
        self.assertEqual(stock.observedUpperStreak.iloc[:4].tolist(),[1,2,3,0]);self.assertTrue(stock.streakMayStartEarlier.iloc[:3].all())
        self.assertFalse(stock.streakMayStartEarlier.iloc[8]);self.assertEqual(stock.observedUpperStreak.iloc[10],3)

    def test_daily_touch_does_not_invent_intraday_seal_events(self):
        b=panel_fixture(4);b.loc[(b.symbol=='A')&(b.sessionindex==3),'high']=11
        o=frame(calculate('limit-breadth',loaded(b),{}));self.assertEqual(o.touchedUpperNotClosed.iloc[3],1)
        self.assertNotIn('upperSealExit',o);self.assertEqual(o.closedUpper.iloc[3],0)

    def test_exact_observed_transitions_and_phase_baselines(self):
        o=frame(calculate('limit-sequence',loaded(event_fixture(10),True),{}))
        self.assertEqual(o.upperSealEntry.iloc[1],1);self.assertEqual(o.upperSealEntry.iloc[2],0);self.assertEqual(o.upperSealExit.iloc[3],1)
        self.assertTrue(pd.isna(o.upperSealExit.iloc[5]));self.assertTrue(pd.isna(o.upperSealEntry.iloc[6]))
        self.assertEqual(o.observedUpperEntries.iloc[-1],2);self.assertEqual(o.observedUpperBreaks.iloc[-1],2)
        self.assertEqual(o.observedLowerEntries.iloc[-1],1);self.assertEqual(o.observedLowerBreaks.iloc[-1],1)
        self.assertEqual(o.upperQueueShares.iloc[1],1000);self.assertEqual(o.lowerQueueShares.iloc[8],2000)

    def test_missing_trade_and_sampled_data_do_not_manufacture_break_counts(self):
        raw=event_fixture(10);raw.loc[2,['lastprice','lasttradetime']]=''
        o=frame(calculate('limit-sequence',loaded(raw,True),{}));self.assertTrue(pd.isna(o.upperSealed.iloc[2]));self.assertTrue(pd.isna(o.upperSealExit.iloc[3]))
        self.assertEqual(o.observedUpperBreaks.iloc[3],0)
        raw=event_fixture(10);raw.coverage='sampled';raw.sequence=raw.sequence*3
        o=frame(calculate('limit-sequence',loaded(raw,True),{}));self.assertTrue(o.observedUpperEntries.isna().all());self.assertTrue(o.upperSealExit.isna().all())
        self.assertEqual(o.upperSealed.iloc[1],1)

    def test_session_change_and_first_sealed_snapshot_are_not_new_entries(self):
        raw=event_fixture();raw=raw.iloc[1:].copy();o=frame(calculate('limit-sequence',loaded(raw,True),{}))
        self.assertEqual(o.upperSealed.iloc[0],1);self.assertEqual(o.observedUpperEntries.iloc[0],0)
        first=o[o.sessionindex.eq(1)].iloc[0];self.assertEqual(first.observedUpperEntries,0);self.assertTrue(pd.isna(first.upperSealEntry))

    def test_prefixes_and_future_changes_leave_all_historical_rows_identical(self):
        for operation,event in [('limit-breadth',False),('limit-sequence',True)]:
            raw=event_fixture() if event else panel_fixture();cut=47 if event else 63
            short=loaded(raw.iloc[:cut],event);full=loaded(raw,event);changed=raw.copy()
            if event:changed.loc[cut:,'bidsize']=changed.loc[cut:,'bidsize']*2
            else:changed.loc[cut:,'high']=changed.loc[cut:,'high'].clip(lower=10.8)
            a=calculate(operation,full,{});s=calculate(operation,short,{});c=calculate(operation,loaded(changed,event),{})
            for t in s['tables']:
                x=frame(a,t['id']).iloc[:len(t['rows'])].reset_index(drop=True);y=frame(c,t['id']).iloc[:len(t['rows'])].reset_index(drop=True)
                pd.testing.assert_frame_equal(x,frame(s,t['id']),check_dtype=False);pd.testing.assert_frame_equal(x,y,check_dtype=False)

    def test_future_limits_wrong_units_missing_sessions_and_prices_rejected(self):
        raw=panel_fixture(5)
        for key,value in [('limitknownat','2040-01-01T00:00:00Z'),('pricebasis','split-adjusted'),('high',11.01),('close',10.001),
            ('sessionindex',8),('traded',0),('upperlimit','8'),('ruleid','')]:
            b=raw.copy();b[key]=b[key].astype(object);b.loc[3,key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):calculate('limit-breadth',loaded(b),{})
        self.assertEqual(ticks('10.01','.01'),1001)
        for price in ('10.001','0','NaN','Infinity'):
            with self.assertRaises(ValueError):ticks(price,'.01')

    def test_invalid_one_sided_books_sequences_and_trade_times_rejected(self):
        raw=event_fixture(10)
        for i,key,value in [(1,'askprice','11'),(0,'bidprice','10.02'),(2,'sequence',9),(2,'lasttradetime','2040-01-01T00:00:00Z'),
            (2,'eventtime','2040-01-01T00:00:00Z'),(2,'bidsize',.5),(2,'upperlimit','12'),(2,'coverage','unknown')]:
            b=raw.copy();b[key]=b[key].astype(object);b.loc[i,key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):loaded(b,True)

    def test_same_timestamp_sequence_is_applied_one_record_at_a_time(self):
        raw=event_fixture(5)
        for key in ('time','eventtime','availableat','lasttradetime'):raw.loc[2,key]=raw.loc[1,key]
        full=calculate('limit-sequence',loaded(raw,True),{});short=calculate('limit-sequence',loaded(raw.iloc[:2],True),{})
        self.assertEqual(full['tables'][0]['rows'][:2],short['tables'][0]['rows'])


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--fixtures':
        root=Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True);panel_fixture().to_csv(root/'limit-breadth.csv',index=False);event_fixture().to_csv(root/'limit-sequence.csv',index=False)
    else:unittest.main()
