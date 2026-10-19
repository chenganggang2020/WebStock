const {fetchDarkRank, buildQuery} = require('./eastmoneyDarkRank');

// On-demand only. Bounded, process-local cache; no database or scheduler.
function createDarkRankService(options = {}) {
  const load = options.load || fetchDarkRank, now = options.now || Date.now;
  const cache = new Map(), pending = new Map();
  const ttl = 60000;
  async function get(input) {
    buildQuery(input);
    const key = JSON.stringify([input.date,input.scope || 'stock',input.page || 1]);
    const old = cache.get(key);
    if (old && now() - old.savedAt < ttl) return {...old.data,cache:{hit:true,ttlSeconds:60}};
    if (!pending.has(key)) {
      if (pending.size >= 2) {const e = new Error('Too many dark rank queries');e.code='DARK_RANK_BUSY';throw e;}
      const task = Promise.resolve().then(()=>load(input)).then(result=>{
        const {raw, ...data} = result;
        cache.delete(key);
        cache.set(key,{data,savedAt:now()});
        while (cache.size > 32) cache.delete(cache.keys().next().value);
        return data;
      }).finally(()=>pending.delete(key));
      pending.set(key,task);
    }
    return {...await pending.get(key),cache:{hit:false,ttlSeconds:60}};
  }
  return {get};
}
module.exports = {createDarkRankService};
