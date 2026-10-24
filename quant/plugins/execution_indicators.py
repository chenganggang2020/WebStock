"""Position-scoped stop ratchets and explicit-session relative volume."""
import re
import numpy as np
import pandas as pd
from panel_contract import timestamps

OPERATIONS={'atr-position-exit','rvol-at-time'}


def atr_position(b,p):
    from core_indicators import wilder
    b=b.reset_index(drop=True)
    tokens=[v.strip() for v in p['entryBars'].split(',')]
    if not tokens or len(tokens)>1000 or any(not re.fullmatch(r'[0-9]+',v) for v in tokens):
        raise ValueError('Entry bars must be up to 1000 increasing nonnegative integer indexes')
    entries=[int(v) for v in tokens]
    if entries!=sorted(set(entries)):raise ValueError('Entry bars must be distinct and increasing')
    if entries[0]<=p['period']:raise ValueError('First entry needs a fully known prior ATR')
    entries=set(entries);direction=1 if p['side']=='long' else -1;quantity=p['quantity'];rate=p['feeBps']/10000
    tr=pd.concat([b.high-b.low,(b.high-b.close.shift()).abs(),(b.low-b.close.shift()).abs()],axis=1).max(axis=1)
    tr.iloc[0]=np.nan;atr=wilder(tr,p['period'])
    position=0;stop=np.nan;entry=np.nan;entry_bar=None;peak=trough=np.nan;rows=[];realized=0.
    for i,row in b.iterrows():
        opened=exited=np.nan;reason='';pnl=np.nan;marked=np.nan;active_stop=np.nan
        if i in entries:
            if position:raise ValueError('Scheduled entry overlaps an existing position at bar '+str(i))
            if not np.isfinite(atr.iloc[i-1]):raise ValueError('Prior ATR unavailable for scheduled entry')
            position=direction;entry=opened=float(row.open);entry_bar=i;peak=trough=entry
            stop=entry-direction*p['multiple']*float(atr.iloc[i-1])
            if stop<=0:raise ValueError('Initial stop is not a positive price; choose a meaningful ATR multiple')
        if position:
            active_stop=stop
            gap=(row.open<=stop) if direction==1 else (row.open>=stop)
            touch=(row.low<=stop) if direction==1 else (row.high>=stop)
            if gap or touch:
                exited=float(row.open) if gap else stop;reason='gap-open' if gap else 'prior-stop-touch'
                pnl=direction*(exited-entry)*quantity-rate*(entry+exited)*quantity;realized+=pnl;position=0;stop=np.nan
            else:
                peak=max(peak,float(row.high));trough=min(trough,float(row.low))
                candidate=peak-p['multiple']*atr.iloc[i] if direction==1 else trough+p['multiple']*atr.iloc[i]
                stop=max(stop,candidate) if direction==1 else min(stop,candidate)
                marked=direction*(row.close-entry)*quantity-rate*entry*quantity
        rows.append({'time':row.time,'activeStopAtBarOpen':active_stop,'nextBarStop':stop if position else np.nan,
            'atrAtClose':atr.iloc[i],'entryFill':opened,'exitFill':exited,'exitReason':reason,
            'positionAfterBar':position,'entryBar':entry_bar if position or np.isfinite(exited) else np.nan,
            'realizedNetPnl':pnl,'cumulativeRealizedNetPnl':realized,'unrealizedAfterEntryFee':marked})
    notes=['事先指定的entryBars在该根开盘建立固定数量头寸；不是由事后最佳入场点推断出的交易策略。输入中的bar索引从0开始。',
        '初始止损=入场开盘价减/加此前已知Wilder ATR倍数；首个有效ATR以完整TR样本算术平均为种子。',
        '持仓内用入场以来最高/最低价与当前ATR更新，只收紧；当前收盘更新的线从下一根才生效，不回填当前根内高低顺序。',
        '已在开盘前生效的止损：跳空穿越按开盘价，否则当根触及按止损价。入场根止损只使用此前ATR，因此允许同根触及。',
        '每次新头寸重置极值与止损；安排的入场不得与未退出头寸重叠。未触发的末仓保留浮动损益，不强制清算。',
        '损益扣除显式比例入/出场费用，但未模拟借券、融资、滑点、停牌、涨跌停或A股T+1；短头寸仅为退出规则验算，不是完整可交易账户。']
    return pd.DataFrame(rows),notes


