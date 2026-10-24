"""Backtesting.py's own engine and Bokeh report; no replacement chart renderer."""
import base64
import hashlib
import importlib.metadata
from pathlib import Path
from tempfile import TemporaryDirectory

import pandas as pd
from worker import table
from extension_view import make_view


def calculate(frame, parameters):
    from backtesting import Backtest, Strategy
    from backtesting.lib import crossover
    from bokeh.embed import file_html
    from bokeh.resources import INLINE

    p = parameters
    if p['fast'] >= p['slow'] or len(frame) <= p['slow'] + 2:
        raise ValueError('Need fast < slow and sufficient warmup bars')
    data = frame.set_index(pd.DatetimeIndex(pd.to_datetime(frame.time)))[
        ['open', 'high', 'low', 'close', 'volume']].rename(columns=str.title)

    class Cross(Strategy):
        def init(self):
            self.decisions = []
            self.fast = self.I(lambda a: pd.Series(a).rolling(p['fast']).mean(), self.data.Close, name='SMA_fast')
            self.slow = self.I(lambda a: pd.Series(a).rolling(p['slow']).mean(), self.data.Close, name='SMA_slow')

        def next(self):
            if not self.position and crossover(self.fast, self.slow):
                self.decisions.append((len(self.data) - 1, 1))
                self.buy(size=p['quantity'])
            elif self.position and crossover(self.slow, self.fast):
                self.decisions.append((len(self.data) - 1, -1))
                self.position.close()

    backtest = Backtest(data, Cross, cash=p['capital'], commission=p['feeBps']/10000,
                       trade_on_close=False, hedging=False, exclusive_orders=True, finalize_trades=False)
    result = backtest.run()
    equity = result['_equity_curve'].reset_index()
    equity.rename(columns={equity.columns[0]: 'time', 'Equity': 'equity'}, inplace=True)
    strategy = result['_strategy']
    decisions = dict(strategy.decisions)
    strategy_bars = pd.DataFrame({'time': data.index, 'fast': strategy.fast,
                                 'slow': strategy.slow,
                                 'signal': [decisions.get(i, 0) for i in range(len(data))]})
    # Include entries that remain open at the end. These must not disappear merely
    # because the original closed-trades report has no exit for them yet.
    fills = []
    all_trades = list(strategy.closed_trades) + list(strategy.trades)
    for trade_id, trade in enumerate(all_trades, 1):
        fills.append([data.index[trade.entry_bar], trade.entry_bar, 'buy', trade.entry_price,
                      abs(trade.size), data.index[trade.entry_bar - 1], trade_id])
        if trade.exit_bar is not None:
            fills.append([data.index[trade.exit_bar], trade.exit_bar, 'sell', trade.exit_price,
                          abs(trade.size), data.index[trade.exit_bar - 1], trade_id])
    fills = pd.DataFrame(fills, columns=['time', 'bar', 'side', 'price', 'quantity', 'signalTime', 'trade'])
    # Plot the SAME run, not a second calculation. INLINE removes CDN/runtime-server
    # dependencies. Bokeh and the upstream plot retain their own layout/tools.
    with TemporaryDirectory(prefix='webstock-backtesting-report-') as scratch:
        figure = backtest.plot(results=result, filename=str(Path(scratch)/'report.html'),
                               open_browser=False, superimpose=False, plot_drawdown=True)
        html = file_html(figure, INLINE, 'Backtesting.py | WebStock frozen backtest').encode('utf-8')
    if len(html) > 16 * 1024 * 1024:
        raise ValueError('Native report exceeds 16 MiB')
    return {
        'view': make_view(frame, p, equity, strategy_bars, fills, result['_trades']),
        'kind': 'backtest', 'engineVersion': importlib.metadata.version('backtesting'),
        'formulaVersion': 'backtesting-py-sma-cross-next-open-v1',
        'executionPolicy': {'signal': 'closed-bar SMA crossover', 'execution': 'next open',
                            'commissionRate': p['feeBps']/10000, 'slippage': 0,
                            'quantity': p['quantity'], 'initialCapital': p['capital'], 'marketRules': 'generic'},
        'tables': [table('equity', equity), table('closed-trades', result['_trades']),
                   table('strategy-bars', strategy_bars), table('fills', fills)],
        'nativeReport': {'schema': 'webstock.native-report.v1', 'name': 'backtesting-report.html',
                         'mime': 'text/html', 'renderer': 'backtesting.py/Bokeh', 'selfContained': True,
                         'sha256': hashlib.sha256(html).hexdigest(), 'base64': base64.b64encode(html).decode('ascii')},
        'warnings': ['通用历史研究适配器，未模拟A股T+1、涨跌停、历史税率和公司行动。',
                     '原版报告与明细来自同一次回测；末期持仓未强平，权益含未实现损益。']}
