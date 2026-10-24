"""Compare the native-report adapter against the existing adapter's ledger output."""
import base64
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from worker import clean, load_bars
from backtest_adapters import calculate as legacy
from backtesting_native_report import calculate


class Sources(HTMLParser):
    def __init__(self):
        super().__init__(); self.remote = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'img', 'link', 'iframe'):
            for key in ('src', 'href'):
                if attrs.get(key, '').startswith(('http:', 'https:', '//')):
                    self.remote.append(attrs[key])


class NativeReportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame = load_bars(Path(sys.argv[1]))
        cls.p = dict(fast=10, slow=30, capital=100000, quantity=1000, feeBps=5)
        cls.result = clean(calculate(cls.frame, cls.p))

    def test_same_equity_trades_and_execution_as_existing_plugin(self):
        old = clean(legacy('backtesting-py', self.frame, self.p))
        self.assertEqual(self.result['tables'][:2], old['tables'])
        self.assertEqual(self.result['executionPolicy'], old['executionPolicy'])
        self.assertEqual(self.result['formulaVersion'], old['formulaVersion'])

    def test_view_matches_verified_ledger(self):
        view = self.result['view']
        tables = {t['id']: t for t in self.result['tables']}
        fills = tables['fills']['rows']
        markers = [m for m in view['markers'] if m['category'] == 'fill']
        self.assertEqual(len(markers), len(fills))
        self.assertEqual([m['price'] for m in markers], [r[3] for r in fills])
        self.assertEqual(int(view['metrics'][2]['value']), len(tables['closed-trades']['rows']))
        self.assertAlmostEqual(float(view['metrics'][3]['value'].replace(',', '')),
                               tables['equity']['rows'][-1][1], places=2)
        self.assertEqual([p[1] for p in view['plots'][0]['series'][0]['points']],
                         [r[1] for r in tables['equity']['rows']])

    def test_report_is_self_contained_and_digest_matches(self):
        artifact = self.result['nativeReport']
        raw = base64.b64decode(artifact['base64'], validate=True)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), artifact['sha256'])
        self.assertLess(len(raw), 16 * 1024 * 1024)
        html = raw.decode('utf-8'); parser = Sources(); parser.feed(html)
        self.assertEqual(parser.remote, [])
        for term in ['Bokeh', 'BoxZoomTool', 'HoverTool', 'SaveTool', 'SMA_fast', 'SMA_slow']:
            self.assertIn(term, html)
        json.dumps(self.result, allow_nan=False)

    def test_invalid_warmup_and_parameters(self):
        with self.assertRaises(ValueError): calculate(self.frame, {**self.p, 'fast':30})
        with self.assertRaises(ValueError): calculate(self.frame.head(20), self.p)

    def test_chart_fills_follow_recorded_close_signals(self):
        tables = {t['id']: t for t in self.result['tables']}
        signals = {r[0][:10]: r[3] for r in tables['strategy-bars']['rows']}
        for fill in tables['fills']['rows']:
            self.assertEqual(fill[5][:10], self.frame.iloc[fill[1]-1].time[:10])
            self.assertEqual(signals[fill[5][:10]], 1 if fill[2]=='buy' else -1)
            self.assertAlmostEqual(fill[3], self.frame.iloc[fill[1]].open)
        self.assertEqual(len(tables['strategy-bars']['rows']), len(self.frame))

    def test_open_position_entry_is_visible_without_forced_exit(self):
        frame = self.frame.head(80).copy()
        prices = [20-i*.1 for i in range(40)] + [16+i*.2 for i in range(40)]
        for column in ['open','high','low','close']: frame[column] = prices
        output = clean(calculate(frame, {**self.p, 'fast':2, 'slow':5, 'quantity':1}))
        tables = {t['id']: t for t in output['tables']}
        self.assertEqual(len(tables['closed-trades']['rows']), 0)
        self.assertEqual(len(tables['fills']['rows']), 1)
        self.assertEqual(tables['fills']['rows'][0][2], 'buy')


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0]], verbosity=2)
