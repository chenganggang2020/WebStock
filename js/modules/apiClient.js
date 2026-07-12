function unwrapApiResponse(json) {
  if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success')) {
    if (!json.success) throw new Error(json.error || 'API request failed');
    return json.data;
  }
  return json;
}

const inFlightGetRequests = new Map();
const DEFAULT_TIMEOUT_MS = 12000;

function apiFetch(url, options) {
  const requestOptions = Object.assign({}, options || {});
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const timeoutMs = Number.isFinite(Number(requestOptions.timeoutMs))
    ? Math.max(0, Number(requestOptions.timeoutMs))
    : DEFAULT_TIMEOUT_MS;
  const shouldDedupe = method === 'GET' && requestOptions.dedupe !== false;
  const requestKey = shouldDedupe ? method + ' ' + url : '';
  if (requestKey && inFlightGetRequests.has(requestKey)) {
    return inFlightGetRequests.get(requestKey);
  }

  delete requestOptions.timeoutMs;
  delete requestOptions.dedupe;
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

  let fetchPromise;
  try {
    fetchPromise = Promise.resolve(fetch(url, requestOptions));
  } catch (error) {
    fetchPromise = Promise.reject(error);
  }

  const request = fetchPromise.then(function(response) {
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
        throw new Error('Interface returned non JSON: ' + url);
      }

      if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success') && json.success === false) {
        throw new Error(json.error || ('API returned failure: ' + response.status));
      }

      if (!response.ok) {
        const errorMessage = (json && typeof json === 'object' && json.error)
          ? json.error
          : ('HTTP ' + response.status + ' ' + response.statusText + (String(text || '').trim() ? ': ' + String(text || '').slice(0, 200) : ''));
        throw new Error(errorMessage);
      }

      return unwrapApiResponse(json);
    });
  }).catch(function(error) {
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

window.apiFetch = apiFetch;
window.ApiClient = {
  unwrapApiResponse,
  apiFetch,
  fetchJsonData
};
