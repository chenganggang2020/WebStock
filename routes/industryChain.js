const express = require('express');
const defaultService = require('../services/industryChainService');
const defaultResearchService = require('../services/industryResearchService');
const defaultConceptDiscoveryService = require('../services/industryConceptDiscoveryService');
const { isLoopbackAddress } = require('../services/lanAccessService');

function parseLoopbackAuthority(rawValue, protocol) {
  if (typeof rawValue !== 'string' || !rawValue.trim() || /[\s/\\@?#]/.test(rawValue)) return null;
  const raw = rawValue.trim();
  const match = raw.startsWith('[')
    ? /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(raw)
    : /^(localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/.exec(raw.toLowerCase());
  if (!match) return null;
  const hostname = match[1].toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') return null;
  const port = match[2] ? Number(match[2]) : (protocol === 'https' ? 443 : 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { hostname, port };
}

function writeAccessAllowed(req) {
  if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) return false;
  const protocol = String(req.protocol || 'http').replace(/:$/, '').toLowerCase();
  if (protocol !== 'http' && protocol !== 'https') return false;
  const host = parseLoopbackAuthority(req.get('host'), protocol);
  if (!host) return false;
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== `${protocol}:` || originUrl.username || originUrl.password || originUrl.pathname !== '/' || originUrl.search || originUrl.hash) return false;
    const originHost = parseLoopbackAuthority(originUrl.host, protocol);
    return Boolean(originHost && originHost.hostname === host.hostname && originHost.port === host.port);
  } catch (_) { return false; }
}

function errorResponse(res, error) {
  const code = error && error.code;
  const status = code === 'NOT_FOUND' ? 404 : code === 'RESEARCH_BUSY' || code === 'STALE_VERSION' || code === 'RELATION_DISPUTED' ? 409 : code === 'INVALID_INPUT' || code === 'RESEARCH_LIMIT' || code === 'SOURCE_URL_INVALID' || code === 'SOURCE_URL_UNSAFE' || code === 'SOURCE_DNS_PRIVATE' ? 400 : 503;
  return res.status(status).json({ success: false, error: { code: code || 'INDUSTRY_RESEARCH_UNAVAILABLE', message: status === 503 ? '产业研究暂时不可用，请稍后重试。' : error.message || '请求无效。' } });
}

function createIndustryChainRouter(options = {}) {
  const router = express.Router();
  const service = options.service || defaultService;
  const researchService = options.researchService || (options.service && typeof options.service.listTopics === 'function' ? options.service : defaultResearchService);
  const conceptDiscoveryService = options.conceptDiscoveryService || defaultConceptDiscoveryService;
  const creatorService = () => options.creatorService || require('../services/creatorIndustryService').getCreatorIndustryService();
  router.get('/industry-chain/creators/:id', async function(req, res) {
    try { res.json({ success: true, data: await creatorService().read(req.params.id) }); }
    catch (error) { errorResponse(res, error); }
  });
  router.get('/industry-chain/creators/:id/observations/:observationId', async function(req, res) {
    try {
      const data = await creatorService().readDocument(req.params.id, req.params.observationId);
      res.set('Cache-Control', 'no-store').json({ success: true, data });
    }
    catch (error) { errorResponse(res, error); }
  });
  router.post('/industry-chain/creators/:id/import', async function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: '仅允许本机导入' });
    try { res.json({ success: true, data: await creatorService().importReviews(req.params.id, req.body.items, { model: req.body.model }) }); }
    catch (error) { errorResponse(res, error); }
  });
  router.post('/industry-chain/creators/:id/analyze', async function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: '仅允许本机分析' });
    try {
      const service = creatorService();
      const state = await service.read(req.params.id);
      if (!state.aiConfigured) return res.json({ success: true, data: { status: 'ai_not_configured' } });
      service.run(req.params.id).catch(() => {}); // Run state and failure are reported by GET, not a long-held HTTP request.
      res.status(202).json({ success: true, data: { status: 'queued' } });
    }
    catch (error) { errorResponse(res, error); }
  });

  router.get('/industry-chain/research/concepts', async function(req, res) {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 1000);
      const data = await conceptDiscoveryService.syncAndList({
        query: String(req.query.q || '').trim(),
        refresh: String(req.query.refresh || '') === '1',
        limit
      });
      return res.json({ success: true, data });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post('/industry-chain/research/concepts/track', function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: { code: 'LOCAL_WRITE_REQUIRED', message: '研究写操作仅允许本机回环请求。' } });
    try { return res.json({ success: true, data: conceptDiscoveryService.trackConcept(req.body || {}) }); } catch (error) { return errorResponse(res, error); }
  });

  router.get('/industry-chain/research/topics', function(req, res) {
    try { return res.json({ success: true, data: researchService.listTopics() }); } catch (error) { return errorResponse(res, error); }
  });

  router.put('/industry-chain/research/topics/:id', function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: { code: 'LOCAL_WRITE_REQUIRED', message: '研究写操作仅允许本机回环请求。' } });
    try { return res.json({ success: true, data: researchService.updateTopicConfig(req.params.id, req.body || {}) }); } catch (error) { return errorResponse(res, error); }
  });

  router.post('/industry-chain/research/topics/:id/update', async function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: { code: 'LOCAL_WRITE_REQUIRED', message: '研究写操作仅允许本机回环请求。' } });
    try { return res.json({ success: true, data: await researchService.updateTopic(req.params.id, req.body || {}) }); } catch (error) { return errorResponse(res, error); }
  });

  router.get('/industry-chain/research/topics/:id/versions/:versionId', function(req, res) {
    try { return res.json({ success: true, data: researchService.getVersion(req.params.id, req.params.versionId) }); } catch (error) { return errorResponse(res, error); }
  });

  router.get('/industry-chain/research/topics/:id', function(req, res) {
    try { return res.json({ success: true, data: researchService.getTopicDetail(req.params.id) }); } catch (error) { return errorResponse(res, error); }
  });

  router.post('/industry-chain/research/topics/:id/review', function(req, res) {
    if (!writeAccessAllowed(req)) return res.status(403).json({ success: false, error: { code: 'LOCAL_WRITE_REQUIRED', message: '研究写操作仅允许本机回环请求。' } });
    try { return res.json({ success: true, data: researchService.reviewTopic(req.params.id, req.body || {}) }); } catch (error) { return errorResponse(res, error); }
  });

  router.get('/industry-chain/taxonomy', function(req, res) {
    res.json({ success: true, data: service.getIndustryChainTaxonomy() });
  });

  router.get('/industry-chain', async function(req, res) {
    const filters = {
      chain: String(req.query.chain || '').trim(),
      stage: String(req.query.stage || '').trim()
    };
    const validation = defaultService.validateIndustryChainFilters(filters);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: validation.code,
          message: validation.field === 'chain' ? '未知的产业链筛选条件。' : '未知的产业链环节筛选条件。'
        }
      });
    }
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 120, 1), 300);
      const data = await service.discoverIndustryChains({
        query: String(req.query.q || req.query.query || '').trim(),
        chain: filters.chain,
        stage: filters.stage,
        limit
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error('[industry-chain] discovery failed:', error);
      res.status(503).json({
        success: false,
        error: {
          code: 'INDUSTRY_CHAIN_UNAVAILABLE',
          message: '产业链资料暂时不可用，请稍后重试。'
        }
      });
    }
  });

  return router;
}

const router = createIndustryChainRouter();
module.exports = router;
module.exports.createIndustryChainRouter = createIndustryChainRouter;
module.exports.parseLoopbackAuthority = parseLoopbackAuthority;
module.exports.writeAccessAllowed = writeAccessAllowed;
