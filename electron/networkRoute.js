function targetHost(value) {
  try { return new URL(String(value || '')).hostname; } catch (error) { return ''; }
}

async function inspectNetworkRoute(electronSession, targetUrl) {
  if (!electronSession || typeof electronSession.resolveProxy !== 'function') {
    throw new Error('Electron 网络会话尚未就绪');
  }
  const raw = String(await electronSession.resolveProxy(targetUrl) || '').trim();
  const entries = raw.split(';').map(item => item.trim()).filter(Boolean);
  const proxyEntry = entries.find(item => /^(?:PROXY|HTTPS?|SOCKS\d*)\s+/i.test(item));
  if (proxyEntry) {
    return {
      mode: 'proxy',
      label: '系统代理',
      endpoint: proxyEntry.replace(/^[^\s]+\s+/i, '').trim(),
      target: targetHost(targetUrl),
      raw
    };
  }
  return {
    mode: entries.some(item => /^DIRECT$/i.test(item)) ? 'direct' : 'unknown',
    label: entries.some(item => /^DIRECT$/i.test(item)) ? '直连' : '路径未知',
    endpoint: '',
    target: targetHost(targetUrl),
    raw
  };
}

module.exports = { inspectNetworkRoute };
