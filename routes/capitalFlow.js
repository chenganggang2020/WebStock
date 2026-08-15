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
  if (scope === 'sector' && source !== SOURCE_MODES.VENDOR_CLASSIFIED) {
    throw apiError(
      'CAPITAL_FLOW_SOURCE_SCOPE_UNSUPPORTED',
      'sector capital flow supports only vendor-classified data'
    );
  }
  return {
    scope,
    code: scope === 'stock' ? code.replace(/^(?:sh|sz)/i, '') : code.toUpperCase(),
    source
  };
}

function createCapitalFlowRouter(options = {}) {
  const service = options.service || createCapitalFlowService(
    options.adapters || createCapitalFlowAdapters(options.adapterOptions)
  );
  const router = express.Router();

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
