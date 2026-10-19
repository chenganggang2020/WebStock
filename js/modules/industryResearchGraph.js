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
  function buildCreatorGraph(relations,selectedFocus){
    const all=Array.isArray(relations)?relations:[];
    const focus=String(selectedFocus||all[0]?.from||'').trim();
    const incident=all.filter(row=>row.from===focus||row.to===focus);
    const shown=incident.slice(0,80);
    const incoming=[...new Set(shown.filter(row=>row.to===focus&&row.from!==focus).map(row=>row.from))];
    const outgoing=[...new Set(shown.filter(row=>row.from===focus&&row.to!==focus).map(row=>row.to))];
    const position=(index,length)=>index*68-(length-1)*34;
    const node=(name,x,y,isFocus)=>({id:name,name,x,y,symbol:'roundRect',symbolSize:isFocus?[155,48]:[145,42],draggable:true,
      itemStyle:{color:isFocus?'#186dba':'#42627f'},label:{show:true,color:'#fff',width:isFocus?135:125,overflow:'truncate',fontSize:12}});
    const nodes=focus?[node(focus,0,0,true)]:[];
    incoming.forEach((name,index)=>nodes.push(node(name,-240,position(index,incoming.length),false)));
    outgoing.filter(name=>!incoming.includes(name)).forEach((name,index)=>nodes.push(node(name,240,position(index,outgoing.length),false)));
    const known=new Set(nodes.map(item=>item.id));
    const links=shown.filter(row=>known.has(row.from)&&known.has(row.to)).map(row=>({source:row.from,target:row.to,
      relationKey:row.key,value:row.relation,lineStyle:{type:'dashed',color:'#7994af',width:1.4,curveness:0.08},
      label:{show:true,formatter:String(row.relation||'作者观点'),color:'#58718a',fontSize:10}}));
    return {focus,nodes,links,shown:links.length,focusTotal:incident.length,total:all.length};
  }
  return {buildGraph,buildCreatorGraph};
});
