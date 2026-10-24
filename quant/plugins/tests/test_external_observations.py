import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from observation_contract import load_observations
from external_observations import calculate,OPERATIONS


def fixture(family='macro',periods=36):
    rows=[];base=pd.Timestamp('2020-01-01T00:00:00Z')
    def add(period,decision,value,revision=0,state='published',series='primary'):
        rows.append(dict(time=(base+pd.Timedelta(days=decision)).isoformat(),sequence=len(rows)+1,
            observedat=(base+pd.Timedelta(days=period*30)).isoformat(),availableat=(base+pd.Timedelta(days=decision)).isoformat(),
            seriesid=series,observationid='p'+str(period),revision=revision,state=state,value=value,
            unit='synthetic-level' if series=='primary' else 'different-unit',source='synthetic-validation-only',
            sourceurl='https://example.com/synthetic/'+family,definitionid='synthetic-'+family+'-v1',family=family,
            subject='synthetic-security',entity='synthetic-entity',coverage='complete-vintages'))
    for i in range(periods):
        value=100+i+np.sin(i)*3
        add(i,i*30+5,value);add(i,i*30+5,value*10,series='secondary')
        if i>0 and i%7==0:add(i-1,i*30+6,150+i,1)
        if i%9==8:
            add(i,i*30+7,'',1,'withdrawn');add(i,i*30+8,value+2,2)
    return pd.DataFrame(rows)


def validated(b):
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'input.csv';b.to_csv(p,index=False);return load_observations(p)


def frame(result,name='indicators'):
    t=next(t for t in result['tables'] if t['id']==name);return pd.DataFrame(t['rows'],columns=t['columns'])


def params(**kw):return dict(seriesId='primary',maxAgeDays=365.,transformation='level',priorWindow=3,**kw)


