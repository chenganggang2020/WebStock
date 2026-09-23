const express = require('express');
const {
  SOURCE_MODES,
  createCapitalFlowService
} = require('../services/capitalFlow');
const { createCapitalFlowAdapters } = require('../services/capitalFlow/adapters');

const VALID_SCOPES = new Set(['stock', 'sector']);
const VALID_SOURCES = new Set(Object.values(SOURCE_MODES));
const STOCK_CODE_PATTERN = /^(?:sh|sz)?\d{6}$/i;
const SECTOR_CODE_PATTERN = /^BK\d{4}$/i;

function apiError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function validateQuery(query) {
  const scope = String(query.scope || '').trim().toLowerCase();
  const code = String(query.code || '').trim();
  const source = String(query.source || '').trim().toLowerCase();

  if (!VALID_SCOPES.has(scope)) {
    throw apiError('CAPITAL_FLOW_SCOPE_INVALID', 'scope must be stock or sector');
  }
  const codePattern = scope === 'stock' ? STOCK_CODE_PATTERN : SECTOR_CODE_PATTERN;
  if (!code || !codePattern.test(code)) {
    throw apiError('CAPITAL_FLOW_CODE_INVALID', scope === 'stock'
      ? 'stock code must contain six digits with an optional sh/sz prefix'
      : 'sector code must use the BK0000 format');
  }
  if (!source) {
    throw apiError('CAPITAL_FLOW_SOURCE_REQUIRED', 'source must be selected explicitly');
  }
  if (!VALID_SOURCES.has(source)) {
    throw apiError('CAPITAL_FLOW_SOURCE_INVALID', 'unsupported capital-flow source');
  }
  if (query.date !== undefined && !require('../services/capitalFlow/historyStore').validDate(query.date)) {
    throw apiError('CAPITAL_FLOW_DATE_INVALID', '请选择有效历史日期');
  }
  if (query.refresh !== undefined && !['0', '1'].includes(query.refresh)) throw apiError('CAPITAL_FLOW_REFRESH_INVALID', 'refresh must be 0 or 1');
  if (scope === 'sector' && source !== SOURCE_MODES.VENDOR_CLASSIFIED) {
    throw apiError(
      'CAPITAL_FLOW_SOURCE_SCOPE_UNSUPPORTED',
      'sector capital flow supports only vendor-classified data'
    );
  }
  return {
    scope,
    code: scope === 'stock' ? code.replace(/^(?:sh|sz)/i, '') : code.toUpperCase(),
    source,
    ...(query.date ? { date: query.date } : {}),
    ...(query.refresh !== undefined ? { refresh: query.refresh === '1' } : {})
  };
}

