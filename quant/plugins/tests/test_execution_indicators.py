"""Position ratchet execution order and exact-session RVOL checks."""
import argparse
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from execution_indicators import calculate
from test_learning_models import fixture as price_fixture


def session_fixture(sessions=20,slots=20):
    rows=[]
    for day in range(sessions):
        anchor=pd.Timestamp('2020-01-01T09:30:00+08:00')+pd.Timedelta(days=day)
        for slot in range(slots):
            # A declared mid-session break does not create missing trading slots.
            offset=slot*60+(3600 if slot>=slots//2 else 0)
            start=anchor+pd.Timedelta(seconds=offset);end=start+pd.Timedelta(seconds=60)
            rows.append(dict(time=end.isoformat(),open=100.,high=101.,low=99.,close=100.,volume=float((day+1)*(slot+1)*100),
                session=anchor.strftime('%Y-%m-%d'),sessionindex=day,slot=slot,sessionstart=anchor.isoformat(),barstart=start.isoformat(),barend=end.isoformat(),
                availableat=end.isoformat(),calendarid='synthetic-calendar-v1',volumeunit='share',isclosed='true',datasetkind='synthetic-test'))
    return pd.DataFrame(rows)


def stop_params(**kw):return dict(period=2,multiple=1.,entryBars='3',side='long',quantity=10.,feeBps=5.,**kw)
def volume_params(mode='cumulative'):return dict(sessions=3,barSeconds=60,mode=mode)


class ExecutionTests(unittest.TestCase):
    def test_stop_is_not_raised_and_backfilled_inside_same_bar(self):
        b=price_fixture(7);b['open']=[10.,10,10,10,14,8,8];b['close']=[10.,10,10,14,14,8,8]
        b['high']=[11.,11,11,15,15,9,9];b['low']=[9.,9,9,9,13,7,7]
        r,_=calculate('atr-position-exit',b,stop_params())
        self.assertEqual(r.entryFill.iloc[3],10.)
        self.assertEqual(r.activeStopAtBarOpen.iloc[3],8.)
        self.assertEqual(r.nextBarStop.iloc[3],11.)
        self.assertTrue(np.isnan(r.exitFill.iloc[3]))
        self.assertEqual(r.nextBarStop.iloc[4],12.)
        self.assertEqual(r.exitFill.iloc[5],8.);self.assertEqual(r.exitReason.iloc[5],'gap-open')
        self.assertAlmostEqual(r.realizedNetPnl.iloc[5],-20.-(10.+8.)*10*.0005)

    def test_entry_bar_touch_short_direction_and_reset(self):
        b=price_fixture(10);b[['open','close']]=10.;b['high']=11.;b['low']=9.
        b.loc[3,'low']=7.;b.loc[8,'low']=7.
        p=stop_params();p['entryBars']='3,8';r,_=calculate('atr-position-exit',b,p)
        self.assertEqual(r.exitFill.iloc[3],8.);self.assertEqual(r.positionAfterBar.iloc[3],0)
        self.assertEqual(r.entryFill.iloc[8],10.)
        self.assertAlmostEqual(r.activeStopAtBarOpen.iloc[8],10.-r.atrAtClose.iloc[7])
        b['low']=9.;b.loc[3,'high']=13.;p=stop_params();p['side']='short';r,_=calculate('atr-position-exit',b,p)
        self.assertEqual(r.activeStopAtBarOpen.iloc[3],12.);self.assertEqual(r.exitFill.iloc[3],12.)
        self.assertAlmostEqual(r.realizedNetPnl.iloc[3],-20.-22*10*.0005)

    def test_ratchet_only_tightens_and_all_prefixes_remain_unchanged(self):
        b=price_fixture(250);p=stop_params();p.update(period=14,entryBars='30,500',multiple=4.)
        for side in ('long','short'):
            p['side']=side;a,_=calculate('atr-position-exit',b,p);c,_=calculate('atr-position-exit',b.iloc[:180].copy(),p)
            pd.testing.assert_frame_equal(a.iloc[:180],c)
            stops=a.nextBarStop.dropna().to_numpy()
            self.assertTrue((np.diff(stops)>-1e-12).all() if side=='long' else (np.diff(stops)<1e-12).all())
        b=price_fixture(10);b[['open','close']]=10.;b['high']=11.;b['low']=9.
        p=stop_params();p['entryBars']='3,4'
        with self.assertRaisesRegex(ValueError,'overlaps'):calculate('atr-position-exit',b,p)
        p['entryBars']='2'
        with self.assertRaisesRegex(ValueError,'prior ATR'):calculate('atr-position-exit',b,p)

    def test_same_offset_regular_and_cumulative_use_previous_sessions_only(self):
        b=session_fixture()
        for mode in ('regular','cumulative'):
            r,_=calculate('rvol-at-time',b,volume_params(mode));i=3*20+10
            self.assertAlmostEqual(r.relativeVolumeAtTime.iloc[i],4./2.)
            expected=4*11*100 if mode=='regular' else 4*sum(range(1,12))*100
            self.assertEqual(r.currentVolumeMeasure.iloc[i],expected)
            self.assertEqual(r.historicalMatchedSessions.iloc[i],3)
            c,_=calculate('rvol-at-time',b.iloc[:315].copy(),volume_params(mode))
            pd.testing.assert_frame_equal(r.iloc[:315],c)
            changed=b.copy();changed.loc[315:,'volume']*=17.;d,_=calculate('rvol-at-time',changed,volume_params(mode))
            pd.testing.assert_frame_equal(r.iloc[:315],d.iloc[:315])

    def test_missing_slot_does_not_shift_time_match_or_complete_cumulative_volume(self):
        b=session_fixture();b=b.drop(index=20+5).reset_index(drop=True)
        regular,_=calculate('rvol-at-time',b,volume_params('regular'));cum,_=calculate('rvol-at-time',b,volume_params())
        mask=regular.sessionIndex.eq(3)&regular.slot.eq(5)
        self.assertTrue(regular.loc[mask,'relativeVolumeAtTime'].isna().all())
        # Later regular bars exist, but the same day's cumulative total is incomplete.
        mask=regular.sessionIndex.eq(3)&regular.slot.eq(6)
        self.assertTrue(regular.loc[mask,'relativeVolumeAtTime'].notna().all())
        self.assertTrue(cum.loc[mask,'relativeVolumeAtTime'].isna().all())
        own=cum.sessionIndex.eq(1)&cum.slot.ge(6)
        self.assertTrue(cum.loc[own,'currentVolumeMeasure'].isna().all())

    def test_missing_session_future_timestamp_and_units_rejected_zero_mean_unavailable(self):
        b=session_fixture();missing=b[b.sessionindex.ne(2)].reset_index(drop=True)
        with self.assertRaisesRegex(ValueError,'session index'):calculate('rvol-at-time',missing,volume_params())
        for key,value in [('availableat','2099-01-01T00:00:00Z'),('volumeunit','hand'),('calendarid','other'),('slot',-.5)]:
            changed=b.copy()
            if key=='slot':changed[key]=changed[key].astype(float)
            changed.loc[50,key]=value
            with self.subTest(field=key),self.assertRaises(ValueError):calculate('rvol-at-time',changed,volume_params())
        b['volume']=0.;r,_=calculate('rvol-at-time',b,volume_params())
        self.assertTrue(r.relativeVolumeAtTime.isna().all());self.assertEqual(r.status.iloc[-1],'zero-historical-volume')


if __name__=='__main__':
    if '--write-fixture' in sys.argv:
        parser=argparse.ArgumentParser();parser.add_argument('--write-fixture',type=Path,required=True);args=parser.parse_args()
        session_fixture().to_csv(args.write_fixture,index=False)
    else:unittest.main()