class Observations(unittest.TestCase):
    def test_every_family_runs_and_source_formulas_are_not_claimed(self):
        for operation,family in OPERATIONS.items():
            b=validated(fixture(family));r=calculate(operation,b,params());out=frame(r)
            self.assertEqual(len(out),len(b));self.assertEqual(out.currentValue.iloc[0],100)
            self.assertFalse(r['inputSemantics']['proprietaryFormulaReproduced'])
            self.assertFalse(r['inputSemantics']['pointInTimeProvenanceCertified'])
            self.assertEqual(out.unit.iloc[1],'synthetic-level')
            if family in ('news','demark','vendor-score'):
                with self.assertRaises(ValueError):calculate(operation,b,{**params(),'transformation':'change'})

    def test_revisions_apply_on_arrival_without_backfill_or_latest_period_override(self):
        raw=fixture(periods=10);b=validated(raw);o=frame(calculate('macro-vintages',b,params()))
        idx=b.index[(b.observationid=='p6')&(b.revision==1)][0]
        self.assertEqual(o.observationid.iloc[idx],'p7');self.assertAlmostEqual(o.currentValue.iloc[idx],100+7+np.sin(7)*3)
        first=b.index[(b.observationid=='p6')&(b.seriesid=='primary')&(b.revision==0)][0]
        self.assertEqual(o.currentValue.iloc[first],b.value.iloc[first])
        a=frame(calculate('macro-vintages',b,params()),'release-audit')
        self.assertAlmostEqual(a.revisionDelta.iloc[idx],157-(106+np.sin(6)*3))

    def test_withdrawal_no_fallback_and_explicit_restore(self):
        b=validated(fixture(periods=10));o=frame(calculate('macro-vintages',b,params()));idx=b.index[b.state.eq('withdrawn')][0]
        self.assertEqual(o.status.iloc[idx],'withdrawn');self.assertTrue(pd.isna(o.currentValue.iloc[idx]))
        self.assertEqual(o.observationid.iloc[idx],'p8');self.assertEqual(o.status.iloc[idx+1],'available')
        self.assertAlmostEqual(o.currentValue.iloc[idx+1],110+np.sin(8)*3)

    def test_independent_change_and_z_use_current_vintages_of_prior_periods(self):
        b=validated(fixture(periods=10));known={}
        for mode in ('change','prior-z'):
            o=frame(calculate('macro-vintages',b,{**params(),'transformation':mode}));known={}
            for i,r in enumerate(b.itertuples()):
                if r.seriesid=='primary':known[r.observedat]=(r.state,r.value)
                periods=sorted(known);recent=known[periods[-1]]
                if recent[0]!='published':continue
                if mode=='change' and len(periods)>1 and known[periods[-2]][0]=='published':
                    self.assertAlmostEqual(o.observationChange.iloc[i],recent[1]-known[periods[-2]][1])
                if mode=='prior-z' and len(periods)>3:
                    prev=[known[t] for t in periods[-4:-1]]
                    if all(x[0]=='published' for x in prev):
                        vals=[x[1] for x in prev];mean=sum(vals)/3;sd=(sum((x-mean)**2 for x in vals)/2)**.5
                        self.assertAlmostEqual(o.priorWindowZ.iloc[i],(recent[1]-mean)/sd)

    def test_prefix_at_same_timestamp_and_future_perturbations(self):
        for operation,family in OPERATIONS.items():
            b=validated(fixture(family,12));cut=15;past=b.iloc[:cut].copy();changed=b.copy()
            changed.loc[changed.index>=cut,'value']*=7
            for mode in (('level',) if family in ('news','demark','vendor-score') else ('level','change','prior-z')):
                p={**params(),'transformation':mode};a=calculate(operation,b,p);c=calculate(operation,changed,p);s=calculate(operation,past,p)
                for name in ('indicators','release-audit'):
                    rows=lambda result:next(t['rows'] for t in result['tables'] if t['id']==name)
                    self.assertEqual(rows(a)[:cut],rows(s))
                    self.assertEqual(rows(a)[:cut],rows(c)[:cut])

    def test_stale_age_tracks_observed_period_not_revision(self):
        b=validated(fixture(periods=10));p={**params(),'maxAgeDays':6};o=frame(calculate('macro-vintages',b,p))
        idx=b.index[(b.observationid=='p8')&(b.revision==2)][0]
        self.assertEqual(o.status.iloc[idx],'stale');self.assertEqual(o.ageDays.iloc[idx],8)
        self.assertEqual(o.publicationAgeDays.iloc[idx],0);self.assertTrue(pd.isna(o.currentValue.iloc[idx]))

    def test_not_yet_known_selected_series_and_constant_window(self):
        raw=fixture(periods=5);raw.loc[0,'seriesid']='early';raw.loc[0,'value']=10000
        b=validated(raw);o=frame(calculate('macro-vintages',b,params()));self.assertEqual(o.status.iloc[0],'not-yet-published')
        raw=fixture(periods=5);raw['value']=10;b=validated(raw)
        o=frame(calculate('macro-vintages',b,{**params(),'transformation':'prior-z'}))
        self.assertTrue(o.priorWindowZ.isna().all());self.assertEqual(o.status.iloc[-1],'constant-prior-window')

    def test_future_times_versions_meaning_duplicates_and_provenance_rejected(self):
        raw=fixture(periods=10)
        changes=[(0,'availableat','2040-01-01T00:00:00Z'),(0,'observedat','2040-01-01T00:00:00Z'),
            (0,'time','2020-01-06'),(1,'sequence',1),(2,'unit','changed'),(2,'source','changed'),
            (0,'sourceurl','https://user:password@example.com/'),(0,'sourceurl','file:///tmp'),(0,'entity','  '),
            (0,'value','inf'),(0,'value',1e19),(0,'revision',1),(0,'family','other'),(0,'coverage','unknown')]
        for idx,key,value in changes:
            x=raw.copy();x.loc[idx,key]=value
            with self.subTest(key=key,value=value),self.assertRaises((ValueError,TypeError)):validated(x)
        revision=raw.index[(raw.observationid=='p6')&(raw.revision==1)][0]
        for key,value in [('revision',0),('revision',3),('observedat','2020-01-01T00:00:00Z'),('availableat',raw.availableat.iloc[12])]:
            x=raw.copy();x.loc[revision,key]=value
            with self.assertRaises(ValueError):validated(x)
        x=raw.copy();x.loc[x.state.eq('withdrawn'),'value']=0
        with self.assertRaises(ValueError):validated(x)

    def test_partial_vintages_stay_explicit_and_withdrawn_window_not_skipped(self):
        raw=fixture(periods=12);raw['coverage']='partial-vintages';raw['revision']+=3
        b=validated(raw);o=frame(calculate('macro-vintages',b,params()));self.assertEqual(o.coverage.iloc[-1],'partial-vintages')
        raw=fixture(periods=12);raw=raw[~((raw.observationid=='p8')&(raw.revision==2))]
        b=validated(raw);o=frame(calculate('macro-vintages',b,{**params(),'transformation':'prior-z'}))
        self.assertEqual(o.status.iloc[-1],'prior-window-withdrawn');self.assertTrue(pd.isna(o.priorWindowZ.iloc[-1]))

    def test_bad_csv_width_duplicate_columns_and_mismatched_operation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bad.csv'
            for text in ('time,time\na,b\n','time,value\na,b,c\n'):
                p.write_text(text)
                with self.assertRaises(ValueError):load_observations(p)
        b=validated(fixture())
        with self.assertRaises(ValueError):calculate('margin-vintages',b,params())
        with self.assertRaises(ValueError):calculate('macro-vintages',b,{**params(),'seriesId':'missing'})

    def test_package_source_newlines_are_canonical(self):
        import build_packages
        old=build_packages.HERE
        try:
            with tempfile.TemporaryDirectory() as d:
                root=Path(d);build_packages.HERE=root;source=root/'test.py';m={'id':'org.test.newlines','operations':[]}
                source.write_bytes(b'a=1\r\nb=2\r\n');a=build_packages.save_package(root,copy.deepcopy(m),{'worker.py':'test.py'})
                first=(root/a['file']).read_bytes();source.write_bytes(b'a=1\nb=2\n')
                b=build_packages.save_package(root,copy.deepcopy(m),{'worker.py':'test.py'})
                self.assertEqual(a['sha256'],b['sha256']);self.assertEqual(first,(root/b['file']).read_bytes())
        finally:build_packages.HERE=old


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--fixtures':
        root=Path(sys.argv[2]);root.mkdir(parents=True,exist_ok=True)
        for operation,family in OPERATIONS.items():fixture(family).to_csv(root/(operation+'.csv'),index=False)
    else:unittest.main()
