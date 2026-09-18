(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.IndustryResearchGraph=api;})(typeof window==='undefined'?null:window,function(){
  const labels={materials:'原材料与耗材',equipment:'生产与检测设备',components:'核心器件与零部件',manufacturing:'制造、封装与集成',applications:'下游应用'};
  function buildGraph(topic,relations){
    const all=Array.isArray(relations)?relations:[],rows=all.slice(0,16),stages=[...new Set(rows.map(row=>row.stage||'unknown'))];
    const nodes=[{id:'topic',name:String(topic||'当前主题'),x:0,y:Math.max(0,(rows.length-1)*36),symbolSize:[145,48],label:{width:125,overflow:'break'},itemStyle:{color:'#4263a0'}}],links=[];
    stages.forEach(stage=>{
      const indexes=rows.map((row,i)=>(row.stage||'unknown')===stage?i:null).filter(i=>i!==null);
      nodes.push({id:'stage-'+stage,name:labels[stage]||'环节未核验',x:225,y:indexes.reduce((a,b)=>a+b,0)/indexes.length*72,symbolSize:[145,44],itemStyle:{color:'#397c84'}});
      links.push({source:'topic',target:'stage-'+stage,label:{show:true,formatter:'环节归类'}});
    });
    rows.forEach((row,i)=>{
      const status=row.status==='verified'?'人工核验':row.status==='disputed'?'有争议':'候选';
      nodes.push({id:'relation-'+i,name:String(row.product||'产品待核验')+'\n'+String(row.company?.name||'公司未绑定')+' · '+status,x:510,y:i*72,symbolSize:[215,52],relationIndex:i,reviewStatus:row.status||'candidate',itemStyle:{color:row.status==='verified'?'#276c64':row.status==='disputed'?'#935633':'#555b79'}});
      links.push({source:'stage-'+(row.stage||'unknown'),target:'relation-'+i,lineStyle:{type:row.status==='verified'?'solid':'dashed'},label:{show:false}});
    });
    return {nodes,links,shown:rows.length,total:all.length};
  }
  return {buildGraph};
});
