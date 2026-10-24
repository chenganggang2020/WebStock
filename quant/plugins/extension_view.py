"""Presentation belongs to the plugin; the C++ host only draws typed primitives."""
import pandas as pd


def make_view(frame, parameters, equity, decisions, fills, trades):
    def date(v):
        return str(v)[:10]

    def series(name, unit, color, column, values):
        return {'name': name, 'unit': unit, 'color': color,
                'points': [[date(row.time), float(getattr(row, column))] for row in values.itertuples()]}

    lines = []
    for name, column, color in [('快线', 'fast', '#579fdf'), ('慢线', 'slow', '#cf993f')]:
        lines.append({'name': f'{name} SMA {parameters[column]}', 'color': color,
                      'points': [[date(row.time), None if pd.isna(getattr(row, column)) else float(getattr(row, column))]
                                 for row in decisions.itertuples()]})
    markers = []
    for i, row in enumerate(decisions.itertuples()):
        if row.signal:
            side = '买入' if row.signal > 0 else '卖出'
            markers.append({'date': date(row.time), 'price': float(frame.iloc[i].close),
                            'shape': 'diamond', 'category': 'signal', 'color': '#91a4bd',
                            'text': f'{side}信号 · 收盘确认，等待下一根开盘'})
    for row in fills.itertuples():
        buy = row.side == 'buy'
        markers.append({'date': date(row.time), 'price': float(row.price),
                        'shape': 'up' if buy else 'down', 'category': 'fill',
                        'color': '#dd6666' if buy else '#43a58d',
                        'text': f'模拟{"买入" if buy else "卖出"} {row.price:.3f} 元 × {row.quantity} 股'})
    final = float(equity.equity.iloc[-1])
    quantity = sum(int(row.quantity) * (1 if row.side == 'buy' else -1) for row in fills.itertuples())
    drawdown = equity.copy()
    drawdown['DrawdownPct'] *= 100
    return {
        'schema': 'webstock.chart-view.v1',
        'metrics': [
            {'label': '总收益', 'value': f'{(final / parameters["capital"] - 1) * 100:.2f}', 'unit': '%'},
            {'label': '最大回撤', 'value': f'{equity.DrawdownPct.max() * 100:.2f}', 'unit': '%'},
            {'label': '已平仓交易', 'value': str(len(trades)), 'unit': '笔'},
            {'label': '期末权益', 'value': f'{final:,.2f}', 'unit': '元'},
        ],
        'position': f'未平仓 {quantity:,} 股 · 简化成交模型',
        'lines': lines, 'markers': markers,
        'plots': [{'title': '资金与回撤', 'series': [
            series('权益', '元', '#579fdf', 'equity', equity),
            series('回撤', '%', '#cf993f', 'DrawdownPct', drawdown),
        ]}],
        'tables': [
            {'title': '成交', 'source': 'closed-trades', 'startDate': 'EntryTime', 'endDate': 'ExitTime',
             'columns': [{'field': field, 'label': label, 'decimals': decimals,
                          'format': 'date' if field.endswith('Time') else 'number'}
                         for field, label, decimals in [
                             ('EntryTime', '买入日期', 0), ('ExitTime', '卖出日期', 0),
                             ('Size', '股数', 0), ('EntryPrice', '买入价', 3),
                             ('ExitPrice', '卖出价', 3), ('PnL', '净盈亏 / 元', 2), ('Commission', '费用 / 元', 2)]]},
            {'title': '买卖点', 'source': 'fills', 'startDate': 'signalTime', 'endDate': 'time',
             'columns': [{'field': field, 'label': label,
                          'format': 'date' if field in ('signalTime', 'time') else 'number',
                          'labels': {'buy': '买入', 'sell': '卖出'} if field == 'side' else {},
                          'decimals': 0 if field == 'quantity' else 3} for field, label in
                         [('signalTime', '信号日期'), ('time', '成交日期'), ('side', '方向'),
                          ('price', '价格'), ('quantity', '数量')]]},
        ],
    }