function createCapitalFlowRouter(options = {}) {
  const service = options.service || createCapitalFlowService(
    Object.assign({}, options.adapters || createCapitalFlowAdapters(options.adapterOptions), {
      historyDirectory: options.historyDirectory || require('node:path').join(require('node:path').dirname(
        process.env.WEBSTOCK_DB_PATH || require('node:path').join(__dirname, '../data/webstock.db')), 'capital-flow-history')
    })
  );
  const router = express.Router();
  const darkRank = require('../services/capitalFlow/darkRankService').createDarkRankService({load:options.darkRankLoader});
  const {createDarkStockService,darkSession,stockKeys} = require('../services/capitalFlow/darkStockService');
  const darkStocks = createDarkStockService({load:options.darkStockLoader});
  const darkBoard = require('../services/capitalFlow/darkRankBoard').createDarkRankBoard({darkStocks,loadCaps:options.darkCapLoader});
  const darkHistory = options.darkHistory || require('../services/capitalFlow/darkObservationStore').createDarkObservationStore();
  const session = () => darkSession(options.now ? options.now() : new Date());
  router.get('/capital-flow/dark-session', function(req,res) {
    res.set('Cache-Control','no-store').json({success:true,data:session()});
  });
  router.get('/capital-flow/dark-rank-board', async function(req,res) {
    res.set('Cache-Control','no-store');
    try {
      if(typeof req.query.date !== 'string' || !['amount','ratio','visible','combined'].includes(req.query.metric || 'amount')) throw Error('query');
      require('../services/capitalFlow/eastmoneyDarkRank').buildQuery({date:req.query.date});
    } catch (_) { return res.status(400).json({success:false,error:{message:'请选择有效日期和排序口径。'}}); }
    try { res.json({success:true,data:await darkBoard.get({date:req.query.date,metric:req.query.metric || 'amount'})}); }
    catch (_) { res.status(502).json({success:false,error:{message:'暗盘双向榜读取失败，请稍后重试。'}}); }
  });
  router.get('/capital-flow/dark-stocks', async function(req,res) {
    res.set('Cache-Control','no-store');
    let codes;
    try {codes=stockKeys(req.query.codes);} catch (_) {
      return res.status(400).json({success:false,error:{code:'DARK_STOCK_QUERY_INVALID',message:'请选择 1–200 只带市场前缀的 A 股。'}});
    }
    const state=session();
    if(!state.dataDate) return res.status(503).json({success:false,error:{code:'DARK_CALENDAR_UNKNOWN',message:'交易日历未覆盖当前日期，无法自动选定交易日。'}});
    try {
      const data=await darkStocks.get({date:state.dataDate,codes});
      try {data.historySaved=await darkHistory.append(data);}
      catch (_) {data.historySaved=false;data.historyWarning='历史写入未成功；当前报价仍可看，已有记录保留';}
      res.json({success:true,data});
    }
    catch (_) {res.status(502).json({success:false,error:{code:'DARK_STOCK_UNAVAILABLE',message:'个股明暗盘榜单匹配暂不可用；未以普通资金或零替代。稍后可重试。'}});}
  });

  router.get('/capital-flow/dark-stock-history', async function(req,res) {
    res.set('Cache-Control','no-store');
    try {
      if(typeof req.query.code!=='string' || stockKeys(req.query.code).length!==1 || req.query.date!==undefined && typeof req.query.date!=='string')throw Error('Invalid history query');
      if(req.query.date)require('../services/capitalFlow/eastmoneyDarkRank').buildQuery({date:req.query.date});
    } catch (_) {return res.status(400).json({success:false,error:{code:'DARK_HISTORY_QUERY_INVALID',message:'请选择一个带市场前缀的股票和有效日期。'}});}
    try {res.json({success:true,data:await darkHistory.read({code:req.query.code,date:req.query.date})});}
    catch (_) {res.status(503).json({success:false,error:{code:'DARK_HISTORY_UNAVAILABLE',message:'历史记录读取失败，请保留数据目录以便检查。'}});}
  });

  router.get('/capital-flow/dark-rank', async function(req, res) {
    res.set('Cache-Control', 'no-store');
    let input;
    try {
      const q = req.query;
      if (typeof q.date !== 'string' || !['stock','industry'].includes(q.scope) ||
        (q.page !== undefined && (typeof q.page !== 'string' || !/^\d+$/.test(q.page)))) throw Error('Invalid query');
      input = {date:q.date,scope:q.scope,page:q.page === undefined ? 1 : Number(q.page)};
      require('../services/capitalFlow/eastmoneyDarkRank').buildQuery(input);
    } catch (_) {
      return res.status(400).json({success:false,error:{code:'DARK_RANK_QUERY_INVALID',message:'请选择有效日期、个股或行业，以及 1–1000 的页码。'}});
    }
    try {
      res.json({success:true,data:await darkRank.get(input)});
    } catch (error) {
      const busy = error.code === 'DARK_RANK_BUSY';
      res.status(busy ? 429 : 502).json({success:false,error:{code:busy ? 'DARK_RANK_BUSY' : 'DARK_RANK_UNAVAILABLE',
        message:busy ? '查询较多，请稍后重试。' : '该日期或页面的东方财富暗盘数据暂不可用。没有用普通资金数据替代，请稍后重试或选择其他交易日。'}});
    }
  });

  // Raw bytes preserve the evidence hash. This endpoint only computes in memory.
  const replayBody = express.raw({type: 'application/octet-stream', limit: '2mb', inflate: false});
  router.post('/capital-flow/replay', function(req, res) {
    res.set('Cache-Control', 'no-store');
    replayBody(req, res, function(parseError) {
      try {
        if (parseError) throw parseError;
        if (!Buffer.isBuffer(req.body)) throw apiError('REPLAY_FORMAT', '请以文件原始内容提交 JSON，不接受其他格式。');
        const options = {};
        if (req.query.maxGapMs !== undefined) {
          const raw = req.query.maxGapMs;
          if (typeof raw !== 'string' || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
            throw apiError('REPLAY_CADENCE', '最大采样间隔必须是正整数。');
          }
          options.maxTradingGapMs = Number(raw);
        }
        const {replayDocument} = require('../services/capitalFlow/replayDocument');
        res.json({success: true, data: replayDocument(req.body, options)});
      } catch (error) {
        res.status(error.status === 413 ? 413 : 400).json({success: false,
          error: {code: 'REPLAY_REJECTED', message: error.status === 413 ? '文件超过 2 MiB。' : '回放被拒绝：' + error.message}});
      }
    });
  });
  router.get('/capital-flow/replay-demo', function(req, res) {
    res.set('Cache-Control', 'no-store');
    res.json(require('../services/capitalFlow/replay-demo.json'));
  });

  router.get('/capital-flow/series', async function(req, res) {
    try {
      const input = validateQuery(req.query || {});
      const data = await service.getSeries(input);
      res.json({ success: true, data });
    } catch (error) {
      const status = error.statusCode || 502;
      res.status(status).json({
        success: false,
        error: {
          code: error.code || 'CAPITAL_FLOW_REQUEST_FAILED',
          message: error.message || String(error)
        }
      });
    }
  });

  return router;
}

const router = createCapitalFlowRouter();

module.exports = router;
module.exports.createCapitalFlowRouter = createCapitalFlowRouter;
module.exports.validateQuery = validateQuery;
