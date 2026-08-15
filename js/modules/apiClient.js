function unwrapApiResponse(json) {
  if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success')) {
    if (!json.success) throw new Error(json.error || 'API request failed');
    return json.data;
  }
  return json;
}

function unwrapApiEnvelope(json) {
  if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success')) {
    if (!json.success) throw new Error(json.error || 'API request failed');
    return { data: json.data, meta: json.meta || {} };
  }
  return { data: json, meta: {} };
}

const inFlightGetRequests = new Map();
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_GET_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

function isRetryableStatus(status) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function waitBeforeRetry(milliseconds) {
  return new Promise(function(resolve) {
    setTimeout(resolve, milliseconds);
  });
}

function apiFetch(url, options) {
  const requestOptions = Object.assign({}, options || {});
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const preserveEnvelope = requestOptions.preserveEnvelope === true;
  const serverOwnsRetries = method === 'GET' && /^\/api\/(?:quote|minute|kline)(?:[/?]|$)/.test(String(url));
  const timeoutMs = Number.isFinite(Number(requestOptions.timeoutMs))
    ? Math.max(0, Number(requestOptions.timeoutMs))
    : serverOwnsRetries ? 35000 : DEFAULT_TIMEOUT_MS;
  const maxRetries = method === 'GET'
    ? (serverOwnsRetries ? 0 : Number.isFinite(Number(requestOptions.maxRetries))
      ? Math.max(0, Math.min(4, Number(requestOptions.maxRetries)))
      : DEFAULT_GET_RETRIES)
    : 0;
  const retryDelayMs = Number.isFinite(Number(requestOptions.retryDelayMs))
    ? Math.max(0, Number(requestOptions.retryDelayMs))
    : DEFAULT_RETRY_DELAY_MS;
  const shouldDedupe = method === 'GET' && requestOptions.dedupe !== false;
  const requestKey = shouldDedupe
    ? method + ' ' + url + (preserveEnvelope ? ' envelope' : ' data')
    : '';
  if (requestKey && inFlightGetRequests.has(requestKey)) {
    return inFlightGetRequests.get(requestKey);
  }

  delete requestOptions.timeoutMs;
  delete requestOptions.dedupe;
  delete requestOptions.maxRetries;
  delete requestOptions.retryDelayMs;
  delete requestOptions.preserveEnvelope;
  const callerSignal = requestOptions.signal;
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = function() { controller.abort(); };
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }
  requestOptions.signal = controller.signal;
  const timeoutId = timeoutMs > 0 ? setTimeout(function() {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;

  function parseResponse(response) {
    return response.text().then(function(text) {
      let json;
      try {
        json = JSON.parse(text);
      } catch (error) {
        console.error('[apiFetch] Interface returned non JSON', {
          url,
          status: response.status,
          statusText: response.statusText,
          body: String(text || '').slice(0, 500)
        });
        const invalidJsonError = new Error('Interface returned non JSON: ' + url);
        invalidJsonError.status = response.status;
        invalidJsonError.receivedResponse = true;
        throw invalidJsonError;
      }

      if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success') && json.success === false) {
        const apiError = new Error(json.error || ('API returned failure: ' + response.status));
        apiError.status = response.status;
        apiError.receivedResponse = true;
        throw apiError;
      }

      if (!response.ok) {
        const errorMessage = (json && typeof json === 'object' && json.error)
          ? json.error
          : ('HTTP ' + response.status + ' ' + response.statusText + (String(text || '').trim() ? ': ' + String(text || '').slice(0, 200) : ''));
        const httpError = new Error(errorMessage);
        httpError.status = response.status;
        httpError.receivedResponse = true;
        throw httpError;
      }

      return preserveEnvelope ? unwrapApiEnvelope(json) : unwrapApiResponse(json);
    });
  }

  function fetchOnce() {
    try {
      return Promise.resolve(fetch(url, requestOptions));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function performAttempt(attempt) {
    return fetchOnce().then(parseResponse).catch(function(error) {
      const aborted = controller.signal.aborted || (error && error.name === 'AbortError');
      const retryable = !aborted && method === 'GET' && attempt < maxRetries &&
        ((!error.receivedResponse && !error.status) || isRetryableStatus(Number(error.status)));
      if (!retryable) throw error;
      return waitBeforeRetry(retryDelayMs * Math.pow(2, attempt)).then(function() {
        return performAttempt(attempt + 1);
      });
    });
  }

  const request = performAttempt(0).catch(function(error) {
    if (error && error.name === 'AbortError') {
      throw new Error(timedOut ? '请求超时：' + url : '请求已取消：' + url);
    }
    throw error;
  }).finally(function() {
    if (timeoutId) clearTimeout(timeoutId);
    if (callerSignal) callerSignal.removeEventListener('abort', abortFromCaller);
    if (requestKey && inFlightGetRequests.get(requestKey) === request) {
      inFlightGetRequests.delete(requestKey);
    }
  });

  if (requestKey) inFlightGetRequests.set(requestKey, request);
  return request;
}

const fetchJsonData = apiFetch;
function fetchApiEnvelope(url, options) {
  return apiFetch(url, Object.assign({}, options || {}, { preserveEnvelope: true }));
}

window.apiFetch = apiFetch;
window.ApiClient = {
  unwrapApiResponse,
  unwrapApiEnvelope,
  apiFetch,
  fetchJsonData,
  fetchApiEnvelope
};
