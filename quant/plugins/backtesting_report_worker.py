"""A Backtesting.py-only entry point using the existing frozen-job protocol."""
import json
import sys
import traceback
import worker
from backtesting_native_report import calculate


def compute(manifest, operation, frame, parameters):
    if manifest['id'] != 'org.webstock.backtesting-py' or operation['id'] != 'sma-cross':
        raise ValueError('This entry point only supports Backtesting.py SMA crossover')
    return calculate(frame, parameters)


if __name__ == '__main__':
    worker.compute = compute
    try:
        worker.main()
    except Exception as error:
        print(json.dumps({'event': 'error', 'message': str(error)}, ensure_ascii=False), flush=True)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
