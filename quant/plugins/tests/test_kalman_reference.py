"""Independent comparison with statsmodels' original Kalman filter.

Run in the existing RQAlpha environment which includes statsmodels. Core
packages do not require statsmodels to calculate their own recurrence.
"""
import sys
from pathlib import Path
import unittest
import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.kalman_filter import KalmanFilter
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from temporal_indicators import calculate


class ReferenceTests(unittest.TestCase):
    def test_local_level_and_trend_match_original_filter(self):
        rng=np.random.default_rng(487)
        observations=4+np.cumsum(rng.normal(0,.02,300))
        b=pd.DataFrame({"time":pd.date_range("2020-01-01",periods=300).astype(str),"close":np.exp(observations)})
        for dim,model in ((1,"local-level"),(2,"local-linear-trend")):
            with self.subTest(model=model):
                params={"model":model,"levelVariance":1e-5,"trendVariance":1e-7,"observationVariance":1e-4,"initialVariance":.01}
                actual,_=calculate("kalman-filter",b,params)
                f=np.array([[1.,1.],[0.,1.]]) if dim==2 else np.ones((1,1))
                q=np.diag([1e-5,1e-7] if dim==2 else [1e-5])
                initial=np.zeros(dim);initial[0]=observations[0]
                original=KalmanFilter(k_endog=1,k_states=dim,k_posdef=dim)
                # Disable steady-state tolerance shortcuts for an exact recursive comparison.
                original.tolerance=0.
                original.bind(observations[1:,None].copy())
                original["transition"]=f;original["design"]=np.array([[1.,0.]]) if dim==2 else np.ones((1,1))
                original["selection"]=np.eye(dim);original["state_cov"]=q;original["obs_cov"]=np.array([[1e-4]])
                original.initialize_known(f@initial,f@(np.eye(dim)*.01)@f.T+q)
                expected=original.filter()
                np.testing.assert_allclose(actual.filteredLogLevel.iloc[1:],expected.filtered_state[0],rtol=1e-10,atol=1e-10)
                np.testing.assert_allclose(actual.levelVariance.iloc[1:],expected.filtered_state_cov[0,0],rtol=1e-10,atol=1e-10)
                if dim==2:np.testing.assert_allclose(actual.filteredLogSlope.iloc[1:],expected.filtered_state[1],rtol=1e-10,atol=1e-10)


if __name__=="__main__":unittest.main(verbosity=2)
