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
                        'color': '#9bbce4', 'id': f'trade-{int(row.trade)}',
                        'label': '买' if buy else '卖',
                        'text': f'模拟{"买入" if buy else "卖出"} {row.price:.3f} 元 × {row.quantity} 股'})
    segments, inspections = [], []
    profit, loss, neutral = '#ef717a', '#43b99c', '#91a4bd'
    for i, row in enumerate(trades.itertuples(), 1):
        key = f'trade-{i}'
        tone = profit if row.PnL > 0 else loss if row.PnL < 0 else neutral
        segments.append({'id': key, 'fromDate': date(row.EntryTime), 'fromPrice': float(row.EntryPrice),
                         'toDate': date(row.ExitTime), 'toPrice': float(row.ExitPrice), 'color': tone})
        days = (pd.Timestamp(row.ExitTime) - pd.Timestamp(row.EntryTime)).days
        inspections.append({'id': key, 'title': f'交易 {i} · 已平仓', 'color': tone,
                            'value': f'{row.PnL:+,.2f} 元', 'subtitle': f'{row.ReturnPct:+.2%} · 扣费净盈亏',
                            'fields': [
                                {'label': '▲ 买入', 'value': f'{date(row.EntryTime)}\n{row.EntryPrice:.3f} 元'},
                                {'label': '▼ 卖出', 'value': f'{date(row.ExitTime)}\n{row.ExitPrice:.3f} 元'},
                                {'label': '持有 / 数量', 'value': f'{row.ExitBar-row.EntryBar} 根K · {days} 天\n{abs(row.Size):,} 股'},
                                {'label': '交易费用', 'value': f'{row.Commission:.2f} 元\n已计入盈亏'},
                            ]})
    # An open entry remains inspectable, but never receives a fabricated exit or
    # a realized-profit colour. The closed-trade IDs match the engine fill ledger.
    closed_ids = {item['id'] for item in inspections}
    for row in fills.itertuples():
        key = f'trade-{int(row.trade)}'
        if row.side != 'buy' or key in closed_ids:
            continue
        days = (pd.Timestamp(frame.time.iloc[-1]) - pd.Timestamp(row.time)).days
        inspections.append({'id': key, 'title': f'交易 {int(row.trade)} · 未平仓', 'color': neutral,
                            'value': '持仓中', 'subtitle': '截至回测末日 · 尚无卖出成交',
                            'fields': [
                                {'label': '▲ 买入', 'value': f'{date(row.time)}\n{row.price:.3f} 元'},
                                {'label': '▼ 卖出', 'value': '尚未卖出\n—'},
                                {'label': '持有 / 数量', 'value': f'{len(frame)-1-row.bar} 根K · {days} 天\n{row.quantity:,} 股'},
                                {'label': '买入费用', 'value': f'{row.price*row.quantity*parameters["feeBps"]/10000:.2f} 元\n不含未来卖出费'},
                            ]})
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
        'lines': lines, 'markers': markers, 'segments': segments, 'inspections': inspections,
        'legend': [
            {'label': '＋盈利', 'symbol': '┄', 'color': profit},
            {'label': '－亏损', 'symbol': '┄', 'color': loss},
            {'label': '零盈亏', 'symbol': '┄', 'color': neutral},
        ],
        'legendHint': '主图连线：红色＋盈利、绿色－亏损，均按扣费结果。▲买／▼卖只表示方向。原版报告保留原版配色。',
        'plots': [{'title': '资金与回撤', 'series': [
            series('权益', '元', '#579fdf', 'equity', equity),
            series('回撤', '%', '#cf993f', 'DrawdownPct', drawdown),
        ]}],
        'tables': [
            {'title': '成交', 'source': 'closed-trades', 'startDate': 'EntryTime', 'endDate': 'ExitTime',
             'inspectionIds': [f'trade-{i}' for i in range(1, len(trades)+1)],
             'columns': [{'field': field, 'label': label, 'decimals': decimals,
                          'format': 'date' if field.endswith('Time') else 'number'}
                         for field, label, decimals in [
                             ('EntryTime', '买入日期', 0), ('ExitTime', '卖出日期', 0),
                             ('Size', '股数', 0), ('EntryPrice', '买入价', 3),
                             ('ExitPrice', '卖出价', 3), ('PnL', '净盈亏 / 元', 2), ('Commission', '费用 / 元', 2)]]},
            {'title': '买卖点', 'source': 'fills', 'startDate': 'signalTime', 'endDate': 'time',
             'inspectionIds': [f'trade-{int(row.trade)}' for row in fills.itertuples()],
             'columns': [{'field': field, 'label': label,
                          'format': 'date' if field in ('signalTime', 'time') else 'number',
                          'labels': {'buy': '买入', 'sell': '卖出'} if field == 'side' else {},
                          'decimals': 0 if field == 'quantity' else 3} for field, label in
                         [('signalTime', '信号日期'), ('time', '成交日期'), ('side', '方向'),
                          ('price', '价格'), ('quantity', '数量')]]},
        ],
    }
