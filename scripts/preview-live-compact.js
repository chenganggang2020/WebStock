// Edited UI + the running desktop's data, without starting another business server.
// Bound to loopback; every non-GET API request is blocked, not forwarded.
const express = require('express');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const app = express();
// Optional isolated evidence snapshot: migrations may only touch the copy in
// output/. Never pass the running desktop's database to this preview process.
if (process.env.WEBSTOCK_PREVIEW_KNOWLEDGE_DB) {
  const snapshot = path.resolve(process.env.WEBSTOCK_PREVIEW_KNOWLEDGE_DB);
  const output = path.resolve(root, 'output') + path.sep;
  if (!snapshot.startsWith(output) || !fs.existsSync(snapshot) || fs.lstatSync(snapshot).isSymbolicLink() || !fs.realpathSync(snapshot).startsWith(fs.realpathSync(path.resolve(root,'output')) + path.sep)) throw new Error('Evidence preview requires an existing isolated output snapshot');
  process.env.WEBSTOCK_DB_PATH = snapshot;
  const knowledge = require('../services/knowledgeService');
  app.get('/api/knowledge/authors', (_,res) => res.json({success:true,data:knowledge.listAuthors()}));
  app.get('/api/knowledge/sources', (req,res) => res.json({success:true,data:knowledge.listSources(req.query)}));
  app.get('/api/knowledge/sources/:id', (req,res) => res.json({success:true,data:knowledge.getSource(req.params.id)}));
}
// Exercise the new read-only article adapter without upgrading or stopping the
// user's desktop collector. Other data still comes from the running app.
const articles = require('../services/newsArticleService').createNewsArticleService();
app.get('/api/news/article', async (req,res) => res.json({success:true,data:await articles.read(req.query.url)}));
if(process.env.WEBSTOCK_PREVIEW_MARKET === '1') {
  if(!process.env.WEBSTOCK_PREVIEW_KNOWLEDGE_DB)throw Error('Market preview requires the isolated database snapshot');
  const darkStocks=require('../services/capitalFlow/darkStockService').createDarkStockService();
  const darkBoard=require('../services/capitalFlow/darkRankBoard').createDarkRankBoard({darkStocks});
  app.get('/api/capital-flow/dark-rank-board',async(req,res)=>{
    try {res.json({success:true,data:await darkBoard.get({date:req.query.date,metric:req.query.metric || 'amount'})});}
    catch(error){res.status(502).json({success:false,error:{message:error.message}});}
  });
  app.get('/api/market/global-signals',async(req,res)=>{
    try {res.json({success:true,data:await require('../services/globalMarketSignalService').fetch({force:req.query.refresh==='1'})});}
    catch(error){res.status(502).json({success:false,error:{message:error.message}});}
  });
  app.get('/api/market/global-index-trends',async(req,res)=>res.json({success:true,data:await require('../services/globalIndexTrendService').fetch()}));
  app.get('/api/hot-market/overview',async(req,res)=>{
    try {res.json({success:true,data:await require('../services/hotMarketService').getOverview({refresh:req.query.refresh==='1',fast:req.query.fast==='1'})});}
    catch(error){res.status(502).json({success:false,error:{message:error.message}});}
  });
}
app.use(['/api','/ai-status'], (req,res) => {
  if (req.method !== 'GET') return res.status(403).json({success:false,error:'新版只读验收：请在桌面程序中执行保存、采集或交易记录操作'});
  const upstream = http.get({hostname:'127.0.0.1',port:3000,path:req.originalUrl,headers:req.headers.range ? {Range:req.headers.range} : {},timeout:45000}, response=>{
    res.status(response.statusCode);
    res.setHeader('Content-Type',response.headers['content-type'] || 'application/json');
    res.setHeader('Cache-Control','no-store');
    ['content-range','accept-ranges','content-length'].forEach(name=>{ if(response.headers[name]) res.setHeader(name,response.headers[name]); });
    response.pipe(res);
  });
  upstream.on('timeout',()=>upstream.destroy(new Error('本机服务响应超时')));
  upstream.on('error',()=>{ if(!res.headersSent) res.status(502).json({success:false,error:'本机运行程序暂不可用，未使用演示数据替代'}); else res.end(); });
  res.on('close',()=>upstream.destroy());
});
app.get(['/','/index.html'],(_,res)=>res.type('html').send(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<body class="compact-terminal">','<body class="compact-terminal"><div style="position:fixed;right:10px;bottom:4px;z-index:9999;background:#222;color:#eee;padding:2px 8px;font-size:11px;pointer-events:none">新版界面验收 · ' + (process.env.WEBSTOCK_PREVIEW_KNOWLEDGE_DB ? '真实资料快照' : '本机真实数据') + ' · 写入关闭</div>')));
['css','js','icons','vendor'].forEach(dir=>app.use('/'+dir,express.static(path.join(root,dir))));
app.use('/ui-review',express.static(path.join(root,'output/playwright/compact-review')));
app.get('/sw.js',(_,res)=>res.type('js').send('self.addEventListener("install",()=>self.skipWaiting());'));
app.get('/manifest.webmanifest',(_,res)=>res.sendFile(path.join(root,'manifest.webmanifest')));
const port = Number(process.env.WEBSTOCK_PREVIEW_PORT) || 43833;
app.listen(port,'127.0.0.1',()=>console.log('New UI, live local read-only data: http://127.0.0.1:'+port));
