"""Local native-app entry point. No collector, server, credentials or simulated models."""
import base64
import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import itertools
from datetime import date, datetime, timezone

from webstock_quant.manifest import file_sha256, manifest_sha256, write_json_atomic

MAX_FILE = 32 * 1024 * 1024
MAX_DATASET = 256 * 1024 * 1024
FAMILIES = ['moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout', 'low-position-volume-stagnation']
TASKS = ['lightgbm', 'master', 'factor', 'strategy', 'signal', 'experiment', 'watchlist', 'strategy-daily']
def default_master_count():
    try:
        if os.name == 'nt':
            import ctypes
            class Memory(ctypes.Structure):
                _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in ('total','available','pageTotal','pageAvailable','virtualTotal','virtualAvailable','extended')]
            memory = Memory(); memory.length = ctypes.sizeof(memory)
            if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
                return 200
            gib = memory.total / (1024**3)
        else:
            gib = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES') / (1024**3)
        return 600 if gib >= 24 else 350 if gib >= 12 else 200
    except (OSError, ValueError, AttributeError):
        return 200

COMMON = {
    'trainDays': ('train-days', 504, 252, 2520),
    'validationDays': ('validation-days', 126, 42, 504),
    'testDays': ('test-days', 63, 21, 252),
    'stepDays': ('step-days', 63, 21, 252),
    'maxFolds': ('max-folds', 4, 1, 12),
    'labelHorizon': ('label-horizon', 5, 1, 20),
    'topK': ('top-k', 20, 3, 100),
    'costBps': ('cost-bps', 8.0, 0, 100),
    'seed': ('seed', 20260809, 0, 2147483647),
}
LIGHTGBM = {'numBoostRound': ('num-boost-round', 300, 20, 2000), 'earlyStoppingRounds': ('early-stopping-rounds', 30, 5, 200)}
MASTER = {
    'lookback': ('master-lookback', 8, 4, 60), 'epochs': ('master-epochs', 20, 1, 200),
    'patience': ('master-patience', 4, 1, 40), 'learningRate': ('master-learning-rate', .001, .00001, .1),
    'dModel': ('master-d-model', 32, 8, 256), 'temporalHeads': ('master-temporal-heads', 2, 1, 8),
    'crossStockHeads': ('master-cross-stock-heads', 2, 1, 8), 'dropout': ('master-dropout', .1, 0, .8),
    'gateTemperature': ('master-gate-temperature', 1.0, .05, 20),
    'batchDays': ('master-batch-days', 16, 1, 64), 'maxInstruments': ('master-max-instruments', default_master_count(), 50, 1200),
}
STRATEGY = {
    'minimumHistoryDays': ('min-history-days', 120, 20, 504),
    'maxInstruments': ('max-instruments', 600, 50, 1200),
    'commissionBps': ('commission-bps', 2.5, 0, 100), 'minimumCommission': ('minimum-commission', 5.0, 0, 100),
    'stampDutyBps': ('stamp-duty-bps', 5.0, 0, 100), 'slippageBps': ('slippage-bps', 2.0, 0, 100),
    'capitalPerSymbol': ('capital-per-symbol', 100000.0, 1000, 10000000),
}
GRID = {
    'shortWindows': ('short-windows', [5,10,20], 1,250,True), 'longWindows': ('long-windows',[20,40,60],1,250,True),
    'fastWindows': ('fast-windows',[8,12],1,250,True), 'slowWindows': ('slow-windows',[26],1,250,True),
    'signalWindows': ('signal-windows',[9],1,250,True), 'rsiPeriods': ('rsi-periods',[6,14],1,250,True),
    'entryThresholds': ('entry-thresholds',[30],1,99,True), 'exitThresholds': ('exit-thresholds',[70],1,100,True),
    'breakoutWindows': ('breakout-windows',[20,40],1,250,True), 'volumeMultipliers': ('volume-multipliers',[1.5,2],1,20,False),
    'breakoutMargins': ('breakout-margins',[.005],.001,1,False), 'breakoutMinCloseLocations': ('breakout-min-close-locations',[.7],.001,1,False),
    'positionLookbackWindows': ('position-lookback-windows',[120],1,250,True), 'maxRangePositions': ('max-range-positions',[.35],.001,1,False),
    'volumeWindows': ('volume-windows',[20],1,250,True), 'maxAbsReturns': ('max-abs-returns',[.02],.001,1,False),
    'maxIntradayRanges': ('max-intraday-ranges',[.06],.001,1,False), 'minCloseLocations': ('min-close-locations',[.5],.001,1,False),
}
FAMILY_GRID = {
    FAMILIES[0]: ['shortWindows','longWindows'], FAMILIES[1]: ['fastWindows','slowWindows','signalWindows'],
    FAMILIES[2]: ['rsiPeriods','entryThresholds','exitThresholds'],
    FAMILIES[3]: ['breakoutWindows','volumeMultipliers','breakoutMargins','breakoutMinCloseLocations'],
    FAMILIES[4]: ['positionLookbackWindows','maxRangePositions','volumeWindows','volumeMultipliers','maxAbsReturns','maxIntradayRanges','minCloseLocations'],
}

