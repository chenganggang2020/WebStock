"""Observable-time, hand-calculated and counterexample tests."""
import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from temporal_indicators import calculate, pivots, zigzag, higuchi, ordinal_entropy, rs_exponent


def bars(close):
    c=np.asarray(close,dtype=float)
    return pd.DataFrame({"time":pd.date_range("2020-01-01",periods=len(c)).astype(str),
        "open":c,"close":c,"high":c+.1,"low":c-.1,"volume":100.})


class TemporalTests(unittest.TestCase):
    def test_pivot_waits_for_right_bars_and_rejects_equal_extrema(self):
        b=bars([10,11,15,12,10,11,12])
        a=pivots(b,2,2)
        self.assertTrue(np.isnan(a[:4]).all())
        self.assertEqual(a[4,0],15.1); self.assertEqual(a[4,1],2)
        self.assertEqual(a[6,2],9.9); self.assertEqual(a[6,3],4)
        changed=b.copy();changed.loc[3,"high"]=15.1
        self.assertTrue(np.isnan(pivots(changed,2,2)[4,0]))

    def test_zigzag_reversal_events_never_complete_unfinished_tail(self):
        c=np.array([100,110,120,115,108,100,110,112])
        a=zigzag(c,.1)
        np.testing.assert_allclose(a[[1,4,6]],[[-1,100,0],[1,120,2],[-1,100,5]])
        self.assertTrue(np.isnan(a[[0,2,3,5,7]]).all())
        for stop in range(1,len(c)+1):
            np.testing.assert_allclose(zigzag(c[:stop],.1),a[:stop],equal_nan=True)

    def test_fibonacci_only_changes_after_second_pivot_confirmation(self):
        b=bars([100,110,120,115,108,100,110])
        a,_=calculate("fibonacci-confirmed",b,{"reversalPct":10.})
        self.assertTrue(a.anchorA.iloc[:4].isna().all())
        self.assertEqual(a.retracement500.iloc[4],110)
        self.assertAlmostEqual(a.extension1618.iloc[4],132.36)
        self.assertEqual(a.anchorBBar.iloc[4],2)
        self.assertAlmostEqual(a.extension1618.iloc[6],87.64)

    def test_structure_breaks_once_and_order_block_only_known_on_break(self):
        b=bars([10,12,11,13,14,10,9,8])
        b.loc[2,"open"]=11.05
        a,_=calculate("structure-events",b,{"left":1,"right":1,"blockLookback":3,"minGapPct":0.})
        self.assertEqual(a.bos.iloc[3],1)
        self.assertEqual(a.orderBlockBar.iloc[3],2)
        self.assertTrue(a.orderBlockBar.iloc[:3].isna().all())
        self.assertEqual(a.bos.iloc[4],0)
        self.assertEqual(a.choch.iloc[5],-1)
        self.assertEqual(a.choch.iloc[6],0)
        self.assertEqual(a.fvgDirection.iloc[4],1)
        self.assertAlmostEqual(a.fvgLow.iloc[4],11.1)
        self.assertAlmostEqual(a.fvgHigh.iloc[4],13.9)

    def test_renko_two_brick_reversal_and_multiple_brick_gap(self):
        b=bars([100,101,103,102,101,97,98,99,102])
        a,_=calculate("renko-close",b,{"boxSize":1.})
        np.testing.assert_allclose(a.syntheticClose,[100,101,103,103,101,97,97,99,102])
        np.testing.assert_allclose(a.newBrickCount,[0,1,2,0,1,4,0,1,3])
        self.assertEqual(a.lastNewBrickOpen.iloc[4],102)
        decimal,_=calculate("renko-close",bars([.1,.4,.3,.2]),{"boxSize":.1})
        np.testing.assert_allclose(decimal.newBrickCount,[0,3,0,1])
        below,_=calculate("renko-close",bars([100,100.99999999]),{"boxSize":1.})
        self.assertEqual(below.newBrickCount.iloc[1],0)

    def test_kalman_local_level_hand_update_and_future_mutation(self):
        b=bars([10,20,15,12,11])
        p={"model":"local-level","initialVariance":1.,"levelVariance":.25,"trendVariance":0.,"observationVariance":1.}
        a,_=calculate("kalman-filter",b,p)
        self.assertAlmostEqual(a.levelGain.iloc[1],5/9)
        self.assertAlmostEqual(a.filteredLogLevel.iloc[1],np.log(10)+5/9*np.log(2))
        self.assertAlmostEqual(a.levelVariance.iloc[1],5/9)
        self.assertAlmostEqual(a.nextObservationVariance.iloc[1],5/9+.25+1)
        changed=b.copy(); changed.loc[3:,"close"]*=1000
        z,_=calculate("kalman-filter",changed,p)
        np.testing.assert_allclose(a.iloc[:3,1:],z.iloc[:3,1:],equal_nan=True)

    def test_entropy_monotonic_constant_and_balanced_order_two(self):
        self.assertAlmostEqual(ordinal_entropy(np.arange(20),3,1)[0],0)
        self.assertTrue(np.isnan(ordinal_entropy(np.ones(20),3,1)[0]))
        entropy,count=ordinal_entropy(np.array([1,2,1,2,1]),2,1)
        self.assertAlmostEqual(entropy,1);self.assertEqual(count,4)

    def test_higuchi_straight_line_dimension_and_scale_invariance(self):
        x=np.arange(128,dtype=float)
        self.assertAlmostEqual(higuchi(x,8),1)
        self.assertAlmostEqual(higuchi(3*x+5,8),1)
        self.assertTrue(np.isnan(higuchi(np.ones(128),8)))
        rng=np.random.default_rng(426)
        y=rng.normal(size=256)
        self.assertAlmostEqual(rs_exponent(y),rs_exponent(y*3+5))
        self.assertTrue(np.isnan(rs_exponent(np.ones(256))))

    def test_fft_detects_known_period_at_window_end_and_ignores_linear_trend(self):
        t=np.arange(160)
        b=bars(np.exp(4+.001*t+.05*np.sin(2*np.pi*t/16)))
        a,_=calculate("fft-trailing",b,{"period":64})
        self.assertTrue(a.dominantPeriodBars.iloc[:63].isna().all())
        np.testing.assert_allclose(a.dominantPeriodBars.iloc[63:],16)
        self.assertTrue(a.peakPowerFraction.iloc[63:].between(0,1).all())
        self.assertTrue(a.spectralEntropy.iloc[63:].between(0,1).all())
        flat,_=calculate("fft-trailing",bars(np.exp(4+.001*t)),{"period":64})
        self.assertTrue(flat.dominantPeriodBars.isna().all())


if __name__=="__main__":unittest.main(verbosity=2)
