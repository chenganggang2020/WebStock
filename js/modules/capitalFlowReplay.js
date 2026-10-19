(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.CapitalFlowReplay = api.createReplayModule({document:root.document, fetch:root.fetch.bind(root)});
    root.CapitalFlowReplay.bind();
  }
})(typeof window !== 'undefined' ? window : null, function() {
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {BASELINE:'起始基线', DELTA:'区间变化', REVISION_BASELINE:'修订基线',
    BLOCKED:'冲突阻断', LATE:'迟到隔离', DUPLICATE:'重复记录', STALE_REVISION:'旧修订隔离', STALE_RESET:'旧重置隔离'};
  const continuity = {gap:'采样缺口', 'session-break':'午休分段', unknown:'采样间隔未知', continuous:'间隔符合设置', 'not-applicable':'不计算区间变化'};
  function formatCents(value) {
    if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return '--';
    const n = BigInt(value), abs = n < 0n ? -n : n;
    return (n < 0n ? '-' : '') + (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') +
      '.' + (abs % 100n).toString().padStart(2,'0') + ' 元';
  }
  const money = value => '<span class="flow-replay-' + (value != null && BigInt(value) > 0n ? 'up' : value != null && BigInt(value) < 0n ? 'down' : 'neutral') + '">' + formatCents(value) + '</span>';
  const time = ms => new Date(ms).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const key = x => JSON.stringify(['sourceId','methodologyId','venue','symbol','tradingDay','metricId','period','unit'].map(k=>x[k]));
  function renderRows(records) {
    return records.map(({snapshot:x,result:r}) => '<tr><td>'+escape(time(x.observedAtMs))+'</td><td>'+escape(x.sourceId)+
      '</td><td><strong>'+escape(labels[r.status] || r.status)+'</strong><small>'+escape(continuity[r.continuity] || '')+'</small></td><td>'+money(x.netCents)+
      '</td><td>'+money(r.deltaNetCents)+'</td><td>'+money(r.revisionAdjustmentCents)+'</td><td>'+escape(r.segment)+'</td></tr>').join('');
  }
  function createReplayModule(options) {
    const doc = options.document, fetcher = options.fetch;
    const el = id => doc.getElementById(id);
    let data = null, page = 0, generation = 0, bound = false;
    function render() {
      if (!data) return;
      const selected = el('flowReplayStream').value;
      const rows = data.records.filter(r => key(r.snapshot) === selected);
      page = Math.max(0, Math.min(page, Math.ceil(rows.length / 100) - 1));
      el('flowReplayRows').innerHTML = renderRows(rows.slice(page*100,(page+1)*100));
      el('flowReplayPage').textContent = '第 '+(page+1)+' / '+Math.max(1,Math.ceil(rows.length/100))+' 页 · '+rows.length+' 条';
      el('flowReplayPrevious').disabled = page === 0;
      el('flowReplayNext').disabled = (page+1)*100 >= rows.length;
      const last = rows.length ? rows[rows.length-1] : null;
      const accepted = rows.filter(r=>['BASELINE','DELTA','REVISION_BASELINE'].includes(r.result.status));
      const valid = accepted.length ? accepted[accepted.length-1] : null;
      el('flowReplayMetrics').innerHTML = '<article><span>最近有效累计净额</span><strong>'+money(valid && valid.snapshot.netCents)+
        '</strong><small>'+escape(valid ? time(valid.snapshot.observedAtMs) : '--')+'</small></article><article><span>最后记录区间变化</span><strong>'+money(last && last.result.deltaNetCents)+
        '</strong><small>整个采样区间，不等于最后一分钟</small></article><article><span>最后记录修订差额</span><strong>'+money(last && last.result.revisionAdjustmentCents)+
        '</strong><small>数据修订，不是成交资金</small></article>';
    }
    async function run(loader, label) {
      const ticket = ++generation;
      data = null; el('flowReplayOutput').hidden = true;
      el('flowReplayRows').innerHTML = ''; el('flowReplayMetrics').innerHTML = '';
      el('flowReplayStatus').textContent = '正在检查 '+label+'；不写入行情或持仓。';
      try {
        const seconds = String(el('flowReplayGap').value || '').trim();
        if (seconds && (!/^\d+$/.test(seconds) || Number(seconds)<=0 || !Number.isSafeInteger(Number(seconds)*1000))) throw Error('最大采样间隔请输入正整数秒，或留空。');
        const bytes = await loader();
        if (ticket !== generation) return;
        if (bytes.byteLength > 2*1024*1024) throw Error('文件超过 2 MiB。');
        const response = await fetcher('/api/capital-flow/replay'+(seconds?'?maxGapMs='+Number(seconds)*1000:''),
          {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:bytes});
        const payload = await response.json();
        if (ticket !== generation) return;
        if (!response.ok || !payload.success) throw Error(payload.error && payload.error.message || '回放服务不可用，请确认已启动新版程序。');
        data = payload.data; page = 0;
        const groups = new Map();
        data.records.forEach(r=>groups.set(key(r.snapshot),r.snapshot));
        el('flowReplayStream').innerHTML = Array.from(groups,([k,x])=>'<option value="'+escape(k)+'">'+escape([x.symbol,x.tradingDay,x.sourceId,x.metricId,x.methodologyId,x.period].join(' · '))+'</option>').join('');
        el('flowReplayStatus').textContent = label+' · '+data.records.length+' 条 · 来源未核验 · 仅内存回放，不保存到行情库';
        el('flowReplayHash').textContent = '原文件 SHA256：'+data.provenance.inputSha256;
        el('flowReplayOutput').hidden = false; render();
      } catch (error) {
        if (ticket !== generation) return;
        data = null; el('flowReplayOutput').hidden = true;
        el('flowReplayStatus').textContent = '未导入：'+error.message;
      }
    }
    function bind() {
      if (bound || !el('flowReplayFile')) return;
      bound = true;
      el('flowReplayFile').addEventListener('change', function(event) {
        const file = event.target.files[0];
        if (file) run(async()=>{if(file.size>2*1024*1024) throw Error('文件超过 2 MiB。'); return file.arrayBuffer();},'文件 '+file.name);
        event.target.value = '';
      });
      el('flowReplayDemo').addEventListener('click', ()=>run(async()=>{
        const r = await fetcher('/api/capital-flow/replay-demo');
        if(!r.ok) throw Error('演示文件不可用，请确认已启动新版程序。');
        return r.arrayBuffer();
      },'合成演示（非真实行情）'));
      el('flowReplayStream').addEventListener('change',()=>{page=0;render();});
      el('flowReplayPrevious').addEventListener('click',()=>{page--;render();});
      el('flowReplayNext').addEventListener('click',()=>{page++;render();});
    }
    return {bind, run};
  }
  return {formatCents,renderRows,createReplayModule};
});
