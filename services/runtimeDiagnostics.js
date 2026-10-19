// Inert in plain Node/server/tests until the desktop installs the independent sink.
let sink=null,sequence=0;
const instrumentedDatabases=new WeakSet();
function install(next){sink=next;}
function emit(event){try{if(sink)sink(event);}catch(_){/* Diagnostics must never break business operations. */}}
function begin(label,withStack=false) {
  if(!sink)return ()=>{};
  const id=++sequence;
  const stack=withStack?String(new Error().stack).split('\n').slice(2,9).map(line=>{
    const match=line.match(/(?:electron|services|routes|db|js)[\\/][^():?#\s]+:\d+:\d+/);return match?'at '+match[0]:'';
  }).filter(Boolean).join('\n'):'';
  emit({type:'begin',id,label,stack});let ended=false;
  return ()=>{if(!ended){ended=true;emit({type:'end',id});}};
}
function trace(label,work) {
  const end=begin(label,true);
  try {const result=work();if(result && typeof result.then==='function')return result.then(value=>{end();return value;},error=>{end();throw error;});end();return result;}
  catch(error){end();throw error;}
}
// Separately marks a synchronous Electron/native invocation, even when it
// returns a promise. The outer async span then describes only waiting time.
function traceSync(label,work) {
  const end=begin(label,true);try{return work();}finally{end();}
}
function routeLabel(req) {
  const route=String(req.path || '').split('?')[0].split('/').slice(0,6).map(part=>/^[a-z][a-z-]{0,40}$/.test(part)?part:part?':id':'').join('/');
  return String(req.method || 'GET').slice(0,8)+' '+route;
}
function middleware(req,res,next) {
  if(!sink || !String(req.path).startsWith('/api/') || req.path==='/api/health')return next();
  const end=begin(routeLabel(req));res.once('finish',end);res.once('close',end);next();
}
function instrumentDatabase(db) {
  if(!sink || instrumentedDatabases.has(db))return db;
  instrumentedDatabases.add(db);
  let transactionDepth=0;
  // A transaction span includes native BEGIN/COMMIT/ROLLBACK. Thousands of
  // nested row spans would flood IPC while obscuring that actual wait boundary.
  const databaseTrace=(label,work)=>transactionDepth?work():traceSync(label,work);
  const prepare=db.prepare;
  db.prepare=function(sql){
    const statement=databaseTrace('db.prepare',()=>prepare.call(this,sql));
    // A query fingerprint locates the statement without storing SQL/values.
    const hash=require('node:crypto').createHash('sha256').update(String(sql)).digest('hex').slice(0,12);
    for(const method of ['get','all','run']) {
      const original=statement[method];statement[method]=function(...args){return databaseTrace('db.'+method+'.'+hash,()=>original.apply(this,args));};
    }
    return statement;
  };
  const exec=db.exec;db.exec=function(sql){return databaseTrace('db.exec',()=>exec.call(this,sql));};
  const transaction=db.transaction;
  if(typeof transaction==='function')db.transaction=function(work){
    const native=transaction.call(this,work),wrapped=new Map();
    function wrap(fn){
      if(wrapped.has(fn))return wrapped.get(fn);
      const result=function(...args){
        const end=transactionDepth?()=>{}:begin('db.transaction',true);
        transactionDepth++;
        try{return fn.apply(this,args);}finally{transactionDepth--;end();}
      };
      wrapped.set(fn,result);
      return result;
    }
    const variants=[native,...['default','deferred','immediate','exclusive'].map(key=>native[key])]
      .filter(fn=>typeof fn==='function');
    variants.forEach(wrap);
    for(const fn of new Set(variants)) {
      const descriptors=Object.getOwnPropertyDescriptors(fn);
      for(const key of ['length','name','arguments','caller','prototype'])delete descriptors[key];
      for(const key of ['default','deferred','immediate','exclusive']) {
        if(descriptors[key] && typeof descriptors[key].value==='function')descriptors[key].value=wrap(descriptors[key].value);
      }
      Object.defineProperties(wrap(fn),descriptors);
    }
    return wrap(native);
  };
  return db;
}
module.exports={install,emit,begin,trace,traceSync,middleware,instrumentDatabase,routeLabel};
