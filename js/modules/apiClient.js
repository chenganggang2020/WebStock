function unwrapApiResponse(json) {
  if (json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success')) {
    if (!json.success) throw new Error(json.error || 'API request failed');
    return json.data;
  }
  return json;
}

function apiFetch(url, options) {
  return fetch(url, options).then(function(response) {
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
  });
}

const fetchJsonData = apiFetch;

window.apiFetch = apiFetch;
window.ApiClient = {
  unwrapApiResponse,
  apiFetch,
  fetchJsonData
};
