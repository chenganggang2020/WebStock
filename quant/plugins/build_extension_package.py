"""Build the independently installable chart extension, without machine paths."""
import argparse
import base64
import hashlib
import json
from pathlib import Path


def build(output):
    root = Path(__file__).parent
    names = ['worker.py', 'backtesting_report_worker.py', 'backtesting_native_report.py',
             'extension_view.py', 'THIRD_PARTY_NOTICES.txt']
    contents = {name: (root / name).read_bytes() for name in names}
    parameters = [
        dict(id='fast', title='快线 / 日', type='integer', default=10, minimum=2, maximum=10000),
        dict(id='slow', title='慢线 / 日', type='integer', default=30, minimum=2, maximum=10000),
        dict(id='capital', title='资金 / 元', type='number', default=100000, minimum=1, maximum=1e10),
        dict(id='quantity', title='单次 / 股', type='integer', default=1000, minimum=1, maximum=1000000),
        dict(id='feeBps', title='单边费率 / 基点', type='number', default=5, minimum=0, maximum=1000),
    ]
    manifest = {
        'schema': 'webstock.plugin.manifest.v1', 'protocolVersion': 1,
        'id': 'org.webstock.backtesting-py', 'version': '0.29.1', 'name': 'Backtesting.py 策略回测',
        'license': 'AGPL-3.0', 'runtime': 'python', 'entrypoint': 'backtesting_report_worker.py',
        'nativeReport': 'webstock.native-report.v1',
        'distributions': ['backtesting', 'numpy', 'pandas', 'bokeh'],
        'ui': {
            'apiVersion': 1, 'placement': 'chart', 'title': '策略回测', 'toolbarLabel': '策略',
            'summary': '在当前 K 线上查看信号、模拟买卖点和收益',
            'rules': '使用当前股票完整日 K。收盘信号，下一根开盘模拟成交。\n'
                     '只做多；单次股数和费用可调。尚未完整模拟 A 股 T+1、涨跌停和历史税费。',
            'preview': [
                {'color': '#579fdf', 'values': [.15,.24,.2,.39,.43,.4,.56,.75,.69,.84,.76,.7]},
                {'color': '#cf993f', 'values': [.21,.22,.25,.29,.34,.39,.44,.5,.57,.64,.7,.73]},
            ],
        },
        'operations': [{'id': 'sma-cross', 'title': '双均线',
                        'formulaVersion': 'backtesting-py-sma-cross-next-open-v1',
                        'inputKind': 'ohlcv-single-csv', 'outputKind': 'backtest',
                        'description': '收盘信号，下一根开盘模拟成交', 'parameters': parameters}],
        'files': {name: hashlib.sha256(raw).hexdigest() for name, raw in contents.items()},
    }
    package = {'schema': 'webstock.plugin.package.v1', 'manifest': manifest,
               'files': {name: base64.b64encode(raw).decode('ascii') for name, raw in contents.items()}}
    output.mkdir(parents=True, exist_ok=True)
    path = output / f'{manifest["id"]}-{manifest["version"]}.wspkg'
    path.write_text(json.dumps(package, ensure_ascii=False, indent=2), encoding='utf-8')
    print(path)
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args().output)
