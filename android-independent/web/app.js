(function() {
  'use strict';
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=value=>value===null || value===undefined || !Number.isFinite(Number(value))?'—':Number(value).toLocaleString('zh-CN',{maximumFractionDigits:2,minimumFractionDigits:2});
  const signed=value=>value===null || value===undefined?'—':(Number(value)>0?'+':'')+num(value)+'%';
  const color=value=>Number(value)>0?'up':Number(value)<0?'down':'';
  const flow=value=>value===null || value===undefined?'—':(Number(value)>=0?'+':'-')+(Math.abs(Number(value))>=1e8?(Math.abs(Number(value))/1e8).toFixed(2)+' 亿':(Math.abs(Number(value))/1e4).toFixed(2)+' 万');
  const time=value=>{if(!value)return'—';const d=new Date(/^\d{10}$/.test(String(value))?Number(value)*1000:value);return Number.isFinite(d.getTime())?d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):String(value);};
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const state={watch:[],accounts:[],trades:[],docs:[],reports:[],recent:[],quotes:{}};
  let view='dashboard',catalog=[],currentStock='',period='day',chartType='kline',selectedDoc='',account='local',watchGroup='',watchFilter='',watchSort='',docFilter='',selectedBoard='industry';
  let portfolio=null,chartData=null,minuteData=null,chart=null,sourceError='',settings={keySet:false},news=null;
  let indicator='macd',maPeriods=[5,10,20],showNine=false,chartExpanded=false;
  let stockList=[],stockListLabel='当前股票';
  try{const p=JSON.parse(localStorage.getItem('webstock-chart-preferences')||'{}');if(['ma','macd','kdj','rsi','cci','obv','atr'].includes(p.indicator))indicator=p.indicator;if(p.ma)maPeriods=PhoneChartModel.parseMA(p.ma);showNine=!!p.nine;}catch(_){}
  function saveChartPreferences(){localStorage.setItem('webstock-chart-preferences',JSON.stringify({indicator,ma:maPeriods.join(','),nine:showNine}));}
  function expandChart(value){chartExpanded=value;document.body.classList.toggle('chart-expanded',value);const button=document.querySelector('[data-action=expand-chart]');if(button)button.textContent=value?'收起图表':'全屏图表';requestAnimationFrame(()=>chart?.resize());}
  const ranks={},history=[],pending=new Map(),chartFrames=new Map(),quoteRequests=new Map(),lastChartRead=new Map(); let sequence=0,toastTimer,chartSequence=0,viewSequence=0,refreshTimer,historyLoading=false;
  window.WebStockNativeDone=(id,text)=>{
    const request=pending.get(String(id));if(!request)return;pending.delete(String(id));clearTimeout(request.timer);
    try{const response=JSON.parse(text);if(!response.success)throw Error(response.error||'本机操作失败');request.resolve(response.data);}catch(error){request.reject(error);}
  };
  function call(path,method='GET',body={}) {
    if(!window.WebStockNative) return Promise.reject(Error('浏览器预览没有安卓本地服务；请安装独立版 APK'));
    return new Promise((resolve,reject)=>{
      const network=/^\/(quotes|kline|kline-history|minute|rank|news)(\?|$)/.test(path),timeout=path==='/ai'?110000:network?30000:15000;
      const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error(method==='GET'?'读取超时，保留已有数据；可重试':'保存结果尚未确认，请先查看记录，勿重复提交'));},timeout);
      pending.set(id,{resolve,reject,timer});
      try{WebStockNative.request(id,JSON.stringify({path,method,body}));}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  function toast(message){const node=$('#toast');node.textContent=message;node.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.hidden=true,4500);}
  function icon(key){const paths={market:'<path d="M3 17l5-6 4 3 8-10M15 4h5v5M3 4v16h18"/>',watch:'<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z"/>',capital:'<path d="M4 20V10h4v10m2 0V4h4v16m2 0v-7h4v7M2 20h20"/>',research:'<path d="M12 5v15M3 4h5a4 4 0 0 1 4 2 4 4 0 0 1 4-2h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3Z"/>',more:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>'};return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[key]+'</svg>';}
  const pages=[['dashboard','市场','market'],['stock','个股详情','market'],['sectors','板块','market'],['etf','ETF','market'],['watch','我的自选','watch'],['portfolio','持仓','watch'],['trades','交易账本','watch'],['stats','账户统计','watch'],['recent','最近查看','watch'],['capital','公开资金','capital'],['docs','研究资料','research'],['evidence','证据库','research'],['news','资讯','research'],['ai','AI研究','research'],['reports','AI记录','research'],['more','全部功能','more'],['settings','手机设置','more'],['health','数据源状态','more'],['migration','迁移状态','more']];
  const groups=[['dashboard','行情','market'],['watch','自选','watch'],['capital','资金','capital'],['docs','研究','research'],['more','全部','more']];
  function group(){return view==='reader'?'research':pages.find(p=>p[0]===view)?.[2]||'more';}
  function navigate(next,record=true){if(next===view)return;expandChart(false);if(record)history.push({view,scroll:window.scrollY||0});view=next;viewSequence++;chartSequence++;render();window.scrollTo(0,0);refreshVisible(true).catch(error=>toast(error.message));scheduleRefresh();}
  window.WebStockPhoneBack=()=>{const signalDialog=$('#chartSignalDialog');if(signalDialog?.open){signalDialog.close();return true;}if($('#editor').open){$('#editor').close();return true;}if(chartExpanded){expandChart(false);return true;}if(!$('#searchResults').hidden){$('#searchResults').hidden=true;return true;}if(history.length){const previous=history.pop();navigate(previous.view,false);requestAnimationFrame(()=>window.scrollTo(0,previous.scroll));return true;}return false;};
  window.StandaloneApp={navigate,call,getState:()=>state};
  function symbol(code){return /^(sh|sz|bj)\d{6}$/.test(code)?code:(/^(92|4|8)/.test(code)?'bj':/^[569]/.test(code)?'sh':'sz')+code;}
  function stockName(code){return catalog.find(item=>item.code===code)?.name||state.quotes[symbol(code)]?.name||code;}
  function prepareCatalog(item){return {...item,searchKey:[item.code,item.name,item.pinyin,item.initials].filter(Boolean).join(' ').toLowerCase()};}
  function quoteSource(q){return q?(q.cached?'缓存 · ':'')+'新浪公开报价 · '+esc(q.tradeDate)+' '+esc(q.tradeTime)+' · 获取 '+esc(time(q.checkedAt)):'该代码行情尚不可用；不会补零';}
  function card(title,content,extra=''){return '<section class="card '+extra+'">'+(title?'<h2>'+title+'</h2>':'')+content+'</section>';}
  function empty(title,text){return '<div class="empty"><strong>'+esc(title)+'</strong>'+esc(text)+'</div>';}
  function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'';}catch(_){return '';}}
  function link(url,label){url=safeUrl(url);return url?'<a href="'+esc(url)+'">'+esc(label)+'</a>':'';}
  function render() {
    window.WebStockNative?.theme?.(document.body.classList.contains('dark'));
    if(chart){PhoneCharts.detach();chart.dispose();chart=null;}
    const activeGroup=group();
    $('#bottomNav').innerHTML=groups.map(([id,label,key])=>'<button data-page="'+id+'" aria-current="'+(activeGroup===key?'page':'false')+'">'+icon(key)+'<span>'+label+'</span></button>').join('');
    $('#sections').innerHTML=pages.filter(p=>p[2]===activeGroup && p[0]!=='stock').map(([id,label])=>'<button data-page="'+id+'" aria-current="'+(view===id?'page':'false')+'">'+label+'</button>').join('');
    document.body.dataset.page=view;
    const content=$('#content');
    if(view==='dashboard') content.innerHTML=dashboard();
    else if(view==='watch') content.innerHTML=watch();
    else if(view==='stock') content.innerHTML=stock();
    else if(view==='portfolio' || view==='stats') content.innerHTML=portfolioView();
    else if(view==='trades') content.innerHTML=tradesView();
    else if(view==='recent') content.innerHTML=card('最近查看',state.recent.length?state.recent.slice().reverse().map(item=>quoteRow(item)).join(''):empty('暂无浏览记录','搜索股票或从自选打开详情后，记录保存在手机。'));
    else if(['capital','sectors','etf'].includes(view)) content.innerHTML=rankView();
    else if(view==='news') content.innerHTML=newsView();
    else if(view==='docs' || view==='evidence' || view==='reports') content.innerHTML=docsView();
    else if(view==='reader') content.innerHTML=reader();
    else if(view==='ai') content.innerHTML=aiView();
    else if(view==='settings') content.innerHTML=settingsView();
    else if(view==='health') content.innerHTML=healthView();
    else if(view==='migration') content.innerHTML=migrationView();
    else content.innerHTML=menu();
    if(view==='stock') drawChart();
  }
  function dashboard(){const indices=[['sh000001','上证指数'],['sz399001','深证成指'],['sz399006','创业板指']];return '<div class="indices">'+indices.map(([id,label])=>{const q=state.quotes[id];return '<section class="card" data-index="'+id+'"><div class="index-name">'+label+'</div><div class="index-code">'+id.substring(2)+'</div><div class="number '+color(q?.changePercent)+'">'+num(q?.price)+'</div><div class="index-change '+color(q?.changePercent)+'">'+signed(q?.changePercent)+'</div><div class="source">'+(q?(q.cached?'缓存 · ':'')+esc(q.tradeDate)+' '+esc(q.tradeTime):'等待公开行情')+'</div></section>';}).join('')+'</div>'+card('我的自选','<div class="card-heading"><span class="muted">数据保存在这台手机</span><button data-page="watch">管理自选</button></div>'+(state.watch.length?state.watch.slice(0,8).map(item=>quoteRow(item)).join(''):empty('从第一只自选开始','上方搜索股票或 ETF，打开详情后加入本机分组。')))+card('研究与账户','<div class="grid-two"><button data-page="docs">'+state.docs.length+' 篇本机资料</button><button data-page="portfolio">'+state.accounts.length+' 个本机账户</button></div><p class="source">'+esc(sourceError||'行情直接联网获取。电脑程序是否运行，不影响本机工作台。')+'</p>')+card('', '<div class="warning">独立运行基础版：完整版功能正在迁移，竞价、明暗盘模型、产业链关系、采集与转写尚未迁移。</div><button data-page="migration" style="margin-top:10px">查看逐项迁移状态</button>');}
  function quoteRow(item,editable=false){const code=item.code,q=state.quotes[symbol(code)];return '<article class="quote-row" data-code="'+esc(code)+'"><div class="quote-name"><button data-stock="'+esc(code)+'">'+esc(item.name||stockName(code))+'</button><div class="quote-code">'+esc(code)+' '+esc(item.group||'')+'</div></div><div class="quote-price">'+num(q?.price)+'</div><div class="quote-change '+color(q?.changePercent)+'">'+signed(q?.changePercent)+'</div><div class="quote-source">'+quoteSource(q)+'</div>'+(editable?'<details class="quote-tools"><summary>分组、备注与操作</summary><p class="note">'+esc(item.note||'暂无备注')+'</p><button data-watch-edit="'+esc(item.id)+'">修改分组 / 备注</button><button data-delete-kind="watch" data-id="'+esc(item.id)+'">移出自选</button></details>':'')+'</article>';}
  function watch(){const groupOptions=[...new Set(state.watch.map(item=>item.group))];return card('我的自选','<div class="card-heading"><span class="badge">本机独立保存 · '+state.watch.length+' 只</span><button class="primary" data-action="add-watch">添加自选</button></div><div class="toolbar"><select id="watchGroup" aria-label="自选分组"><option value="">全部分组</option>'+groupOptions.map(g=>'<option value="'+esc(g)+'" '+(g===watchGroup?'selected':'')+'>'+esc(g)+'</option>').join('')+'</select><select id="watchSort" aria-label="自选排序"><option value="">默认顺序</option><option value="desc" '+(watchSort==='desc'?'selected':'')+'>涨跌幅降序</option><option value="asc" '+(watchSort==='asc'?'selected':'')+'>涨跌幅升序</option></select><input id="watchFilter" class="wide" placeholder="筛选名称 / 代码" value="'+esc(watchFilter)+'"></div><div id="watchRows">'+watchRows()+'</div><p class="source">行情来源：新浪公开快照。交易日以报价中的日期为准；非交易日不会伪装为实时交易。</p>');}
  function watchRows(){let rows=state.watch.filter(item=>(!watchGroup||item.group===watchGroup)&&(!watchFilter||String(item.name||'').includes(watchFilter)||item.code.includes(watchFilter)));if(watchSort)rows=rows.slice().sort((a,b)=>{const x=state.quotes[symbol(a.code)]?.changePercent,y=state.quotes[symbol(b.code)]?.changePercent;if(x==null)return y==null?0:1;if(y==null)return-1;return watchSort==='desc'?y-x:x-y;});return rows.length?rows.map(item=>quoteRow(item,true)).join(''):empty('暂无匹配的自选','切换分组、清空筛选，或添加新的关注股票。');}
  function stock(){
    if(!currentStock)return card('',empty('先选择一只股票','使用上方搜索或从自选进入详情。'));
    const q=state.quotes[symbol(currentStock)],selected=(a,b)=>a===b?'selected':'';
    return card('', '<div class="card-heading"><div><h2>'+esc(stockName(currentStock))+'</h2><span class="muted">'+esc(currentStock)+'</span></div><button class="primary" data-action="add-current">加入自选</button></div><div id="stockQuote">'+stockQuote()+'</div>')+
    card('', stockSwitcher()+'<div class="card-heading chart-heading"><b>'+esc(stockName(currentStock))+' · 行情图表</b><button data-action="expand-chart">'+(chartExpanded?'收起图表':'全屏图表')+'</button></div><div class="chart-controls"><select id="chartType" aria-label="图表类型"><option value="kline" '+selected(chartType,'kline')+'>K线</option><option value="minute" '+selected(chartType,'minute')+'>分时</option></select><select id="period" aria-label="K线周期" '+(chartType==='minute'?'hidden':'')+'>'+[['day','日K'],['week','周K'],['month','月K']].map(([id,label])=>'<option value="'+id+'" '+selected(period,id)+'>'+label+'</option>').join('')+'</select><select id="indicator" aria-label="技术指标" '+(chartType==='minute'?'hidden':'')+'>'+[['ma','成交量'],['macd','MACD'],['kdj','KDJ'],['rsi','RSI'],['cci','CCI'],['obv','OBV'],['atr','ATR']].map(([id,label])=>'<option value="'+id+'" '+selected(indicator,id)+'>'+label+'</option>').join('')+'</select></div><div id="chartReadout" class="chart-readout" aria-live="off">正在读取图表…</div><div id="chartLegend" class="chart-legend"></div><div id="chart" class="chart"></div><div class="chart-actions"><button data-action="chart-previous" aria-label="上一根K线或分时点">‹ 上一根</button><button data-action="chart-next" aria-label="下一根K线或分时点">下一根 ›</button><button data-action="chart-recent">最近</button><button data-action="chart-all">已加载</button></div><details class="chart-options"><summary>图表设置与口径</summary><div class="toolbar"><button data-action="chart-older">加载更早K线</button><button data-action="chart-ma">均线 '+maPeriods.join('/')+'</button><button data-action="chart-nine" aria-pressed="'+showNine+'">九转/序列 '+(showNine?'已开':'已关')+'</button></div><p class="note">双指缩放、拖动查看历史，轻触图表读取详情。K线首批请求最近 640 根，可按需加载更早记录（本次会话最多 5000 根）；不代表完整历史。只有来源、复权与重叠K线一致时才拼接；请求前复权，实际复权类型见下方。技术指标沿用电脑版算法，计算结果受历史样本范围影响。日、周、月K采用公开规则序列计数（Setup 1–9、条件满足后 Countdown 至13），未收盘待确认；不代表必然反转。分时仅价格1–9比较，不冒充完整OHLC序列。分时量为累计成交量之差，单位手；缺失时段留空。</p></details><p id="chartSource" class="source">正在获取对应股票的数据…</p>','stock-chart')+
    card('本机操作','<div class="toolbar"><button data-action="stock-trade">录入账本</button><button data-action="stock-ai">发起AI研究</button></div><p class="note">账本记录由你录入，不连接券商或发出交易委托。</p>');
  }
  function stockQuote(){const q=state.quotes[symbol(currentStock)];return '<div class="toolbar" aria-label="最新报价"><span class="number '+color(q?.changePercent)+'">'+num(q?.price)+'</span><span class="quote-change '+color(q?.changePercent)+'">'+signed(q?.changePercent)+'</span></div><div class="quote-summary">'+[['今开',q?.open],['最高',q?.high],['最低',q?.low],['昨收',q?.previousClose]].map(([label,value])=>'<span>'+label+' <b>'+num(value)+'</b></span>').join('')+'</div><div class="source">最新报价 · '+quoteSource(q)+'</div>';}
  function stockSwitcher(){const index=stockList.indexOf(currentStock);return '<div class="stock-switcher"><button data-action="stock-previous" '+(index<=0?'disabled':'')+' aria-label="上一只股票">‹ 上一只</button><span>'+esc(stockListLabel)+' · '+(index<0?1:index+1)+' / '+Math.max(1,stockList.length)+'</span><button data-action="stock-next" '+(index<0||index>=stockList.length-1?'disabled':'')+' aria-label="下一只股票">下一只 ›</button></div>';}
  function captureStockList(button){const search=button.closest('#searchResults'),container=search||$('#content');stockList=[...new Set([...container.querySelectorAll('[data-stock]')].map(item=>item.dataset.stock).filter(code=>/^\d{6}$/.test(code)))];if(!stockList.includes(button.dataset.stock))stockList=[button.dataset.stock];stockListLabel=search?'搜索结果':view==='watch'?(watchGroup||'全部自选'):pages.find(p=>p[0]===view)?.[1]||'当前列表';}
  function drawChart(){
    mountChartControls();
    const data=chartType==='minute'?minuteData:chartData;
    if(!data||data.symbol!==symbol(currentStock)||chartType==='kline'&&data.period!==period){if(chart){PhoneCharts.detach();chart.dispose();chart=null;}$('#chart').innerHTML=empty('等待图表数据','无数据时不绘制模拟曲线。');$('#chartReadout').textContent='正在读取所选周期…';$('#chartLegend').textContent='';return;}
    if(data.errorOnly){if(chart){PhoneCharts.detach();chart.dispose();chart=null;}$('#chart').innerHTML=empty('图表数据不可用',data.error);$('#chartSource').textContent=data.error;$('#chartReadout').textContent='暂无可读取的数据';return;}
    if(!data.rows?.length)return;
    chart=PhoneCharts.draw(data,{type:chartType,period,indicator,maPeriods,nine:showNine});
    const missingMA=chartType==='kline'?maPeriods.filter(value=>value>data.rows.length):[];
    $('#chartSource').textContent=(data.stale||data.cacheRead||data.cached?'缓存 · ':'')+(chartType==='minute'?'腾讯公开分时 · '+(data.date||'日期待核验'):'腾讯公开K线 · '+({qfq:'前复权',none:'未复权'}[data.adjustment]||'复权待核验')+' · 已加载 '+data.rows.length+' 根 · '+data.rows[0].date+' 至 '+data.rows.at(-1).date)+(missingMA.length?' · MA'+missingMA.join('/MA')+' 样本不足':'')+' · 获取 '+time(data.checkedAt)+(data.error?' · '+data.error:'');
  }
  function mountChartControls(){
    if($('#chartQuickPeriods'))return;
    const controls=$('.chart-controls');if(!controls)return;
    const tabs=document.createElement('div');tabs.id='chartQuickPeriods';tabs.className='chart-periods';tabs.setAttribute('aria-label','常用图表周期');
    const active=chartType==='minute'?'minute':period;
    tabs.innerHTML=[['minute','分时'],['day','日K'],['week','周K'],['month','月K']].map(([id,label])=>'<button data-chart-period="'+id+'" aria-pressed="'+(id===active)+'">'+label+'</button>').join('');controls.before(tabs);
    $('#chartType')?.classList.add('period-select');$('#period')?.classList.add('period-select');
  }
  function accountPicker(){return '<select id="account" aria-label="本机账户">'+state.accounts.map(a=>'<option value="'+esc(a.id)+'" '+(a.id===account?'selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>';}
  function portfolioView(){const p=portfolio;return card(view==='stats'?'账户统计':'我的持仓','<div class="toolbar">'+accountPicker()+'<button data-action="add-account">新增账户</button><button class="primary" data-action="add-trade">录入交易</button></div><p class="source">本机个人账本 · 不与电脑账户自动同步 · 行情日期见每个持仓</p>')+(p?card('持仓估值','<div class="grid-two">'+[['持仓成本',p.cost],['持仓市值',p.marketValue],['未实现盈亏',p.unrealizedPnl],['已实现盈亏',p.realizedPnl]].map(([label,value])=>'<div class="metric"><small>'+label+'</small><b class="'+(label.includes('盈亏')?color(value):'')+'">'+num(value)+'</b></div>').join('')+'</div>'+(p.missingQuotes?'<p class="warning">部分持仓缺少行情，合计估值与未实现盈亏暂不可用；不会将缺失价格计为零。</p>':'')+p.positions.map(item=>'<div class="document-row"><button data-stock="'+esc(item.code)+'">'+esc(item.name)+' <small>'+esc(item.code)+'</small></button><div class="row-value"><span>数量 / 平均成本</span><b>'+item.quantity+' / '+num(item.averageCost)+'</b></div><div class="row-value"><span>市值 / 未实现盈亏</span><b class="'+color(item.unrealizedPnl)+'">'+num(item.marketValue)+' / '+num(item.unrealizedPnl)+'</b></div><p class="source">'+quoteSource(item.quote)+'</p></div>').join('')+(p.positions.length?'':empty('本账户暂无持仓','录入买入交易后在手机计算持仓。'))):card('',empty('正在计算本机账本','本机交易独立保存，行情缺失时估值显示不可用。')));}
  function tradesView(){const rows=state.trades.filter(t=>t.accountId===account).slice().reverse();return card('交易账本','<div class="toolbar">'+accountPicker()+'<button class="primary" data-action="add-trade">新增交易</button></div><p class="note">买入、卖出及费用由你录入；按移动平均成本计算。不会向券商提交委托。</p>'+rows.map(t=>'<div class="document-row"><b>'+esc(t.name||t.code)+' · '+(t.side==='buy'?'买入':'卖出')+'</b><div class="row-value"><span>'+esc(t.date)+'</span><span>'+t.quantity+' 股 × '+num(t.price)+'</span></div><p class="source">费用 '+num(t.fee)+' · '+esc(t.note||'')+'</p><button data-trade-edit="'+esc(t.id)+'">编辑</button> <button data-delete-kind="trades" data-id="'+esc(t.id)+'">删除记录</button></div>').join('')+(rows.length?'':empty('暂无本机交易','本机记录与电脑数据库分别保存。')));}
  function rankKey(){return (view==='etf'?'etf':view==='sectors'?selectedBoard:'stocks')+':'+(view==='capital'?'flow':'change');}
  function rankView(){const data=ranks[rankKey()];return card(view==='capital'?'主力资金净流入':view==='etf'?'ETF 行情':'板块观察',(view==='sectors'?'<div class="toolbar"><button data-board="industry" '+(selectedBoard==='industry'?'class="primary"':'')+'>行业</button><button data-board="concept" '+(selectedBoard==='concept'?'class="primary"':'')+'>概念</button></div>':'')+'<p class="note">'+(view==='capital'?'东方财富公开资金模型 · 净额单位：元。此页不等同于电脑版的明盘 / 暗盘模型。':'公开榜单用于观察与发现，不作为产业链事实。')+'</p>'+(data?.errorOnly?empty('数据暂不可用',data.error):data?data.rows.map(row=>'<article class="quote-row"><div class="quote-name">'+(view==='sectors'?esc(row.name):'<button data-stock="'+esc(row.code)+'">'+esc(row.name)+'</button>')+'<div class="quote-code">'+esc(row.code)+'</div></div><div class="quote-price '+(view==='capital'?color(row.netFlow):'')+'">'+(view==='capital'?flow(row.netFlow):num(row.price))+'</div><div class="quote-change '+color(row.changePercent)+'">'+signed(row.changePercent)+'</div><div class="quote-source">数据时间 '+(row.dataTimestamp?esc(time(row.dataTimestamp*1000)):'接口未返回，待核验')+'</div></article>').join('')+source(data):empty('正在请求公开数据','数据直接由手机获取，没有电脑依赖。')));}
  function source(data){return '<p class="source">'+(data.stale?'缓存 · ':'')+esc(data.source)+' · 获取 '+esc(time(data.checkedAt))+(data.error?' · '+esc(data.error):'')+'</p>';}
  function newsView(){return card('财经资讯',news?.errorOnly?empty('资讯暂不可用',news.error):news?news.rows.map(item=>'<article class="document-row"><b>'+link(item.url,item.title)+'</b><p class="source">发布 '+esc(time(Number(item.publishedAt)*1000))+' · 新浪财经</p><p class="note">'+esc(item.summary)+'</p></article>').join('')+source(news):empty('正在获取资讯','资料原文在系统浏览器打开。'));}
  function docsView(){return card(view==='reports'?'AI研究记录':view==='evidence'?'证据库':'本机研究资料','<div class="toolbar">'+(view==='reports'?'': '<button class="primary" data-action="add-doc">新增资料</button><button data-action="import-doc">导入文本 / Markdown</button>')+'<input id="docFilter" class="wide" placeholder="搜索资料标题 / 内容" value="'+esc(docFilter)+'"></div><div id="docRows">'+docRows()+'</div><p class="note">原文、来源、时间和核验状态保存在手机；AI结果仍需原文核验。</p>');}
  function docRows(){const rows=(view==='reports'?state.reports:state.docs.filter(d=>view!=='evidence'||d.type==='evidence')).filter(d=>!docFilter||(d.title+' '+d.text).includes(docFilter)).slice().reverse();return rows.length?rows.map(d=>'<article class="document-row"><button data-doc="'+esc(d.id)+'" data-kind="'+(view==='reports'?'reports':'docs')+'">'+esc(d.title)+'</button><p class="source">'+(d.verification==='manuallyVerified'?'人工标记已核验':'待原文核验')+' · 保存 '+esc(time(d.updatedAt))+(d.topic?' · '+esc(d.topic):'')+'</p></article>').join(''):empty('暂无匹配资料','可新增原文记录、导入文本，或从手机发起 AI 研究。');}
  let selectedKind='docs';
  function currentDoc(){return state[selectedKind].find(d=>d.id===selectedDoc);}
  function reader(){const d=currentDoc();return d?card(esc(d.title),'<p class="source">'+(d.verification==='manuallyVerified'?'人工标记已核验':'待原文核验')+' · '+esc(time(d.updatedAt))+'</p>'+link(d.sourceUrl,'打开原文来源')+'<div class="toolbar"><button data-action="edit-doc">编辑资料</button><button data-action="doc-ai">AI整理</button><button data-delete-kind="'+selectedKind+'" data-id="'+esc(d.id)+'">删除</button></div><article class="reader">'+esc(d.text)+'</article>'):card('',empty('资料已不存在','返回目录重新选择。'));}
  function aiView(){return card('独立 AI 研究','<p class="note">手机直接调用你配置的 AI 服务，报告只保存在本机。不会使用电脑中的密钥或研究数据库。</p>'+(settings.keySet?'<span class="badge">已设置手机 AI · '+esc(settings.model)+'</span>':'<div class="warning">尚未配置手机 AI。需要服务地址、模型与自己的密钥；服务商可能按用量收费。</div>')+'<div class="toolbar"><button data-page="settings">设置手机 AI</button><button class="primary" data-action="ai-prompt">撰写研究问题</button></div><p class="source">输入原文、链接和可核验数据。结果默认标记“待原文核验”。</p>');}
  function settingsView(){return card('本机数据','<p class="note">电脑与安卓分别存储数据，各自运行。当前没有自动同步。备份文件不包含 AI 密钥。</p><div class="toolbar"><button data-action="export-backup">导出本机备份</button><button data-action="import-backup">导入独立版备份</button></div>')+card('手机 AI 服务','<p class="source">'+(settings.keySet?'手机密钥已加密保存':'手机尚未设置密钥')+'</p><div class="row-value"><span>服务地址</span><span>'+esc(settings.endpoint||'未设置')+'</span></div><div class="row-value"><span>模型</span><span>'+esc(settings.model||'未设置')+'</span></div><div class="toolbar"><button data-action="ai-settings">编辑手机 AI 设置</button>'+(settings.keySet?'<button data-action="clear-key">删除手机密钥</button>':'')+'</div>')+card('版本与功能','<p>独立安卓 2.2.0 · 连续看股与序列研究版</p><p class="note">要求 Android 8.0 及以上。基础功能在手机运行，完整电脑版功能迁移状态可逐项查看。</p><button data-page="migration">查看功能迁移状态</button>');}
  function healthView(){return card('手机数据源','<div class="row-value"><span>本机业务与数据</span><b>独立运行</b></div><div class="row-value"><span>新浪公开报价</span><b>'+esc(sourceError||'根据最新请求结果显示')+'</b></div><div class="row-value"><span>腾讯分时 / 前复权K线</span><span>选股后直接请求</span></div><div class="row-value"><span>东方财富公开榜单</span><span>按栏目请求 · 模型口径</span></div><div class="row-value"><span>付费 Level-2</span><span>未接入授权数据</span></div><p class="note">联网不代表每个数据源都可用。来源失败时保留本机缓存，并显示原交易日与刷新失败。</p>');}
  const pendingFeatures=[['完整市场情绪 / 量能工作台','尚未迁移原聚合模型'],['集合竞价','尚未迁移'],['图形解读 / 九转历史回看 / VWAP','尚未迁移；MA、MACD、KDJ、RSI、CCI、OBV、ATR 与九转/序列计数已迁移'],['期货盘中与日终披露','尚未迁移'],['明盘 / 暗盘原有模型','尚未迁移'],['板块轮动 / 资金快照回放','尚未迁移'],['固定来源 ETF 日终报告','尚未迁移'],['产业链关系与资料匹配','尚未迁移'],['本地候选筛选模型','尚未迁移'],['评论工坊','尚未迁移'],['抖音采集与自动转写','尚未迁移'],['情景测算 / 纸面组合与前向模拟','尚未迁移'],['同花顺 Windows 文件读取','需改为手机主动导入']];
  function migrationView(){return card('独立运行范围','<p class="note">本版使用手机本地业务、数据库与互联网数据源，已经移除电脑配对。基础行情、自选、账本、资料、证据与 AI 报告由手机处理。是否成功获取数据仍以对应页面状态为准。</p><div class="warning">尚未达到电脑版全部功能等价。以下条目没有借助电脑执行，也没有用空数据或新模型冒充原功能。</div>'+pendingFeatures.map(([name,status])=>'<div class="pending"><span>'+name+'</span><span>'+status+'</span></div>').join(''));}
  function menu(){return card('全部功能','<div class="menu-grid">'+pages.filter(p=>!['more','stock'].includes(p[0])).map(([id,label,key])=>'<button data-page="'+id+'">'+icon(key)+'<span>'+label+'<small>'+(['migration','health'].includes(id)?'查看能力与来源':'手机独立运行')+'</small></span></button>').join('')+'</div>');}
  async function sync(){Object.assign(state,await call('/state'));if(!state.accounts.some(a=>a.id===account))account=state.accounts[0]?.id||'local';}
  function patchQuotes(){
    for(const row of document.querySelectorAll('.quote-row[data-code]')){const q=state.quotes[symbol(row.dataset.code)],price=row.querySelector('.quote-price'),change=row.querySelector('.quote-change');if(price)price.textContent=num(q?.price);if(change){change.textContent=signed(q?.changePercent);change.className='quote-change '+color(q?.changePercent);}const source=row.querySelector('.quote-source');if(source)source.innerHTML=quoteSource(q);}
    const quote=$('#stockQuote');if(view==='stock'&&quote)quote.innerHTML=stockQuote();
    if(view==='dashboard')for(const box of document.querySelectorAll('[data-index]')){const q=state.quotes[box.dataset.index];box.querySelector('.number').textContent=num(q?.price);box.querySelector('.number').className='number '+color(q?.changePercent);box.querySelector('.index-change').textContent=signed(q?.changePercent);box.querySelector('.index-change').className='index-change '+color(q?.changePercent);box.querySelector('.source').textContent=q?(q.cached?'缓存 · ':'')+q.tradeDate+' '+q.tradeTime:'等待公开行情';}
  }
  async function refreshQuotes(){
    const symbols=[...new Set(view==='stock'&&currentStock?[symbol(currentStock)]:['sh000001','sz399001','sz399006',...state.watch.map(item=>symbol(item.code)),...state.trades.map(item=>symbol(item.code))])],key=symbols.join(',');
    if(quoteRequests.has(key))return quoteRequests.get(key);
    const requestView=view,requestAccount=account;$('#runtimeStatus').textContent='独立运行 · 手机正在刷新公开行情…';
    const task=(async()=>{try{const result=await call('/quotes?symbols='+key);for(const [code,value]of Object.entries(result.quotes||{}))if(value&&typeof value==='object'&&value.symbol){const old=state.quotes[code],stamp=q=>[q?.tradeDate||'',q?.tradeTime||'',q?.checkedAt||''].join(' ');if(!old||stamp(value)>=stamp(old))state.quotes[code]=value;}sourceError=result.error||'';if(view===requestView)$('#runtimeStatus').textContent='独立运行 · '+(result.stale?'行情刷新失败，保留缓存':result.missing?.length?'部分代码暂缺报价':'已获取公开报价');patchQuotes();if(['portfolio','stats'].includes(requestView)){const result=await call('/portfolio?account='+encodeURIComponent(requestAccount));if(view===requestView&&account===requestAccount){portfolio=result;render();}}}catch(error){sourceError=error.message;if(view===requestView)$('#runtimeStatus').textContent='独立运行 · 刷新失败，保留已有报价 · '+error.message;throw error;}})();
    quoteRequests.set(key,task);try{return await task;}finally{quoteRequests.delete(key);}
  }
  async function loadView(){
    const page=view,request=++viewSequence,requestAccount=account,valid=()=>view===page&&request===viewSequence;
    if(['portfolio','stats'].includes(page)){const result=await call('/portfolio?account='+encodeURIComponent(requestAccount));if(valid()&&account===requestAccount){portfolio=result;render();}}
    if(page==='settings'||page==='ai'){const result=await call('/settings');if(valid()){settings=result;render();}}
    if(page==='stock'&&currentStock)await loadChart();
    if(['capital','sectors','etf'].includes(page)){const key=rankKey(),[board,sort]=key.split(':');let result;try{result=await call('/rank?board='+board+'&sort='+sort);}catch(error){result=ranks[key]?.rows?{...ranks[key],stale:true,error:error.message}:{errorOnly:true,error:error.message};}if(valid()&&rankKey()===key){ranks[key]=result;render();}}
    if(page==='news'){let result;try{result=await call('/news');}catch(error){result=news?.rows?{...news,stale:true,error:error.message}:{errorOnly:true,error:error.message};}if(valid()){news=result;render();}}
  }
  const quoteViews=['dashboard','watch','stock','recent','portfolio','stats'],liveViews=[...quoteViews,'capital','sectors','etf','news'];
  function marketHours(){const d=new Date(Date.now()+8*3600000),m=d.getUTCHours()*60+d.getUTCMinutes();return d.getUTCDay()>0&&d.getUTCDay()<6&&(m>=555&&m<=690||m>=780&&m<=905);}
  function refreshDelay(){if(view==='news'||!marketHours())return 300000;const q=state.quotes[view==='stock'?symbol(currentStock):'sh000001'];return sourceError||q?.tradeDate&&q.tradeDate!==today()?60000:15000;}
  function scheduleRefresh(){clearTimeout(refreshTimer);if(document.hidden||!liveViews.includes(view))return;refreshTimer=setTimeout(async()=>{if(document.hidden)return;try{await refreshVisible(false);}catch(_){}finally{scheduleRefresh();}},refreshDelay());}
  async function refreshVisible(entry){
    if(document.hidden)return;const tasks=[];if(quoteViews.includes(view))tasks.push(refreshQuotes());
    const key=symbol(currentStock)+':'+chartType+':'+period,last=lastChartRead.get(key)||0;
    if((entry||view==='stock'&&Date.now()-last>=60000||['capital','sectors','etf','news'].includes(view))&&!(view==='stock'&&historyLoading))tasks.push(loadView());
    const results=await Promise.allSettled(tasks),failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  }
  document.addEventListener('visibilitychange',()=>{clearTimeout(refreshTimer);if(!document.hidden){refreshVisible(true).catch(error=>{sourceError=error.message;});scheduleRefresh();}});
  window.addEventListener('pagehide',()=>clearTimeout(refreshTimer));
  window.addEventListener('pageshow',()=>scheduleRefresh());
  async function loadChart(){
    const request=++chartSequence,code=currentStock,sym=symbol(code),type=chartType,requestedPeriod=period,key=sym+':'+type+':'+requestedPeriod;
    const previous=type==='minute'?minuteData:chartData;let cached=chartFrames.get(key)||(previous?.symbol===sym&&(type==='minute'||previous.period===requestedPeriod)?previous:null),freshResolved=false,freshError='';lastChartRead.set(key,Date.now());
    if(!cached)call('/chart-cache?code='+code+'&type='+type+'&period='+requestedPeriod).then(saved=>{if(!saved?.available||!saved.rows?.length||freshResolved||request!==chartSequence||currentStock!==code||chartType!==type||period!==requestedPeriod)return;cached={...saved,symbol:sym,period:requestedPeriod,...(freshError?{stale:true,error:freshError}:{})};chartFrames.set(key,cached);if(type==='minute')minuteData=cached;else chartData=cached;if(view==='stock')drawChart();}).catch(()=>{});
    if(cached){if(type==='minute')minuteData=cached;else chartData=cached;}
    if(view==='stock'){drawChart();$('#chartSource').textContent=(cached?'已显示缓存，正在更新 · 获取 '+time(cached.checkedAt):'正在获取对应股票的数据…');}
    let model;try{model=await call(type==='minute'?'/minute?code='+code:'/kline?code='+code+'&period='+requestedPeriod);if(!model?.rows?.length)throw Error('来源未返回有效图表数据');model={...model,symbol:sym,period:requestedPeriod};freshResolved=true;}catch(error){freshError='刷新失败，保留原数据；'+error.message;model=cached?.rows?.length?{...cached,stale:true,error:freshError}:{symbol:sym,period:requestedPeriod,errorOnly:true,error:error.message};}
    if(request!==chartSequence||currentStock!==code||chartType!==type||period!==requestedPeriod)return;
    if(type==='kline'&&cached?.historyLoaded&&freshResolved){try{model=PhoneChartModel.mergeHistory(model,cached);}catch(error){model={...cached,stale:true,error:'新数据与历史口径不一致，暂保留原图；'+error.message};}}
    if(model.rows?.length){chartFrames.delete(key);chartFrames.set(key,model);if(chartFrames.size>18)chartFrames.delete(chartFrames.keys().next().value);}
    if(type==='minute')minuteData=model;else chartData=model;if(view==='stock')drawChart();
  }
  async function loadEarlier(){
    if(historyLoading)return;if(chartType!=='kline'||!chartData?.rows?.length)throw Error('请先加载该股票的K线');if(chartData.rows.length>=5000)throw Error('本次会话已加载 5000 根；不代表完整上市历史');
    const request=++chartSequence,code=currentStock,p=period,current=chartData,before=current.rows[Math.min(15,current.rows.length-1)].date;historyLoading=true;
    try{const older=await call('/kline-history?code='+code+'&period='+p+'&before='+before);if(request!==chartSequence||currentStock!==code||period!==p||chartType!=='kline')return;const merged=PhoneChartModel.mergeHistory(current,older);if(merged.rows.length===current.rows.length)throw Error('来源未返回更早的可核对数据；不能据此认定历史已经完整');chartData={...merged,rows:merged.rows.slice(-5000)};chartFrames.set(symbol(code)+':kline:'+p,chartData);drawChart();}finally{historyLoading=false;}
  }
  async function openStock(code){
    if(!/^\d{6}$/.test(code))return;const samePage=view==='stock';currentStock=code;chartData=chartFrames.get(symbol(code)+':kline:'+period)||null;minuteData=chartFrames.get(symbol(code)+':minute:'+period)||null;$('#searchResults').hidden=true;$('#search').value='';
    if(samePage){render();loadChart().catch(e=>toast(e.message));}else navigate('stock');
    refreshQuotes().catch(e=>toast(e.message));
    const item={id:code,code,name:stockName(code)};state.recent=state.recent.filter(row=>row.code!==code).concat(item).slice(-100);
    call('/record','POST',{kind:'recent',item}).catch(error=>toast('最近浏览保存尚未确认；不影响看图 · '+error.message));
  }
  function field(label,name,value='',type='text',extra=''){return '<label for="f-'+name+'">'+label+'</label><input id="f-'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>';}
  function edit(title,body,onSubmit,localChart=false){const dialog=$('#editor');dialog.innerHTML='<form id="editForm"><h2>'+title+'</h2>'+body+'<div class="form-error" role="alert"></div><div class="actions"><button type="button" data-close>取消</button><button class="primary" type="submit">保存</button></div></form>';dialog.showModal();$('#editForm').onsubmit=async event=>{event.preventDefault();const submit=event.submitter;submit.disabled=true;try{await onSubmit(new FormData(event.currentTarget));dialog.close();if(localChart){const button=document.querySelector('[data-action=chart-ma]');if(button)button.textContent='均线 '+maPeriods.join('/');drawChart();}else{await sync();await loadView();render();}}catch(error){dialog.querySelector('.form-error').textContent=error.message;}finally{submit.disabled=false;}};}
  function watchEditor(item={}){edit(item.id?'编辑自选':'加入本机自选',field('股票代码','code',item.code||currentStock,'text','required pattern="[0-9]{6}" maxlength="6"')+field('分组','group',item.group||'默认分组','text','required maxlength="100"')+field('备注','note',item.note||''),async data=>{const code=String(data.get('code')).trim();await call('/record','POST',{kind:'watch',item:{...item,code,name:stockName(code),group:data.get('group'),note:data.get('note')}});});}
  function tradeEditor(item={}){edit(item.id?'编辑交易记录':'录入本机账本','<label>账户</label><select name="accountId">'+state.accounts.map(a=>'<option value="'+esc(a.id)+'" '+((item.accountId||account)===a.id?'selected':'')+'>'+esc(a.name)+'</option>').join('')+'</select>'+field('股票代码','code',item.code||currentStock,'text','required pattern="[0-9]{6}" maxlength="6"')+'<label>记录类型</label><select name="side"><option value="buy">买入</option><option value="sell" '+(item.side==='sell'?'selected':'')+'>卖出</option></select>'+field('交易日期','date',item.date||today(),'date','required')+field('数量（股）','quantity',item.quantity||100,'number','required min="1" step="1"')+field('成交价格','price',item.price||'','number','required min="0.000001" step="any"')+field('费用合计','fee',item.fee||0,'number','required min="0" step="any"')+field('备注','note',item.note||'')+'<p class="note">这是本机账本录入，不会发出交易委托。卖出不得超过该账户已录入持仓。</p>',async data=>{const value=Object.fromEntries(data);['quantity','price','fee'].forEach(key=>value[key]=Number(value[key]));value.name=stockName(value.code);await call('/record','POST',{kind:'trades',item:{...item,...value}});portfolio=null;});}
  function docEditor(item={},kind='docs'){edit(item.id?'编辑研究资料':'保存研究资料',field('标题','title',item.title||'','text','required')+field('主题 / 标签','topic',item.topic||'')+field('原文链接（可留空）','sourceUrl',item.sourceUrl||'','url')+'<label>原文 / 证据内容</label><textarea name="text" required>'+esc(item.text||'')+'</textarea><label class="check-label"><input name="verified" type="checkbox" '+(item.verification==='manuallyVerified'?'checked':'')+'>我已人工核验此条资料</label>',async data=>{await call('/record','POST',{kind,item:{...item,title:data.get('title'),topic:data.get('topic'),sourceUrl:data.get('sourceUrl'),text:data.get('text'),type:item.type||(view==='evidence'?'evidence':'document'),verification:data.has('verified')?'manuallyVerified':'unverified'}});});}
  function aiPrompt(prompt=''){edit('发起手机 AI 研究',field('报告标题','title','研究记录','text','required')+'<label>研究问题与原文材料</label><textarea name="prompt" required>'+esc(prompt)+'</textarea><p class="note">直接调用手机设置的 AI 服务，可能产生服务商费用；结果仍需原文核验。</p>',async data=>{await call('/ai','POST',{title:data.get('title'),prompt:data.get('prompt')});toast('报告已保存到手机 AI 记录');});}
  async function exportFile(mime,text){if(!window.WebStockExport)throw Error('文件导出需要安卓系统保存窗口');const bytes=new TextEncoder().encode(text);if(bytes.length>10485760)throw Error('导出超过 10 MB');let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));WebStockExport.save(mime,btoa(binary));}
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.type==='submit'&&button.closest('form'))return;
    if(button.hasAttribute('data-close')){$('#editor').close();return;}
    if(button.dataset.page){navigate(button.dataset.page);return;}
    button.disabled=true;
    try {
      if(button.dataset.stock){captureStockList(button);await openStock(button.dataset.stock);return;}
      if(button.dataset.board){selectedBoard=button.dataset.board;render();await loadView();return;}
      if(button.dataset.watchEdit){watchEditor(state.watch.find(i=>i.id===button.dataset.watchEdit));return;}
      if(button.dataset.tradeEdit){tradeEditor(state.trades.find(i=>i.id===button.dataset.tradeEdit));return;}
      if(button.dataset.doc){selectedDoc=button.dataset.doc;selectedKind=button.dataset.kind;navigate('reader');return;}
      if(button.dataset.deleteKind){if(!confirm('删除这条手机本地记录？'))return;await call('/record','DELETE',{kind:button.dataset.deleteKind,id:button.dataset.id});await sync();if(view==='reader')navigate(selectedKind==='reports'?'reports':'docs');else {await loadView();render();}return;}
      const action=button.dataset.action;
      if(button.dataset.chartPeriod){const requested=button.dataset.chartPeriod;if(['minute','day','week','month'].includes(requested)){chartType=requested==='minute'?'minute':'kline';if(chartType==='kline')period=requested;render();await loadChart();}return;}
      if(action==='stock-previous'||action==='stock-next'){const index=stockList.indexOf(currentStock),code=stockList[index+(action==='stock-previous'?-1:1)];if(code)await openStock(code);return;}
      if(action==='expand-chart')expandChart(!chartExpanded);
      if(action==='chart-previous')PhoneCharts.step(-1);if(action==='chart-next')PhoneCharts.step(1);
      if(action==='chart-recent')PhoneCharts.range(chartType==='minute'?0:65);if(action==='chart-all')PhoneCharts.range(0);
      if(action==='chart-older')await loadEarlier();
      if(action==='chart-nine'){showNine=!showNine;saveChartPreferences();button.textContent='九转/序列 '+(showNine?'已开':'已关');button.setAttribute('aria-pressed',showNine);drawChart();}
      if(action==='chart-ma')edit('自定义均线',field('均线周期（最多 8 条）','ma',maPeriods.join(','),'text','required'),async data=>{maPeriods=PhoneChartModel.parseMA(data.get('ma'));saveChartPreferences();},true);
      if(button.id==='refresh')await refreshVisible(true);
      if(button.id==='theme'){document.body.classList.toggle('dark');localStorage.setItem('webstock-independent-theme',document.body.classList.contains('dark')?'dark':'light');render();}
      if(action==='add-watch')watchEditor({code:''});if(action==='add-current')watchEditor();
      if(action==='add-trade'||action==='stock-trade')tradeEditor();
      if(action==='add-account')edit('新增本机账户',field('账户名称','name','','text','required maxlength="100"'),data=>call('/record','POST',{kind:'accounts',item:{name:data.get('name')}}));
      if(action==='add-doc')docEditor();if(action==='edit-doc')docEditor(currentDoc(),selectedKind);
      if(action==='import-doc')$('#documentFile').click();if(action==='import-backup')$('#backupFile').click();
      if(action==='export-backup')await exportFile('application/json',JSON.stringify(await call('/backup'),null,2));
      if(action==='ai-prompt')aiPrompt();if(action==='doc-ai'){const d=currentDoc();aiPrompt('请整理以下资料，区分原文事实、推断和待核验事项。\n标题：'+d.title+'\n来源：'+(d.sourceUrl||'用户导入的本机资料，原文来源待补充')+'\n\n'+d.text);}
      if(action==='stock-ai')aiPrompt('请基于下面的公开报价和来源信息整理该公司的研究问题、资料需求与风险，不捏造行情、财务数据或消息。\n'+JSON.stringify(state.quotes[symbol(currentStock)]||{code:currentStock,status:'行情暂不可用'},null,2));
      if(action==='ai-settings')edit('手机 AI 服务设置',field('AI服务完整地址','endpoint',settings.endpoint||'','url','placeholder="https://服务域名/v1/chat/completions" required')+field('模型名称','model',settings.model||'','text','required')+field(settings.keySet?'新密钥（留空保留原密钥）':'你自己的服务密钥','key','','password','autocomplete="new-password"')+'<p class="note">密钥仅在手机加密保存，不写入备份，也不读取电脑设置。</p>',data=>call('/settings','POST',Object.fromEntries(data)));
      if(action==='clear-key'&&confirm('删除手机保存的 AI 密钥？')){settings=await call('/settings','POST',{endpoint:settings.endpoint,model:settings.model,clearKey:true});render();}
    } catch(error){toast(error.message);}finally{button.disabled=false;}
  });
  document.addEventListener('change',async event=>{try{
    if(event.target.id==='watchGroup'){watchGroup=event.target.value;$('#watchRows').innerHTML=watchRows();}
    if(event.target.id==='watchSort'){watchSort=event.target.value;$('#watchRows').innerHTML=watchRows();}
    if(event.target.id==='account'){account=event.target.value;portfolio=null;render();await loadView();}
    if(event.target.id==='indicator'){indicator=event.target.value;saveChartPreferences();drawChart();}
    if(event.target.id==='period'||event.target.id==='chartType'){if(event.target.id==='period')period=event.target.value;else chartType=event.target.value;$('#period').hidden=chartType==='minute';$('#indicator').hidden=chartType==='minute';await loadChart();}
    if(event.target.id==='documentFile'){const file=event.target.files[0];if(!file)return;if(file.size>600000)throw Error('文本文件过大，请拆分');docEditor({title:file.name,text:await file.text()});event.target.value='';}
    if(event.target.id==='backupFile'){const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024)throw Error('备份超过 8 MB');const value=JSON.parse(await file.text());if(value.format!=='webstock-android-independent-v1')throw Error('不是独立安卓备份格式');if(confirm('将此备份合并到手机本地数据？相同记录ID会更新；AI密钥不会导入。')){await call('/backup','POST',value);await sync();render();toast('备份已合并到手机');}event.target.value='';}
  }catch(error){toast(error.message);}});
  document.addEventListener('input',event=>{if(event.target.id==='watchFilter'){watchFilter=event.target.value.trim();$('#watchRows').innerHTML=watchRows();}if(event.target.id==='docFilter'){docFilter=event.target.value.trim();$('#docRows').innerHTML=docRows();}});
  $('#search').addEventListener('input',event=>{const term=event.target.value.trim().toLowerCase(),node=$('#searchResults');if(!term){node.hidden=true;return;}let matches=catalog.filter(item=>item.searchKey.includes(term)).slice(0,30);if(!matches.length&&/^\d{6}$/.test(term))matches=[{code:term,name:'按代码查询 · 本地目录未收录'}];node.innerHTML='<div class="source search-scope">全市场本地目录 · 代码 / 名称 / 拼音 · '+matches.length+' 个结果'+(matches.length===30?'（最多展示 30 个，请细化搜索）':'')+'</div>'+(matches.length?matches.map(item=>'<button class="search-result" data-stock="'+esc(item.code)+'"><b>'+esc(item.name)+'</b><small>'+esc(item.code)+'</small></button>').join(''):empty('没有匹配的代码','可输入六位代码直接查询；本地目录不保证已包含最新上市股票。'));node.hidden=false;});
  window.addEventListener('resize',()=>chart?.resize());
  async function boot(){try{document.body.classList.toggle('dark',localStorage.getItem('webstock-independent-theme')==='dark');}catch(_){}render();try{const [stocks,funds]=await Promise.all([fetch('stocks.json').then(r=>r.json()),fetch('funds.json').then(r=>r.json())]);const entries=[...stocks,...(Array.isArray(funds)?funds:funds.funds||[])],seen=new Set();catalog=entries.filter(item=>item&&/^\d{6}$/.test(item.code)&&!seen.has(item.code)&&seen.add(item.code)).map(prepareCatalog);await sync();settings=await call('/settings');render();$('#runtimeStatus').textContent='独立运行 · 数据保存在本机';if(!document.hidden)await refreshQuotes();}catch(error){sourceError=error.message;$('#runtimeStatus').textContent='本机工作台 · '+error.message;}finally{scheduleRefresh();}}
  boot();
})();