def grid_arguments(supplied, family, scan=False):
    grid = {}
    for key in FAMILY_GRID[family]:
        flag, default, minimum, maximum, integer = GRID[key]
        if key == 'volumeMultipliers' and family == FAMILIES[4]:
            default = [1.8]
        if scan:
            default = default[:1]
        raw = supplied.get(key, default)
        raw = raw.split(',') if isinstance(raw, str) else raw
        require(isinstance(raw, list) and 0 < len(raw) <= 12, 'Grid must contain 1-12 numbers: ' + key)
        require(not any(isinstance(value, bool) for value in raw), 'Boolean is not a strategy parameter')
        numbers = sorted(set(float(value) for value in raw))
        require(all(math.isfinite(value) and minimum <= value <= maximum and (not integer or value == int(value)) for value in numbers), 'Strategy parameter outside original bounds: ' + key)
        if scan:
            require(len(numbers) == 1, 'Signal scan requires one deterministic parameter combination')
        grid[key] = [int(value) if integer else value for value in numbers]
    count = 0
    for combination in itertools.product(*grid.values()):
        if family in FAMILIES[:2] and combination[0] >= combination[1]:
            continue
        if family == FAMILIES[2] and combination[1] >= combination[2]:
            continue
        count += 1
        require(count <= 64, 'At most 64 valid strategy combinations')
    require(count > 0, 'No valid strategy combinations')
    return [part for key, numbers in grid.items() for part in ('--'+GRID[key][0], ','.join(map(str,numbers)))], grid

def require(condition, message):
    if not condition:
        raise ValueError(message)

def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    def reject(value):
        raise ValueError('Non-finite JSON number: ' + value)
    def finite(value):
        parsed = float(value)
        require(math.isfinite(parsed), 'Non-finite JSON number')
        return parsed
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject, parse_float=finite)

def read_json(path):
    require(path.is_file() and path.stat().st_size <= MAX_FILE, 'Missing or oversized JSON: ' + str(path))
    return strict_json(path.read_text(encoding='utf-8'))

def identifier(value):
    require(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,99}', value), 'Invalid identity')
    return value

def contained(root, relative):
    require(isinstance(relative, str) and relative and '\\' not in relative and ':' not in relative, 'Invalid artifact path')
    rel = PurePosixPath(relative)
    require(not rel.is_absolute() and all(part not in ('', '.', '..') for part in relative.split('/')), 'Artifact path traversal')
    target = root.joinpath(*rel.parts)
    require(target.resolve().is_relative_to(root.resolve()), 'Artifact escapes workspace')
    for ancestor in [target, *target.parents]:
        if ancestor == root.parent:
            break
        require(not ancestor.is_symlink() and not ancestor.is_junction(), 'Artifact link is not allowed')
    return target

def verify_manifest(manifest_path):
    manifest = read_json(manifest_path)
    require(manifest.get('schema') == 'webstock.quant.dataset.v1', 'Unsupported dataset schema')
    identifier(manifest.get('datasetId'))
    require(manifest.get('manifestSha256') == manifest_sha256(manifest), 'Dataset canonical hash mismatch')
    date.fromisoformat(manifest['asOf'])
    files = manifest.get('files')
    require(isinstance(files, list) and 0 < len(files) <= 4096, 'Dataset artifact list missing or too large')
    seen, total = set(), 0
    for artifact in files:
        relative = artifact['path']
        require(relative not in seen and relative != 'manifest.json', 'Duplicate/reserved dataset path')
        seen.add(relative)
        path = contained(manifest_path.parent, relative)
        require(path.is_file(), 'Dataset artifact missing: ' + relative)
        total += path.stat().st_size
        require(path.stat().st_size <= MAX_FILE and total <= MAX_DATASET, 'Dataset exceeds 32MiB/file or 256MiB total')
        require(file_sha256(path) == artifact.get('sha256'), 'Dataset artifact hash mismatch: ' + relative)
    return manifest

