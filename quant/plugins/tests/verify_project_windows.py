"""Exercise installed upstream adapters through the full C++ Window, with persistent evidence."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def main():
    p=argparse.ArgumentParser()
    for key in ('test-executable','packages','runtime-map','data','output'):
        p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--lean-directory',type=Path)
    p.add_argument('--only',help='Comma separated project ids; otherwise all 19 declared upstream projects')
    p.add_argument('--allow-network',action='store_true',help='Include AKShare online request; no substitute data')
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    mapping={'hikyuu':('hikyuu','sma-cross'),'rqalpha':('rqalpha','sma-close'),'vnpy':('vnpy','rsi'),
        'qlib':('qlib','alpha158'),'lean':('data-tools','sma-close'),'backtrader':('backtrader','sma-cross'),
        'backtesting-py':('backtesting-py','sma-cross'),'vectorbt':('vectorbt','sma-cross'),'bt':('bt','sma-weight'),
        'zipline-reloaded':('zipline-reloaded','sma-close'),'ml4t-backtest':('ml4t-backtest','sma-cross'),
        'wondertrader':('wtpy310','sma-native'),'quantaxis':('quantaxis311','kdj'),'czsc':('czsc','online-bi'),
        'vnpy-ctastrategy':('vnpy','sma-limit'),'wtpy':('wtpy310','daily-dsb'),'wbt':('czsc','sma-weight'),
        'talib':('data-tools','rsi'),'akshare':('data-tools','daily-eastmoney')}
    runtime=json.loads(args.runtime_map.read_text(encoding='utf-8'));results=[]
    for project,(env,operation) in mapping.items():
        if args.only and project not in args.only.split(','):continue
        if project=='akshare' and not args.allow_network:continue
        package_files=[f for f in args.packages.glob('org.webstock.'+project+'-*.wspkg')
                       if json.loads(f.read_text(encoding='utf-8'))['manifest']['id']=='org.webstock.'+project]
        if len(package_files)!=1:raise ValueError('Exactly one package version required: '+project)
        package=package_files[0];manifest=json.loads(package.read_text(encoding='utf-8'))['manifest']
        output=args.output/(project+'.txt');screenshot=args.output/(project+'.png')
        environment=dict(os.environ,QT_QPA_PLATFORM='offscreen',PYTHONUTF8='1',
            WEBSTOCK_TEST_PYTHON=runtime[env],WEBSTOCK_TEST_PACKAGE=str(package.resolve()),WEBSTOCK_TEST_CSV=str(args.data.resolve()),
            WEBSTOCK_TEST_OPERATION=operation,WEBSTOCK_TEST_WAIT_MS='180000',WEBSTOCK_TEST_SCREENSHOT=str(screenshot.resolve()))
        environment.pop('WEBSTOCK_TEST_PARAMETERS',None);environment.pop('WEBSTOCK_TEST_RESULT_TAB',None)
        if project=='lean':
            if not args.lean_directory:raise ValueError('Explicit LEAN source/build directory required')
            parameter_file=args.output/'lean-parameters.json'
            parameter_file.write_text(json.dumps({'engineDirectory':str(args.lean_directory.resolve())}),encoding='utf-8')
            environment['WEBSTOCK_TEST_PARAMETERS']=str(parameter_file.resolve())
        print('Running full C++ Window: '+project,flush=True)
        try:
            r=subprocess.run([str(args.test_executable),'-o',str(output)+',txt'],env=environment,capture_output=True,timeout=700)
            text=output.read_text(encoding='utf-8') if output.exists() else ''
            match=re.search(r'Totals: (\d+) passed, (\d+) failed, (\d+) skipped',text)
            passed,failed,skipped=map(int,match.groups()) if match else (0,1,0)
            success=r.returncode==0 and passed==3 and failed==0 and skipped==0
            row={'project':project,'pluginId':manifest['id'],'packageVersion':manifest['version'],'operation':operation,
                'status':'verified' if success else 'failed','passed':passed,'failed':failed,'skipped':skipped,'exitCode':r.returncode,
                'testLogSha256':hashlib.sha256(output.read_bytes()).hexdigest() if output.exists() else None,
                'packageSha256':hashlib.sha256(package.read_bytes()).hexdigest(),'layouts':['quotes','classic','focus-alias-to-classic'],
                'checks':['actual research workspace opens plugin','run selected operation','native chart/tables','close/reopen archived result without replay']}
            if not success:row['diagnostic']=(text+'\n'+r.stderr.decode('utf-8',errors='replace'))[-12000:]
        except subprocess.TimeoutExpired:
            row={'project':project,'status':'harness_timeout','passed':0,'failed':1,'skipped':0}
        results.append(row)
        (args.output/'evidence.json').write_text(json.dumps({'schema':'webstock.plugin.full-project-windows.v1',
            'testExecutableSha256':hashlib.sha256(args.test_executable.read_bytes()).hexdigest(),
            'historicalFixtureSha256':hashlib.sha256(args.data.read_bytes()).hexdigest(),'runs':results},ensure_ascii=False,indent=2),encoding='utf-8')
        print(project+': '+row['status'],flush=True)
    return int(any(r['status']!='verified' for r in results))


if __name__=='__main__':raise SystemExit(main())