def rvol_at_time(b,p):
    required={'session','sessionindex','slot','sessionstart','barstart','barend','availableat','calendarid','volumeunit'}
    if not required<=set(b):raise ValueError('Session RVOL missing columns: '+', '.join(sorted(required-set(b))))
    d=b.reset_index(drop=True).copy();width=p['barSeconds'];history=p['sessions']
    for key in ('time','sessionstart','barstart','barend','availableat'):d[key]=timestamps(d[key],key)
    if ((d.barstart<d.sessionstart)|(d.barend>d.availableat)|(d.availableat>d.time)).any():raise ValueError('Future or inconsistent session-bar availability')
    if not (d.barend-d.barstart).dt.total_seconds().eq(width).all():raise ValueError('All bars need the declared fixed barSeconds duration')
    if d.calendarid.astype(str).str.len().lt(1).any() or d.calendarid.nunique()!=1:raise ValueError('One explicit provider calendar/version identifier required')
    if not d.volumeunit.eq('share').all():raise ValueError('Session volume must be in shares')
    d['session']=d.session.astype(str)
    if not d.session.str.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}').all():raise ValueError('Session label must be YYYY-MM-DD')
    pd.to_datetime(d.session,format='%Y-%m-%d',errors='raise')
    for key in ('sessionindex','slot'):
        d[key]=pd.to_numeric(d[key],errors='raise').astype(float)
        if not np.isfinite(d[key]).all() or (d[key]<0).any() or (d[key]%1!=0).any() or (d[key]>1e9).any():raise ValueError('Invalid '+key)
        d[key]=d[key].astype(int)
    offsets=(d.barstart-d.sessionstart).dt.total_seconds()
    if (offsets%width!=0).any():raise ValueError('Bar offsets must align to declared fixed duration')
    if not d.barstart.is_monotonic_increasing or d.barstart.duplicated().any():raise ValueError('Session source bars must strictly increase')
    if (d.barstart.iloc[1:]<d.barend.shift().iloc[1:]).any():raise ValueError('Session source bars cannot overlap')
    previous=[];current={};current_session=None;current_index=None;current_start=None;seen=set();last_slot=-1;last_offset=-1;cum=0.;complete=True;rows=[]
    for i,row in d.iterrows():
        offset=int(offsets.iloc[i])
        if row.session!=current_session:
            if row.session in seen:raise ValueError('Session cannot recur after another session')
            if current_session is not None:
                if row.sessionindex!=current_index+1:raise ValueError('Missing or unordered declared trading session index')
                if row.sessionstart<d.barend.iloc[i-1]:raise ValueError('New session anchor overlaps prior session bars')
                previous.append(current);previous=previous[-history:]
            if current_start is not None and row.sessionstart<=current_start:raise ValueError('Session anchors must increase')
            seen.add(row.session);current_session=row.session;current_index=row.sessionindex;current_start=row.sessionstart
            current={};last_slot=-1;last_offset=-1;cum=0.;complete=True
        if row.sessionindex!=current_index or row.sessionstart!=current_start:raise ValueError('Session index or anchor changed inside a session')
        if row.slot<=last_slot or offset<=last_offset:raise ValueError('Session slots and offsets must strictly increase')
        if row.slot==0 and offset!=0:raise ValueError('Slot zero must begin at its session anchor')
        if row.slot!=last_slot+1:complete=False
        cum+=row.volume;measure=cum if p['mode']=='cumulative' and complete else row.volume if p['mode']=='regular' else np.nan
        matches=[day[offset] for day in previous if offset in day and np.isfinite(day[offset])]
        baseline=np.mean(matches) if len(previous)==history and len(matches)==history else np.nan
        rvol=measure/baseline if np.isfinite(measure) and np.isfinite(baseline) and baseline>0 else np.nan
        status='complete' if np.isfinite(rvol) else 'current-cumulative-gap' if not np.isfinite(measure) else 'zero-historical-volume' if baseline==0 else 'missing-comparison-or-warmup'
        rows.append({'time':row.time,'relativeVolumeAtTime':rvol,'currentVolumeMeasure':measure,'historicalMean':baseline,
            'historicalMatchedSessions':len(matches),'session':row.session,'sessionIndex':row.sessionindex,'slot':row.slot,
            'offsetSeconds':offset,'status':status})
        current[offset]=measure;last_slot=row.slot;last_offset=offset
    notes=['同一会话锚点偏移和固定barSeconds，比较此前sessions个已声明交易会话；当前会话绝不进入自身分母。',
        'regular用该根成交股数；cumulative用会话开始累计股数，slot跳号后本会话累计值保持不可用。午休可跨时间间隔，但计划交易slot应连续。',
        '历史同偏移缺少一根或累计不完整就保留空值，不使用更早时刻代替。因此是明确的严格匹配版本，并非逐项复制TradingView缺失时采用此前可用根的规则。',
        'sessionindex必须逐会话连续，calendarid需明确提供方/版本；这只核验声明内部一致性，不能自动识别供应商未标出的缺失交易日。',
        '仅接受已闭合且已发布的带时区分钟/秒K线和share单位；日线不能推断盘中量比，零历史均量不输出无穷大。']
    return pd.DataFrame(rows),notes


def calculate(name,b,p):
    return atr_position(b,p) if name=='atr-position-exit' else rvol_at_time(b,p)
