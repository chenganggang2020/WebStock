"""Historical declared price bounds and observable displayed-book transitions."""
import csv
from decimal import Decimal,InvalidOperation
from pathlib import Path
import numpy as np
import pandas as pd
from panel_contract import timestamps
from worker import table


def ticks(value,tick):
    try:
        value=Decimal(str(value));tick=Decimal(str(tick));q=value/tick
        if not value.is_finite() or not tick.is_finite() or value<=0 or value>Decimal('1e8') or tick<=0 or tick>1000 or q>Decimal('1e14'):
            raise ValueError('Invalid price/tick')
        nearest=q.to_integral_value()
        if nearest<1 or abs(q-nearest)>Decimal('0.000001'):raise ValueError('Price not aligned to declared tick')
        return int(nearest)
    except (InvalidOperation,ZeroDivisionError):raise ValueError('Invalid price/tick') from None


def declared_bounds(b):
    required={'sessionstart','limitknownat','limitstatus','upperlimit','lowerlimit','pricetick','ruleid','source','sessionindex','calendarid'}
    if not required<=set(b):raise ValueError('Limit fields missing: '+', '.join(sorted(required-set(b))))
    d=b.copy()
    for key in ('sessionstart','limitknownat'):d[key]=timestamps(d[key],key)
    if (d.limitknownat>d.sessionstart).any():raise ValueError('Historical daily limits must be known by declared session start')
    if not d.limitstatus.isin(['bounded','unbounded']).all():raise ValueError('Explicit bounded/unbounded status required')
    for key in ('ruleid','source','calendarid'):
        if d[key].astype(str).str.strip().eq('').any() or d[key].astype(str).str.len().gt(256).any():raise ValueError('Missing/bounded limit provenance: '+key)
    if d.calendarid.nunique()!=1:raise ValueError('One declared calendar version required')
    d['sessionindex']=pd.to_numeric(d.sessionindex,errors='raise').astype(float)
    if not np.isfinite(d.sessionindex).all() or not d.sessionindex.between(0,1e9).all() or (d.sessionindex%1!=0).any():raise ValueError('Invalid sessionindex')
    d['sessionindex']=d.sessionindex.astype(int)
    uppers=[];lowers=[]
    for r in d.itertuples(index=False):
        ticks(r.pricetick,r.pricetick)
        if r.limitstatus=='unbounded':
            if str(r.upperlimit)!='' or str(r.lowerlimit)!='':raise ValueError('Unbounded rows must leave both daily bounds empty')
            uppers.append(None);lowers.append(None)
        else:
            up=ticks(r.upperlimit,r.pricetick);low=ticks(r.lowerlimit,r.pricetick)
            if up<=low:raise ValueError('Upper limit must exceed lower limit')
            uppers.append(up);lowers.append(low)
    d['upperTicks']=uppers;d['lowerTicks']=lowers
    return d


