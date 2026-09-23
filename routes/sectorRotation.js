const express = require('express');
const {validateQuery} = require('../services/capitalFlow/sectorRotationModel');
const {getSectorRotationService} = require('../services/capitalFlow/sectorRotationService');
function createSectorRotationRouter(options = {}) {
  const router=express.Router(), service=()=>options.service || getSectorRotationService();
  async function handle(req,res,refresh) {
    res.set('Cache-Control','no-store');
    let query;
    try {
      if(Object.entries(req.query).some(([key,value])=>!['scope','minutes','metric','code','date','at'].includes(key) || typeof value!=='string')) throw Error('Invalid query');
      query=validateQuery(req.query);
      if(refresh && query.date)throw Error('Replay is read-only');
    } catch(_) {return res.status(400).json({success:false,error:{message:'请选择行业/概念、5/15/30分钟、明盘/暗盘/合计及有效板块代码。'}});}
    try {
      if(refresh) await service().collect();
      res.json({success:true,data:await service().get(query)});
    } catch(_) {res.status(503).json({success:false,error:{message:'板块采样历史暂不可读取，请检查数据目录；没有使用零或其他口径替代。'}});}
  }
  router.get('/capital-flow/rotation',(req,res)=>handle(req,res,false));
  router.post('/capital-flow/rotation/refresh',(req,res)=>handle(req,res,true));
  async function daily(req,res,refresh) {
    res.set('Cache-Control','no-store');let query;
    try {
      if(Object.entries(req.query).some(([key,value])=>!['scope','date'].includes(key) || typeof value!=='string'))throw Error('Invalid query');
      query=validateQuery(req.query);if(!query.date)throw Error('Missing date');
    } catch(_) {return res.status(400).json({success:false,error:{message:'请选择有效的历史日期及行业/概念。'}});}
    try {res.json({success:true,data:await service()[refresh?'refreshDaily':'getDaily'](query)});}
    catch(_) {res.status(503).json({success:false,error:{message:'历史日榜暂不可读取，请稍后重试；没有回填盘中采样。'}});}
  }
  router.get('/capital-flow/rotation/daily',(req,res)=>daily(req,res,false));
  router.post('/capital-flow/rotation/daily/refresh',(req,res)=>daily(req,res,true));
  return router;
}
module.exports = createSectorRotationRouter();
module.exports.createSectorRotationRouter = createSectorRotationRouter;