def values(supplied, definitions):
    result = {}
    for key, (_, default, lower, upper) in definitions.items():
        value = supplied.get(key, default)
        require(type(value) in (int, float) and math.isfinite(value) and lower <= value <= upper, 'Invalid parameter: ' + key)
        if type(default) is int:
            require(int(value) == value, 'Integer parameter required: ' + key)
            value = int(value)
        result[key] = value
    return result

def arguments(parameters, definitions):
    return [part for key, value in parameters.items() for part in ('--' + definitions[key][0], str(value))]

def plan(request):
    require(request.get('schema') == 'webstock.quant.native-request.v1', 'Unsupported native request')
    job_id = identifier(request.get('id'))
    task = request.get('task')
    require(task in TASKS, 'Unsupported task')
    supplied = request.get('parameters', {})
    require(isinstance(supplied, dict), 'Parameters must be an object')
    allowed = set(COMMON) | set(LIGHTGBM) | set(MASTER) | set(STRATEGY) | set(GRID) | {'strategyFamily','validationMode','maxCandidates'}
    require(not set(supplied) - allowed, 'Unknown parameter')
    family = supplied.get('strategyFamily', FAMILIES[-1] if task == 'signal' else FAMILIES[0])
    require(family in FAMILIES, 'Unknown strategy family')
    tasks = [('lightgbm', ''), ('factor', ''), ('master', '')] if task == 'experiment' else [('strategy', f) for f in FAMILIES[:4]] if task in ('watchlist', 'strategy-daily') else [(task, family)]
    steps = []
    for index, (kind, selected_family) in enumerate(tasks):
        step = dict(kind=kind, runId=job_id + '-' + str(index + 1), family=selected_family)
        if kind in ('lightgbm', 'master', 'factor'):
            definitions = dict(COMMON)
            definitions.update(LIGHTGBM if kind == 'lightgbm' else MASTER if kind == 'master' else {})
            params = values(supplied, definitions)
            require(params['stepDays'] >= params['testDays'], 'Overlapping out-of-sample windows')
            if kind == 'master':
                require(params['dModel'] % params['temporalHeads'] == 0 and params['dModel'] % params['crossStockHeads'] == 0, 'Attention dimensions are incompatible')
            step.update(command='factor-lab' if kind == 'factor' else 'run', parameters=params,
                        args=arguments(params, definitions) + (['--model', kind] if kind != 'factor' else []),
                        directory='factor-runs' if kind == 'factor' else 'runs',
                        schema='webstock.quant.factor-lab.v1' if kind == 'factor' else 'webstock.quant.result.v1',
                        modelId={'lightgbm': 'qlib-lightgbm-v2', 'master': 'master-market-guided-v1'}.get(kind, ''))
        else:
            definitions = {key: COMMON[key] for key in ('trainDays', 'validationDays', 'testDays', 'stepDays', 'maxFolds')}
            definitions['trainDays'] = ('train-days',252,63,2520)
            definitions['validationDays'] = ('validation-days',63,21,504)
            definitions['maxFolds'] = ('max-folds',4,3,12)
            definitions.update(STRATEGY)
            params = values(supplied, definitions)
            # Preserve the old strategy defaults, independent from model defaults.
            for key, default in [('trainDays', 252), ('validationDays', 63), ('testDays', 63), ('stepDays', 63)]:
                if key not in supplied:
                    params[key] = default
            require(params['stepDays'] >= params['testDays'], 'Overlapping strategy windows')
            if kind == 'signal':
                require(selected_family in FAMILIES[3:], 'Original signal workflow supports volume-breakout and low-position-volume-stagnation')
            grid_args, grid = grid_arguments(supplied, selected_family, kind == 'signal')
            mode = supplied.get('validationMode','exploratory')
            require(mode in ('exploratory','formal'), 'Invalid signal validation mode')
            maximum = values(supplied, {'maxCandidates': ('max-candidates',500,1,2000)})['maxCandidates']
            step.update(command='signal-scan' if kind == 'signal' else 'strategy-lab', parameters=params,
                        args=(['--validation-mode',mode,'--max-candidates',str(maximum)] if kind == 'signal' else arguments(params, definitions)) + ['--strategy-family', selected_family] + grid_args,
                        grid=grid, validationMode=mode if kind == 'signal' else None,
                        directory='signal-scans' if kind == 'signal' else 'strategy-runs',
                        schema='webstock.quant.signal-scan.v1' if kind == 'signal' else 'webstock.quant.strategy-lab.v1', modelId='')
        steps.append(step)
    return steps