def breadth(b):
    d=declared_bounds(b)
    if not d.pricebasis.eq('raw').all():raise ValueError('Price-limit breadth requires raw prices')
    if 'traded' not in d or not d.traded.isin(['0','1']).all():raise ValueError('Explicit traded 0/1 required')
    if ((d.traded.eq('1')&(d.volume<=0))|(d.traded.eq('0')&(d.volume!=0))).any():raise ValueError('Traded flag differs from share volume')
    if ((d.sessionstart>d.barend)|(d.limitknownat>d.time)).any():raise ValueError('Future or inconsistent session/limit time')
    summary=[];detail=[];state={};previous_session=None;previous_end=None
    for time,rows in d.groupby('time',sort=False):
        if rows.sessionindex.nunique()!=1 or rows.sessionstart.nunique()!=1:raise ValueError('One synchronized declared session per decision')
        session=int(rows.sessionindex.iloc[0])
        if previous_session is not None and session!=previous_session+1:raise ValueError('Missing or repeated calendar sessions')
        if previous_end is not None and rows.sessionstart.iloc[0]<=previous_end:raise ValueError('Overlapping declared daily sessions')
        previous_end=rows.barend.iloc[0]
        previous_session=session;active=set(rows.loc[rows.member.eq(1),'symbol']);state={k:v for k,v in state.items() if k in active}
        counts=dict(universeCount=len(active),tradedCount=0,boundedTradedCount=0,unboundedCount=0,closedUpper=0,closedLower=0,touchedUpper=0,touchedLower=0,touchedUpperNotClosed=0,observedUpperStreakAtLeast2=0)
        for r in rows.itertuples(index=False):
            if not r.member:continue
            traded=r.traded=='1';bounded=r.limitstatus=='bounded';counts['tradedCount']+=int(traded);counts['unboundedCount']+=int(not bounded)
            high=ticks(r.high,r.pricetick);low=ticks(r.low,r.pricetick);close=ticks(r.close,r.pricetick);ticks(r.open,r.pricetick)
            if traded and bounded and (high>r.upperTicks or low<r.lowerTicks):raise ValueError('Traded OHLC exceeds supplied historical limits')
            upper=bool(traded and bounded and close==r.upperTicks);lower=bool(traded and bounded and close==r.lowerTicks)
            touched_up=bool(traded and bounded and high==r.upperTicks);touched_low=bool(traded and bounded and low==r.lowerTicks)
            previous=state.get(r.symbol);streak=(previous[0]+1 if previous else 1) if upper else 0
            censored=(previous[1] if previous else True) if upper else False
            state[r.symbol]=(streak,censored)
            counts['boundedTradedCount']+=int(traded and bounded);counts['closedUpper']+=int(upper);counts['closedLower']+=int(lower)
            counts['touchedUpper']+=int(touched_up);counts['touchedLower']+=int(touched_low);counts['touchedUpperNotClosed']+=int(touched_up and not upper)
            counts['observedUpperStreakAtLeast2']+=int(streak>=2)
            detail.append({'time':time,'symbol':r.symbol,'sessionindex':session,'closedUpper':upper,'closedLower':lower,'touchedUpper':touched_up,'touchedLower':touched_low,
                'observedUpperStreak':streak,'streakMayStartEarlier':censored,'traded':traded,'limitstatus':r.limitstatus,'upperlimit':r.upperlimit,'lowerlimit':r.lowerlimit,
                'pricetick':r.pricetick,'limitknownat':r.limitknownat,'ruleid':r.ruleid,'source':r.source})
        summary.append({'time':time,**counts})
    return {'kind':'indicator','engineVersion':'webstock-declared-limits-v1','formulaVersion':'webstock-limit-breadth-v1',
        'tables':[table('indicators',pd.DataFrame(summary)),table('security-limit-audit',pd.DataFrame(detail))],
        'inputSemantics':{'bounds':'externally supplied historical raw-price limits; known by session start','universe':'declared historical members',
                          'streak':'consecutive declared sessions with trades closing at upper bound; left-censored flag retained','providerCertified':False},
        'warnings':['按输入的历史涨跌停价和最小价位核对，不统一假设10%/20%，不从当前股票名称反推历史规则。',
            '日线只能区分触及、收盘到达及触及后未收于上限；不能推断真实封板/炸板次数。收盘到上限也不证明盘口无卖单。',
            '无成交、无价格限制或未收于上限会中断本定义的连续观察计数；样本开始或重新进入成分时的连板可能已在此前开始。']}


