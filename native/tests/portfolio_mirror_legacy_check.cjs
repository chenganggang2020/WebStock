const fs=require('fs');
const path=require('path');
const vm=require('vm');
const repo=path.resolve(__dirname,'../..');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let writes=0;
const blocked=()=>{writes++;throw Error('Legacy IO/mutation forbidden in mirror parser reference');};
const sandbox={module:{exports:{}},exports:{},Buffer,console,process:{platform:'win32',env:{}},__dirname:path.join(repo,'services'),require(name){
 if(name==='fs')return new Proxy({}, {get(){return blocked;}});
 if(name==='path')return path;
 if(name==='crypto')return require('crypto');
 if(name==='iconv-lite')return {decode:blocked};
 if(name==='./portfolioService')return new Proxy({}, {get(){return blocked;}});
 if(name==='./tonghuashunWatchlistService')return {loadSecurityCatalog:()=>new Map()};
 throw Error('Unexpected dependency '+name);
}};
vm.runInNewContext(fs.readFileSync(path.join(repo,'services/tonghuashunHoldingService.js'),'utf8'),sandbox,{filename:'actual-tonghuashunHoldingService.js'});
const parsed=sandbox.module.exports.parseHoldingText(fixture.source.rawUtf8);
const holding=parsed.holdings[0];
const expected=fixture.source.snapshots[0].holdings[0];
for(const field of ['code','name','quantity','costValue','currentPrice']){
 if(holding[field]!==expected[field])throw Error('Actual old parser reference mismatch '+field);
}
if(writes!==0)throw Error('Legacy DB/IO mutation occurred');
console.log('PortfolioMirror actual legacy parser PASS 5; zero legacy DB/IO writes; mutating sync not invoked');