def watchlist_selection(request, manifest, dataset):
    group = request.get('watchlist')
    require(isinstance(group, dict) and group.get('id') and group.get('name'), 'Explicit watchlist identity required')
    items = group.get('items', [])
    require(8 <= len(items) <= 120, 'Watchlist requires 8-120 explicit securities')
    codes = [item.get('code') for item in items]
    require(all(isinstance(code, str) and re.fullmatch(r'\d{6}', code) for code in codes) and len(set(codes)) == len(codes), 'Invalid/duplicate watchlist codes')
    require(manifest.get('adjustmentMode') == 'forward-adjusted', 'Watchlist data must be forward-adjusted')
    coverage = manifest.get('coverage', {})
    require(coverage.get('requested') == len(items) and coverage.get('succeeded', 0) >= 8, 'Watchlist coverage mismatch')
    artifact = next((f for f in manifest['files'] if f.get('kind') == 'universe'), None)
    require(artifact is not None, 'Watchlist universe artifact missing')
    universe = read_json(contained(dataset, artifact['path']))
    require(sorted(item.get('code') for item in universe.get('selected', [])) == sorted(codes), 'Frozen universe differs from selected watchlist')
    return dict(group=group, failures=universe.get('failures', []), readOnlyTonghuashun=True,
                collection='existing-local-dataset; online refresh not executed')

def verify_result(step, workspace, manifest):
    directory = workspace / step['directory'] / step['runId']
    path = directory / 'result.json'
    result = read_json(path)
    require(result.get('schema') == step['schema'] and result.get('runId') == step['runId'] and result.get('status') == 'completed', 'Result identity/state mismatch')
    if step['modelId']:
        require(result.get('modelId') == step['modelId'], 'Wrong model identity')
    ref = result.get('dataManifest', {})
    require(ref.get('datasetId') == manifest['datasetId'] and ref.get('sha256') == manifest['manifestSha256'] and ref.get('path') == 'datasets/' + manifest['datasetId'] + '/manifest.json', 'Result uses a different dataset')
    as_of = date.fromisoformat(result['asOf'])
    require(as_of <= date.fromisoformat(manifest['asOf']), 'Result time exceeds dataset time')
    if step['kind'] in ('strategy', 'signal'):
        require(result['asOf'] == manifest['asOf'], 'Strategy/signal date differs from frozen data cutoff')
    if step['kind'] in ('lightgbm', 'master', 'factor'):
        require(all(result.get('parameters', {}).get(key) == value for key, value in step['parameters'].items()), 'Model parameters do not match the request')
        require(bool(result.get('folds')), 'Missing actual rolling folds')
        for candidate in result.get('candidates', []):
            require(candidate.get('asOf') == result['asOf'], 'Candidate time mismatch')
            require(date.fromisoformat(candidate['modelTrainedThrough']) < as_of, 'Training date leaks into latest prediction')
    else:
        from webstock_quant.strategy_lab import generate_strategy_parameter_grid
        grid = generate_strategy_parameter_grid(step['family'], **{GRID[key][0].replace('-','_'):value for key,value in step['grid'].items()})
        require(result.get('ruleCard', {}).get('strategyFamily') == step['family'] and result.get('automaticTrading') is False, 'Wrong strategy identity or trading authority')
        if step['kind'] == 'strategy':
            expected = {key: step['parameters'][key] for key in ('trainDays','validationDays','testDays','stepDays','maxFolds','minimumHistoryDays','maxInstruments')}
            expected['minimumHistoryDays'] = max(expected['minimumHistoryDays'],max(item['warmup'] for item in grid))
            require(all(result.get('windowParameters',{}).get(key) == value for key, value in expected.items()), 'Strategy windows mismatch')
            require(all(result.get('executionAssumptions',{}).get(key) == step['parameters'][key] for key in ('commissionBps','minimumCommission','stampDutyBps','slippageBps','capitalPerSymbol')), 'Strategy execution cost mismatch')
            expected_grid = {item['parameterId']:item['settings'] for item in grid}
            actual_grid = {item['parameterId']:item['settings'] for item in result.get('parameters',[])}
            require(expected_grid == actual_grid and len(result.get('parameters',[])) == len(grid), 'Strategy parameter grid mismatch')
        else:
            require(result.get('validationMode') == step['validationMode'] and result['ruleCard'].get('settings') == grid[0]['settings'], 'Signal mode or parameters mismatch')
    artifacts = result.get('artifacts')
    require(isinstance(artifacts, list) and bool(artifacts), 'Result has no artifacts')
    seen = set()
    for artifact in artifacts:
        relative = artifact['path']
        require(relative not in seen and relative != 'result.json', 'Duplicate/reserved result artifact')
        seen.add(relative)
        target = contained(directory, relative)
        require(target.is_file() and target.stat().st_size <= MAX_FILE, 'Missing/oversized result artifact')
        require(file_sha256(target) == artifact.get('sha256'), 'Result artifact hash mismatch')
    return path, result

