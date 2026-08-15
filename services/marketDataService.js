const axios = require('axios');

const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_NETWORK'
]);

function isRetryableRequestError(error) {
  const status = Number(error && error.response && error.response.status);
  if (status) return RETRYABLE_STATUS_CODES.has(status);
  return !!(error && RETRYABLE_NETWORK_CODES.has(error.code));
}

function defaultDelay(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function createMarketDataService(options = {}) {
  const axiosClient = options.axiosClient || axios;
  const delay = options.delay || defaultDelay;
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
  const baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 250;
  const inFlight = new Map();

  function get(key, url, config = {}) {
    if (inFlight.has(key)) return inFlight.get(key);

    const request = (async function() {
      let retryCount = 0;
      while (true) {
        try {
          return await axiosClient.get(url, Object.assign({}, config, { timeout: 10000 }));
        } catch (error) {
          if (retryCount >= maxRetries || !isRetryableRequestError(error)) throw error;
          await delay(baseDelayMs * Math.pow(2, retryCount));
          retryCount += 1;
        }
      }
    })();

    inFlight.set(key, request);
    request.finally(function() {
      if (inFlight.get(key) === request) inFlight.delete(key);
    }).catch(function() {});
    return request;
  }

  return { get };
}

const marketDataService = createMarketDataService();

module.exports = {
  createMarketDataService,
  isRetryableRequestError,
  get: marketDataService.get
};
