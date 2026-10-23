"""Causal fits, independent recurrent/graph arithmetic and JSON state recovery."""
import base64
import hashlib
import json
from pathlib import Path
import sys
import unittest
import numpy as np
import pandas as pd
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from deep_models import calculate, prepare, SequenceRegressor, GraphRegressor, graph_from_training
from test_learning_models import fixture, table
from test_econometric_panel import fixture as panel_fixture, validated


def params():
    return dict(trainingRows=40, horizon=3, purgeBars=2, retrainEvery=40,
        sequenceRows=8, epochs=3, learningRate=.01, seed=2026,
        symbols="000001,000002,000003", edgeThreshold=.3)


def artifact(result):
    data=result['generatedData'];raw=base64.b64decode(data['base64'], validate=True)
    assert hashlib.sha256(raw).hexdigest()==data['sha256']
    return json.loads(raw)


class DeepTests(unittest.TestCase):
    def test_all_models_preserve_prefix_and_matured_evaluation(self):
        for name in ('lstm', 'transformer', 'gcn'):
            with self.subTest(model=name):
                b=validated(panel_fixture(160)) if name=='gcn' else fixture(160)
                times=sorted(b.time.unique());prefix=b[b.time<=times[129]].copy()
                full=calculate(name,b,params());short=calculate(name,prefix,params())
                for t in full['tables']:
                    a=table(full,t['id']);c=table(short,t['id'])
                    a=a[pd.to_datetime(a.time,utc=True)<=pd.to_datetime(times[129],utc=True)].reset_index(drop=True)
                    pd.testing.assert_frame_equal(a,c,check_dtype=False,rtol=1e-11,atol=1e-11)
                audit=table(full,'training-audit');eva=table(full,'matured-evaluation')
                self.assertTrue((audit.lastOutcomeBar<=audit.predictionBar-2).all())
                self.assertTrue((audit.initialWeightsSha256!=audit.finalWeightsSha256).all())
                self.assertTrue((eva.outcomeBar-eva.predictionBar).eq(3).all())
                self.assertNotIn('actual',table(full,'indicators'))
                for symbol,part in eva.groupby('symbol'):
                    self.assertAlmostEqual(part.cumulativeMse.iloc[-1],np.mean((part.prediction-part.actual)**2),places=12)
                artifact(full)

    def test_changed_future_does_not_rewrite_predictions_training_or_graph(self):
        for name in ('lstm','transformer','gcn'):
            b=validated(panel_fixture(160)) if name=='gcn' else fixture(160)
            times=sorted(b.time.unique());changed=b.copy();mask=changed.time>times[129]
            changed.loc[mask,['open','high','low','close']]*=8;changed.loc[mask,'volume']*=19
            a=calculate(name,b,params());c=calculate(name,changed,params())
            for t in a['tables']:
                x=table(a,t['id']);y=table(c,t['id'])
                x=x[pd.to_datetime(x.time,utc=True)<=pd.to_datetime(times[129],utc=True)].reset_index(drop=True)
                y=y[pd.to_datetime(y.time,utc=True)<=pd.to_datetime(times[129],utc=True)].reset_index(drop=True)
                pd.testing.assert_frame_equal(x,y,check_dtype=False,rtol=1e-11,atol=1e-11)

    def test_last_json_weights_reproduce_predictions_without_pickle(self):
        for name in ('lstm','transformer','gcn'):
            b=validated(panel_fixture(145)) if name=='gcn' else fixture(145);p=params()
            r=calculate(name,b,p);state=artifact(r);times,symbols,x,prices=prepare(name,b,p)
            tensors={k:torch.tensor(v,dtype=torch.float64) for k,v in state['stateDict'].items()}
            if name=='gcn':model=GraphRegressor(tensors['adjacency']);current=x[-1:]
            else:model=SequenceRegressor(name,p['sequenceRows']);current=x[-p['sequenceRows']:,0,:][None]
            model=model.double();model.load_state_dict(tensors,strict=True);model.eval()
            with torch.no_grad():
                expected=model(torch.tensor((current-state['featureMean'])/state['featureScale'],dtype=torch.float64)).numpy()[0]
            expected=expected*state['targetScale']+state['targetMean']
            np.testing.assert_allclose(expected,table(r,'indicators').tail(len(symbols)).prediction,atol=1e-12,rtol=1e-12)

    def test_lstm_gates_match_independent_numpy_recurrence(self):
        b=fixture(125);p=params();r=calculate('lstm',b,p);state=artifact(r);s={k:np.asarray(v) for k,v in state['stateDict'].items()}
        _,_,x,_=prepare('lstm',b,p)
        z=(x[-p['sequenceRows']:,0,:]-state['featureMean'])/state['featureScale']
        hidden=np.zeros(16);cell=np.zeros(16)
        for row in z:
            gates=s['encoder.weight_ih_l0']@row+s['encoder.weight_hh_l0']@hidden+s['encoder.bias_ih_l0']+s['encoder.bias_hh_l0']
            ingate,forget,candidate,outgate=np.split(gates,4)
            sigmoid=lambda a:1/(1+np.exp(-a))
            cell=sigmoid(forget)*cell+sigmoid(ingate)*np.tanh(candidate)
            hidden=sigmoid(outgate)*np.tanh(cell)
        expected=(s['head.weight']@hidden+s['head.bias'])*state['targetScale']+state['targetMean']
        self.assertAlmostEqual(expected[0],table(r,'indicators').prediction.iloc[-1],places=12)

    def test_gcn_propagation_matches_independent_numpy_and_training_graph(self):
        b=validated(panel_fixture(145));p=params();r=calculate('gcn',b,p);state=artifact(r)
        _,_,x,_=prepare('gcn',b,p);s={k:np.asarray(v) for k,v in state['stateDict'].items()}
        start=state['lastFeatureBar']-p['trainingRows']+1;returns=x[start:state['lastFeatureBar']+1,:,0]
        correlation=np.corrcoef(returns.T);a=np.where((correlation>=.3)&(correlation>0),correlation,0.)
        np.fill_diagonal(a,1.);d=np.diag(1/np.sqrt(a.sum(axis=1)));normalized=d@a@d
        np.testing.assert_allclose(s['adjacency'],normalized,atol=1e-12)
        z=(x[-1]-state['featureMean'])/state['featureScale']
        h=np.maximum((normalized@z)@s['first.weight'].T+s['first.bias'],0)
        expected=((normalized@h)@s['second.weight'].T+s['second.bias']).ravel()*state['targetScale']+state['targetMean']
        np.testing.assert_allclose(expected,table(r,'indicators').tail(3).prediction,atol=1e-12,rtol=1e-12)
        constant=np.ones((10,3));adj,corr=graph_from_training(constant,.3)
        np.testing.assert_equal(adj,np.eye(3));np.testing.assert_equal(corr,np.zeros((3,3)))

    def test_bounds_missing_history_and_unknown_nodes_fail_explicitly(self):
        p=params()
        with self.assertRaisesRegex(ValueError,'Not enough'):calculate('lstm',fixture(45),p)
        b=validated(panel_fixture(145))
        with self.assertRaisesRegex(ValueError,'distinct'):calculate('gcn',b,{**p,'symbols':'000001,000001'})
        with self.assertRaisesRegex(ValueError,'synchronized'):calculate('gcn',b,{**p,'symbols':'000001,MISSING'})
        missing=b.drop(b.index[b.symbol.eq('000002')][100])
        with self.assertRaisesRegex(ValueError,'synchronized'):calculate('gcn',missing,p)
        with self.assertRaisesRegex(ValueError,'200'):calculate('lstm',fixture(400),{**p,'retrainEvery':1})


if __name__=='__main__':unittest.main()