class ProtocolCapture(io.TextIOBase):
    def __init__(self, output, job_id, step_index):
        self.output, self.job_id, self.step_index = output, job_id, step_index
        self.buffer, self.results = '', []

    def write(self, text):
        self.buffer += text
        require(len(self.buffer) <= 8 * 1024 * 1024, 'Runner protocol line too large')
        while '\n' in self.buffer:
            line, self.buffer = self.buffer.split('\n', 1)
            if line.startswith('WEBSTOCK_RESULT='):
                self.results.append(strict_json(line[len('WEBSTOCK_RESULT='):]))
            elif line.startswith('WEBSTOCK_EVENT='):
                event = strict_json(line[len('WEBSTOCK_EVENT='):])
                emit('WEBSTOCK_NATIVE_EVENT=', dict(id=self.job_id, step=self.step_index, event=event), self.output)
            elif line.startswith('WEBSTOCK_ERROR='):
                raise RuntimeError(strict_json(line[len('WEBSTOCK_ERROR='):]).get('message', 'Runner error'))
            else:
                self.output.write(line + '\n')
        return len(text)

    def flush(self):
        self.output.flush()

def emit(prefix, value, stream=None):
    print(prefix + json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')), file=stream or sys.stdout, flush=True)

def long_path(path):
    resolved = str(Path(path).resolve())
    return Path("\\\\?\\" + resolved) if os.name == "nt" and not resolved.startswith("\\\\?\\") else Path(resolved)

def verify_engine(request):
    engine = long_path(Path(__file__).parent)
    expected = request.get('engineHashes', {})
    require(isinstance(expected, dict) and 'native_runner.py' in expected and 'webstock_quant/cli.py' in expected, 'Frozen engine manifest missing')
    for relative, digest in expected.items():
        require(file_sha256(contained(engine, relative)) == digest, 'Model source changed: ' + relative)

def execute(request_path):
    request_path = long_path(request_path)
    raw = request_path.read_bytes()
    require(len(raw) <= 1024 * 1024, 'Request too large')
    request = strict_json(raw.decode('utf-8'))
    steps = plan(request)
    verify_engine(request)
    owner = request_path.parent.resolve()
    require(request_path.name == 'request.json', 'Expected owned request.json')
    workspace = owner / 'workspace'
    require(not workspace.exists(), 'Task workspace already exists; no automatic replay')
    source = long_path(request['manifestPath'])
    require(file_sha256(source) == request.get('manifestFileSha256'), 'Dataset changed after user selected it')
    manifest = verify_manifest(source)
    selection = watchlist_selection(request, manifest, source.parent) if request['task'] == 'watchlist' else None
    emit('WEBSTOCK_NATIVE_EVENT=', dict(id=request['id'], step=0, event=dict(stage='freeze', message='Verifying and freezing local data')))
    dataset = workspace / 'datasets' / manifest['datasetId']
    dataset.mkdir(parents=True)
    shutil.copyfile(source, dataset/'manifest.json')
    for artifact in manifest['files']:
        destination = contained(dataset, artifact['path'])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(contained(source.parent, artifact['path']), destination)
    require(file_sha256(source) == request['manifestFileSha256'], 'Dataset changed while freezing')
    verify_manifest(dataset/'manifest.json')
    os.environ['WEBSTOCK_QUANT_NATIVE'] = '1'
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['MLFLOW_DISABLE_TELEMETRY'] = 'true'
    os.environ['MLFLOW_ENABLE_SYSTEM_METRICS_LOGGING'] = 'false'
    os.environ['GIT_CEILING_DIRECTORIES'] = str(owner).removeprefix('\\\\?\\')
    from webstock_quant.cli import main
    verified = []
    for index, step in enumerate(steps):
        emit('WEBSTOCK_NATIVE_EVENT=', dict(id=request['id'], step=index+1, total=len(steps), event=dict(stage='starting', message=step['kind'])))
        argv = [step['command'], '--workspace', str(workspace), '--dataset-id', manifest['datasetId'], '--run-id', step['runId'], *step['args']]
        capture = ProtocolCapture(sys.stdout, request['id'], index + 1)
        with contextlib.redirect_stdout(capture):
            code = main(argv)
        require(code == 0 and len(capture.results) == 1 and not capture.buffer.strip(), 'Runner did not finish with one complete result')
        result_path, result = verify_result(step, workspace, manifest)
        reported_path = Path(capture.results[0].get('resultPath', '')).resolve()
        require(reported_path == result_path.resolve(), 'Runner returned a foreign result path')
        verify_manifest(dataset/'manifest.json')
        verified.append(dict(step=step, relativePath=result_path.relative_to(owner).as_posix(), sha256=file_sha256(result_path), result=result))
        write_json_atomic(owner/'completed-steps.json', verified)
    # Exact full result/artifact bytes are retained for offline native/Android re-verification.
    report = None
    paths = [request_path, dataset/'manifest.json']
    if request['task'] in ('strategy-daily', 'watchlist'):
        from webstock_quant.native_suite import build_report, build_watchlist_review
        report = build_report([entry['result'] for entry in verified])
        write_json_atomic(owner/'suite-report.json', report)
        paths.append(owner/'suite-report.json')
        if selection is not None:
            selection.update(build_watchlist_review(report, manifest, selection))
            write_json_atomic(owner/'watchlist-review.json', selection)
            paths.append(owner/'watchlist-review.json')
    for entry in verified:
        result_path = owner/entry['relativePath']
        paths.append(result_path)
        paths.extend(contained(result_path.parent, artifact['path']) for artifact in entry['result']['artifacts'])
    files, total = [], 0
    for path in paths:
        data = path.read_bytes()
        total += len(data)
        require(total <= 24 * 1024 * 1024, 'Verified export exceeds 24MiB payload; local results retained')
        files.append(dict(path=path.relative_to(owner).as_posix(), sha256=hashlib.sha256(data).hexdigest(), base64=base64.b64encode(data).decode('ascii')))
    verify_engine(request)
    receipt = dict(schema='webstock.quant.native-result.v1', id=request['id'], task=request['task'], status='completed',
                   requestSha256=hashlib.sha256(raw).hexdigest(), datasetId=manifest['datasetId'],
                   manifestSha256=manifest['manifestSha256'], asOf=manifest['asOf'], steps=verified, watchlist=selection, report=report,
                   automaticTrading=False, verification='local-full-file-hashes; not independent model accuracy',
                   createdAt=datetime.now(timezone.utc).isoformat(), files=files)
    write_json_atomic(owner/'verified-result.json', receipt)
    emit('WEBSTOCK_NATIVE_RESULT=', dict(id=request['id'], requestSha256=receipt['requestSha256'], resultPath=str(owner/'verified-result.json').removeprefix('\\\\?\\'), sha256=file_sha256(owner/'verified-result.json')))
    return 0

if __name__ == '__main__':
    if os.environ.get('WEBSTOCK_QUANT_TRACE') == '1':
        import faulthandler
        faulthandler.enable()
        faulthandler.dump_traceback_later(30, repeat=True)
    try:
        require(len(sys.argv) == 2, 'Usage: native_runner.py owned/request.json')
        raise SystemExit(execute(Path(sys.argv[1]).resolve()))
    except Exception as error:
        emit('WEBSTOCK_NATIVE_ERROR=', dict(message=str(error), type=type(error).__name__))
        raise SystemExit(1)
