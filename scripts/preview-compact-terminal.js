// Isolated UI acceptance: real assets, synthetic fixtures, no production modules or DB.
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const app = express();
app.use(express.json());
const creatorQueueFixtures = [];
app.post('/api/expert/collection-queue', (req,res) => {
  const jobs = (req.body.channelIds || []).map(id => {
    let job = creatorQueueFixtures.find(item => item.channelId === id && item.status === 'queued');
    if (!job) { job = {id:creatorQueueFixtures.length+1,channelId:id,displayName:'合成作者 '+id,mode:req.body.mode,model:req.body.model,status:'queued',rounds:0,message:'合成队列：不会执行外部采集'}; creatorQueueFixtures.push(job); }
    return job;
  });
  res.json({success:true,data:jobs});
});
app.post('/api/expert/collection-queue/:id/:action',(req,res)=>{
  const job = creatorQueueFixtures.find(item=>item.id===Number(req.params.id));
  if (!job) return res.status(404).json({success:false,error:'合成任务不存在'});
  job.status=req.params.action==='cancel'?'cancelled':'queued';
  res.json({success:true,data:job});
});
const stocks = [{code:'000001', name:'验收样本A', market:'sz'}, {code:'600000', name:'验收样本B', market:'sh'}];
const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const creators = [1,2].map(id=>({id,displayName:'合成作者 '+id,platform:'douyin',subjectType:'creator',observationCount:3,directDouyinCount:3}));
const creatorRows = id => [1,2,3].map(n=>({id:id*10+n,channelId:id,externalContentId:'70000000000000000'+n,
  sourceUrl:'https://www.douyin.com/video/70000000000000000'+n,title:'合成阅读样本 '+id+'-'+n+'：如何区分原话、证据与推断',
  publishedAt:today+'T00:00:00+08:00',firstSeenAt:today+'T00:01:00+08:00',mediaType:'video',evidenceLevel:'primary',
  transcript:'这是隔离界面验收用的合成逐字稿，不对应任何真实作者或投资观点。\n\n研究时需要先核对来源、日期和数据口径，再区分事实与推断。样本中的股票、作者和评论均为测试数据，不会写入正式程序。',
  stockCodes:[],sectors:[],topics:['测试主题'],engagement:{likes:125,comments:2},
  signal:{keyPoints:['测试摘句：先核对来源、日期和口径。'],riskFlags:['合成样本，不可用于投资']},
  mediaMetadata:{asr:{status:'complete',model:'fixture',segments:[{start:0,end:12,text:'这是一段合成验收用逐字稿。'}]}}
}));
const minutes = Array.from({length:121}, (_,i) => {
  const value = 570+i, price = +(10 + Math.sin(i/17)*.12 + i*.001).toFixed(2);
  return {time:'2026-09-18 '+String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0')+':00', price, volume:10000+i*100, amount:price*(10000+i*100)};
});
const candles = Array.from({length:130},(_,i) => {
  const date = new Date(Date.UTC(2026,1,1+i)).toISOString().slice(0,10);
  const open=+(10+Math.sin(i/9)*.8).toFixed(2), close=+(open+Math.cos(i/8)*.18).toFixed(2);
  return {date, open, close, low:Math.min(open,close)-.1, high:Math.max(open,close)+.1,volume:1500000+i*10000,amount:15000000+i*100000};
});
app.use('/api', (req,res) => {
  if(req.method !== 'GET') return res.status(403).json({success:false,error:'隔离界面验收：不执行写入或外部任务'});
  const url=req.path;
  // Optional fixtures for the ownership review only. Never load a production DB.
  if (process.env.COMPACT_OWNERSHIP_REVIEW === '1') {
    const products = ['IF', 'IH', 'IC', 'IM'];
    if (url === '/market/institutional-flow/intraday') return res.json({success:true,data:{
      marketState:'latest-close',observedAt:'2026-09-18 15:00:00',refreshIntervalMs:60000,
      etfs:products.map((product,i)=>({product,code:['510300','510050','510500','512100'][i],name:['沪深300ETF','上证50ETF','中证500ETF','中证1000ETF'][i]+' · 合成样本',availability:'available',observedAt:'2026-09-18 15:00:00',changePct:0.6+i*.4,turnoverState:i>1?'expanding':'contracting',rolling5AmountYuan:30000000+i*8000000,previous5AmountYuan:45000000,latestMinuteAmountYuan:8000000,rolling5ChangePct:-30+i*20})),
      futures:products.map((product,i)=>({product,symbol:product+'0',name:'合成主力连续',availability:'available',observedAt:'2026-09-18 15:00:00',sessionChangePct:.5+i*.2,positioningState:'price-up-oi-up',price:3000+i*1000,minutePriceChange:1.5,minuteVolume:300,openInterestChange:120}))
    }});
    if (url === '/market/institutional-flow') return res.json({success:true,data:{
      etf:{availability:'available',asOf:'2026-09-17',source:{provider:'合成估算来源'},methodology:'隔离布局验收样本',items:[{code:'588000',name:'合成流入样本',direction:'inflow',estimatedNetFlowHundredMillion:12},{code:'159915',name:'合成流出样本',direction:'outflow',estimatedNetFlowHundredMillion:-8}]},
      futures:{availability:'available',asOf:'2026-09-18',methodology:'合成前20名披露样本',truthStatement:'仅验收布局',items:products.map(product=>({product,productName:'合成期货样本',contract:product+'2612',disclosedLong:10000,disclosedShort:12000,rankedMemberImbalance:-2000,rankedMemberImbalanceChange:-200,focusMembers:[{member:'中信期货',disclosedLong:1000,disclosedShort:1500,rankedMemberImbalance:-500,rankedMemberImbalanceChange:-80}]}))}
    }});
    if (url === '/market/etf-daily-report') return res.json({success:true,data:{availability:'unavailable',asOf:null,totalNetFlow:null,stockEtfNetFlow:null,source:'隔离样本未连接东方财富'}});
    if (url === '/paper-portfolios') return res.json({success:true,data:[]});
    if (url === '/quant/strategy-daily/schedule') return res.json({success:true,data:{action:'disabled',reason:'隔离验收不执行任务'}});
  }
  if(url==='/stocklist') return res.json(stocks);
  if(url==='/health') return res.json({success:true,data:{status:'ok',database:'test-fixture',version:'UI验收',checkedAt:new Date().toISOString()}});
  if(url==='/quote') return res.json((req.query.codes || '000001').split(',').map(code=>({code,name:'验收样本',price:10.12,change:1.2,prevClose:10,open:10.02,high:10.23,low:9.87,volume:1200000,amount:12000000,date:'2026-09-18'})));
  if(url==='/minute') return res.json(minutes);
  if(url==='/kline') return res.json(candles);
  if(url==='/portfolio/watchlist') return res.json({success:true,data:stocks.map((s,i)=>({...s,groupName:i?'产业链观察':'核心自选',price:10.12,change:1.2,notes:'合成验收数据，不是真实自选'}))});
  if(url==='/portfolio/tonghuashun-watchlist/catalog') return res.json({success:true,data:{groups:[],supportedCount:0}});
  if(url==='/expert/channels') return res.json({success:true,data:creators});
  if(url==='/expert/collection-queue') return res.json({success:true,data:{workerRunning:false,jobs:creatorQueueFixtures}});
  const observations=url.match(/^\/expert\/channels\/(\d+)\/observations$/);
  if(observations) return res.json({success:true,data:creatorRows(Number(observations[1]))});
  if(/^\/expert\/channels\/\d+\/observations\/\d+\/comments$/.test(url)) return res.json({success:true,data:{comments:[{id:1,authorName:'合成评论者',text:'仅用于验证保存评论的阅读布局。',publishedAt:today,likes:3}],total:1,hasMore:false}});
  if(/^\/expert\/channels\/\d+\/(backtests|sync\/runs)$/.test(url)) return res.json({success:true,data:[]});
  if(/^\/expert\/channels\/\d+\/sync$/.test(url)) return res.json({success:true,data:{enabled:false,status:'paused'}});
  if(url.includes('recent')) return res.json([]);
  if(url.includes('portfolio')) return res.json({positions:[],summary:{},allocation:[]});
  if(url.includes('models')) return res.json({success:true,data:{models:[],configured:false}});
  if(url.includes('news') || url.includes('trades')) return res.json([]);
  return res.status(503).json({success:false,error:'隔离界面验收：此数据源未连接',data:null});
});
app.get(['/','/index.html'], (_,res)=>res.type('html').send(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<title>股票行情看板</title>','<title>隔离界面验收</title>').replace('<body class="compact-terminal">','<body class="compact-terminal"><div style="position:fixed;right:12px;bottom:8px;z-index:9999;background:#874918;color:white;padding:3px 8px;font-size:12px;pointer-events:none">隔离验收 · 合成样本 · 未连接生产数据</div>')));
['css','js','icons','vendor'].forEach(dir=>app.use('/'+dir,express.static(path.join(root,dir))));
// Do not install a service worker in an isolated fixture origin.
app.get('/sw.js',(_,res)=>res.type('js').send('self.addEventListener("install", () => self.skipWaiting());'));
app.get('/manifest.webmanifest',(_,res)=>res.sendFile(path.join(root,'manifest.webmanifest')));
const server=app.listen(Number(process.env.COMPACT_PREVIEW_PORT || 43832),'127.0.0.1',()=>console.log('Isolated compact UI: http://127.0.0.1:'+server.address().port));
