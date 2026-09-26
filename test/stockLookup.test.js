const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('numeric codes use the online lookup and market prefixes match the local catalog', async () => {
  const urls = [];
  const window = {State:{allStocks:[{code:'600519',name:'贵州茅台'}]},
    ApiClient:{fetchJsonData:async url=>{urls.push(url);return {stocks:[{code:'920001',name:'新股样本'}]};}}};
  vm.runInNewContext(fs.readFileSync('js/modules/search.js','utf8'), {window,console});
  assert.equal(window.Search.searchStocks(' SH600519 ')[0]?.code, '600519');
  const result = await window.Search.searchStocksDeep('920001', []);
  assert.equal(result?.[0]?.code, '920001');
  assert.match(urls[0], /network=1/);
});

test('an empty search page never falls back to the whole stock catalog on scrolling', async () => {
  const window = {State:{searchQuery:'不存在',searchResults:[],allStocks:[{code:'000001'},{code:'000002'}],
    filteredStocks:[],currentPage:0,PAGE_SIZE:1}};
  const context = {window,document:{getElementById:()=>null}};
  vm.runInNewContext(fs.readFileSync('js/modules/stockList.js','utf8'),context);
  await window.StockList.loadMoreStocks();
  assert.equal(window.State.filteredStocks.length, 0);
});

test('public suggestions only accept supported A-share/ETF identities and preserve unavailable status', async () => {
  const {parseSuggestions,createPublicStockLookup} = require('../services/publicStockLookup');
  const raw = 'var suggestdata="sh600519,11,600519,sh600519,贵州茅台,,贵州茅台;sz159915,22,159915,sz159915,创业板ETF;gb_aapl,41,AAPL,gb_aapl,苹果;sh600519,11,600519,sh600519,重复;xx000001,11,000001,xx000001,错误市场";';
  const rows = parseSuggestions(raw);
  assert.deepEqual(rows.map(row=>row.code),['600519','159915']);
  assert.equal(rows[1].type,'fund');
  assert.deepEqual(parseSuggestions('var suggestdata="sh000001,11,000001,sh000001,上证指数;sz399436,11,399436,sz399436,绿色煤炭;sz000001,11,000001,sz000001,平安银行";').map(row=>row.name), ['平安银行'], 'index identities must not overwrite same-code stocks');
  let calls=0;
  const service=createPublicStockLookup({http:{get:async()=>{calls++;return {data:raw};}}});
  assert.equal((await service.search('贵州')).status,'available');
  await service.search('贵州');
  assert.equal(calls,1);
  const offline=createPublicStockLookup({http:{get:async()=>{throw Error('offline');}}});
  assert.deepEqual((await offline.search('600519')).stocks,[]);
  assert.equal((await offline.search('600519')).status,'unavailable');
});

test('stock-search opts into bounded online suggestions without losing local results', async () => {
  const routes = {}, router = {get:(url,handler)=>{routes[url]=handler;}};
  const code = fs.readFileSync('routes/stocks.js','utf8');
  const local = {query:'600519',stocks:[{code:'600519',name:'本地旧名称'}],themes:[]};
  let calls=0;
  vm.runInNewContext(code, {require:name=>({
    express:{Router:()=>router},fs:{readFileSync:()=>'[]'},path:require('node:path'),axios:{},
    'tiny-pinyin':{isSupported:()=>false},'../services/themeService':{decorateStock:stock=>stock},
    '../services/stockSearchService':{search:()=>structuredClone(local)},
    '../services/publicStockLookup':{search:async()=>{calls++;return {status:'available',stocks:[{code:'600519',name:'贵州茅台'},{code:'920001',name:'样本'}]};}}
  }[name]), module:{exports:{}},__dirname:process.cwd(),process:{env:{NODE_ENV:'test',WEBSTOCK_SKIP_FUND_REFRESH:'1'}},console:{log(){}}});
  let response;
  await routes['/stock-search']({query:{q:'600519',network:'1'}},{json:value=>{response=value;}},error=>{throw error;});
  assert.equal(calls,1);
  assert.equal(response.data.stocks.length,2);
  assert.equal(response.data.stocks[0].name,'贵州茅台');
  assert.equal(response.data.online.status,'available');
  await routes['/stock-search']({query:{q:'600519'}},{json(){}},error=>{throw error;});
  assert.equal(calls,1,'legacy local-only callers remain local');
});

test('real public ETF suggestions use fund identities and map only verified exchange ETF prefixes', () => {
  const {parseSuggestions} = require('../services/publicStockLookup');
  // Raw response shapes observed 2026-09-27, not exchange trading quotes.
  const rows = parseSuggestions('var suggestdata="of159915,22,159915,of159915,创业板ETF易方达,,创业板ETF易方达,99,1,,,;of510300,22,510300,of510300,沪深300ETF华泰柏瑞,,沪深300ETF华泰柏瑞,99,1,,,;of000001,22,000001,of000001,普通场外基金";');
  assert.deepEqual(rows.map(row=>[row.code,row.market,row.type]), [['159915','sz','fund'],['510300','sh','fund']]);
});