def load_limit_events(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as stream:
        reader=csv.reader(stream);names=[s.strip().lower() for s in next(reader,[])]
        if any(len(row)!=len(names) for row in reader):raise ValueError('Limit-event CSV row width differs from header')
    if not names or len(names)!=len(set(names)) or any(not s for s in names):raise ValueError('Duplicate or empty limit-event columns')
    b=pd.read_csv(path,dtype=str,keep_default_na=False,encoding='utf-8-sig');b.columns=names
    required={'time','eventtime','availableat','sequence','symbol','coverage','phase','bidprice','bidsize','askprice','asksize','lastprice','lasttradetime','currency','volumeunit','pricebasis'}
    if not required<=set(b):raise ValueError('Missing limit event columns: '+', '.join(sorted(required-set(b))))
    if not 2<=len(b)<=20000 or len(names)>48:raise ValueError('Limit events require 2..20000 rows and at most 48 columns')
    d=declared_bounds(b)
    for key in ('time','eventtime','availableat'):d[key]=timestamps(d[key],key)
    if not d.time.is_monotonic_increasing or not d.eventtime.is_monotonic_increasing:raise ValueError('Limit events must be chronological')
    if ((d.sessionstart>d.eventtime)|(d.eventtime>d.availableat)|(d.availableat>d.time)).any():raise ValueError('Future or inconsistent event availability')
    for key in ('symbol','source','coverage','currency','volumeunit','pricebasis'):
        if d[key].nunique()!=1 or d[key].eq('').any():raise ValueError('One explicit limit event declaration required: '+key)
    if not d.symbol.str.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,63}').all() or not d.coverage.isin(['events-complete','sampled']).all():raise ValueError('Invalid symbol or coverage')
    if not d.currency.isin(['CNY','USD','HKD']).all() or not d.volumeunit.eq('share').all() or not d.pricebasis.eq('raw').all():raise ValueError('Raw/share/currency event units required')
    if not d.phase.isin(['continuous','other']).all():raise ValueError('Explicit continuous/other trading phase required')
    if not d.sequence.str.fullmatch(r'[0-9]{1,15}').all():raise ValueError('Nonnegative integer sequence required')
    d['sequence']=d.sequence.astype('int64');delta=d.sequence.diff().iloc[1:]
    if (delta<=0).any() or (d.coverage.iloc[0]=='events-complete' and not delta.eq(1).all()):raise ValueError('Invalid/gapped declared event sequence')
    if not d.sessionindex.is_monotonic_increasing:raise ValueError('Session order reversed')
    previous_start=None
    for _,rows in d.groupby('sessionindex',sort=False):
        for key in ('sessionstart','limitknownat','limitstatus','upperlimit','lowerlimit','pricetick','ruleid'):
            if rows[key].nunique()!=1:raise ValueError('Daily price limit changed within a declared session')
        if previous_start is not None and rows.sessionstart.iloc[0]<=previous_start:raise ValueError('Session starts must increase')
        previous_start=rows.sessionstart.iloc[0]
    for key in ('bidsize','asksize'):
        d[key]=pd.to_numeric(d[key],errors='raise').astype(float)
        if not np.isfinite(d[key]).all() or not d[key].between(0,1e13).all() or (d[key]%1!=0).any():raise ValueError('Invalid displayed share size')
    for side in ('bid','ask'):
        values=[]
        for r in d.itertuples(index=False):
            price=getattr(r,side+'price');size=getattr(r,side+'size')
            if size==0:
                if price!='':raise ValueError('An empty book side must have empty price and zero size')
                values.append(np.nan)
            else:
                value=ticks(price,r.pricetick)
                if r.limitstatus=='bounded' and not r.lowerTicks<=value<=r.upperTicks:raise ValueError('Book price outside declared limits')
                values.append(value)
        d[side+'Ticks']=values
    if (d.bidTicks>d.askTicks).any():raise ValueError('Crossed books require explicit upstream normalization')
    last=[]
    for r in d.itertuples(index=False):
        if r.lastprice=='':
            if r.lasttradetime!='':raise ValueError('Missing trade price must have empty trade time')
            last.append(np.nan);continue
        when=timestamps(pd.Series([r.lasttradetime]),'lasttradetime').iloc[0]
        if when>r.eventtime:raise ValueError('Future last trade')
        value=ticks(r.lastprice,r.pricetick)
        if when>=r.sessionstart and r.limitstatus=='bounded' and not r.lowerTicks<=value<=r.upperTicks:raise ValueError('Current-session trade outside daily limits')
        last.append(value if when>=r.sessionstart else np.nan)
    d['lastTicks']=last
    return d


