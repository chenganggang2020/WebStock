(function(root){
  'use strict';
  // Filter results of the complete native ledger. Never recalculate cost from a date slice.
  function select(input,filter={}){
    const invalidRange=!!(filter.from&&filter.to&&filter.from>filter.to);
    const trades=invalidRange?[]:input.filter(t=>(!filter.from||t.date>=filter.from)&&(!filter.to||t.date<=filter.to)&&(!filter.code||t.code===filter.code)&&(!filter.side||t.side===filter.side));
    const value=(t,key)=>String(t[key+'Exact']??t[key]??'0');
    const scale=Math.max(2,...trades.flatMap(t=>['fee','netAmount','realizedPnl'].map(k=>(value(t,k).split('.')[1]||'').length)));
    const unit=(t,key)=>{const v=value(t,key),negative=v.startsWith('-'),[whole,fraction='']=v.replace(/^[-+]/,'').split('.');return BigInt(whole+fraction.padEnd(scale,'0'))*(negative?-1n:1n);};
    const divisor=10n**BigInt(scale-2),rounded=v=>{const magnitude=v<0n?-v:v,cents=(magnitude+divisor/2n)/divisor;return Number(v<0n?-cents:cents)/100;};
    const symbols=new Map(),days=new Map();
    let fees=0n,buyAmount=0n,sellProceeds=0n,realized=0n,buyCount=0,sellCount=0;
    for(const t of trades){
      const pnl=t.side==='sell'?unit(t,'realizedPnl'):0n;
      fees+=unit(t,'fee');realized+=pnl;
      if(t.side==='buy'){buyCount++;buyAmount+=unit(t,'netAmount');}else{sellCount++;sellProceeds+=unit(t,'netAmount');}
      const s=symbols.get(t.code)||{code:t.code,name:t.name||t.code,realizedPnl:0n,fees:0n,tradeCount:0};
      s.realizedPnl+=pnl;s.fees+=unit(t,'fee');s.tradeCount++;symbols.set(t.code,s);
      days.set(t.date,(days.get(t.date)||0n)+pnl);
    }
    let cumulative=0n;
    const series=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,realizedPnl:rounded(value),cumulative:rounded(cumulative+=value)}));
    return {invalidRange,trades,fees:rounded(fees),buyAmount:rounded(buyAmount),sellProceeds:rounded(sellProceeds),realizedPnl:rounded(realized),buyCount,sellCount,series,
      symbols:[...symbols.values()].map(s=>({...s,realizedPnl:rounded(s.realizedPnl),fees:rounded(s.fees)})).sort((a,b)=>b.realizedPnl-a.realizedPnl)};
  }
  const api={select};if(typeof module==='object'&&module.exports)module.exports=api;else root.PhonePortfolioModel=api;
})(typeof window==='object'?window:globalThis);