def sequence(b):
    rows=[];previous=None;counts=[0,0,0,0];complete=b.coverage.iloc[0]=='events-complete'
    for r in b.itertuples(index=False):
        bounded=r.limitstatus=='bounded';continuous=r.phase=='continuous';has_trade=np.isfinite(r.lastTicks)
        up=bool(continuous and bounded and has_trade and r.lastTicks==r.upperTicks and r.bidTicks==r.upperTicks and r.bidsize>0 and r.asksize==0)
        down=bool(continuous and bounded and has_trade and r.lastTicks==r.lowerTicks and r.askTicks==r.lowerTicks and r.asksize>0 and r.bidsize==0)
        eligible=continuous and bounded and has_trade
        comparable=previous is not None and r.sessionindex==previous[0] and eligible and previous[1]
        if previous is None or r.sessionindex!=previous[0]:counts=[0,0,0,0]
        changes=[int(up and not previous[2]),int(previous[2] and not up),int(down and not previous[3]),int(previous[3] and not down)] if comparable and complete else [None]*4
        if comparable and complete:counts=[x+y for x,y in zip(counts,changes)]
        status='outside-continuous-phase' if not continuous else 'unbounded' if not bounded else 'no-current-session-trade' if not has_trade else 'upper-sealed' if up else 'lower-sealed' if down else 'not-sealed'
        rows.append({'time':r.time,'sequence':r.sequence,'upperSealed':int(up) if eligible else None,'lowerSealed':int(down) if eligible else None,'state':status,
            'upperSealEntry':changes[0],'upperSealExit':changes[1],'lowerSealEntry':changes[2],'lowerSealExit':changes[3],
            'observedUpperEntries':counts[0] if complete else None,'observedUpperBreaks':counts[1] if complete else None,
            'observedLowerEntries':counts[2] if complete else None,'observedLowerBreaks':counts[3] if complete else None,
            'upperQueueShares':r.bidsize if bounded and r.bidTicks==r.upperTicks else 0.,
            'lowerQueueShares':r.asksize if bounded and r.askTicks==r.lowerTicks else 0.,
            'comparableKnownPredecessor':comparable,'coverage':r.coverage,'sessionindex':r.sessionindex,
            'eventtime':r.eventtime,'availableat':r.availableat,'lasttradetime':r.lasttradetime,'lastprice':r.lastprice,
            'bidprice':r.bidprice,'bidsize':r.bidsize,'askprice':r.askprice,'asksize':r.asksize,
            'upperlimit':r.upperlimit,'lowerlimit':r.lowerlimit,'ruleid':r.ruleid,'source':r.source})
        previous=(r.sessionindex,eligible,up,down)
    return {'kind':'indicator','engineVersion':'webstock-declared-limits-v1','formulaVersion':'webstock-limit-sequence-v1',
        'tables':[table('indicators',pd.DataFrame(rows))],
        'inputSemantics':{'symbol':b.symbol.iloc[0],'coverage':b.coverage.iloc[0],'providerCertified':False,
                         'counts':'only observed adjacent continuous-phase transitions; no inference before first snapshot or across phase boundary'},
        'warnings':['封板为本地明确盘口状态：连续竞价、当日最近成交在上/下限、对应限价有挂单且另一侧为空。只代表显示盘口，不代表隐藏流动性或可成交保证。',
            'events-complete须序号连续，计数只覆盖相邻连续竞价快照；首条已封板不算新封板。进入其他阶段不记为炸板。',
            'sampled只输出观察到的状态和队列，不给封板/炸板事件次数；上游完整性与历史价格限制仍需来源核验。']}


def calculate(operation,b,p):return breadth(b) if operation=='limit-breadth' else sequence(b) if operation=='limit-sequence' else (_ for _ in ()).throw(ValueError('Unknown limit operation'))
