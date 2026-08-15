const crypto = require('node:crypto');

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return value.startsWith('127.') || value === '::1' || value.startsWith('::ffff:127.');
}

function isLocalNetworkAddress(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function resolveSafeListenHost(host, token) {
  const value = String(host || '').trim().toLowerCase();
  if (!value || value === 'localhost') return '127.0.0.1';
  if (isLoopbackAddress(value)) return value;
  if (String(token || '').length < 20) {
    throw new Error('A LAN pairing token is required for non-loopback WebStock binding');
  }
  return value;
}

function cookieValue(header, name) {
  const prefix = String(name) + '=';
  return String(header || '').split(';').map(item => item.trim())
    .find(item => item.startsWith(prefix))?.slice(prefix.length) || '';
}

function tokenMatches(expected, provided) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(provided || ''), 'utf8');
  return left.length >= 20 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isTailscaleServeRequest(req) {
  if (!req || typeof req.get !== 'function') return false;
  return Boolean(
    req.get('tailscale-user-login') ||
    req.get('tailscale-user-name') ||
    req.get('tailscale-user-profile-pic')
  );
}

function requireLanPairing(req, res, next) {
  const expected = String(process.env.WEBSTOCK_LAN_TOKEN || '');
  const tailscaleServe = isTailscaleServeRequest(req);
  if (!expected || (isLoopbackAddress(req.socket && req.socket.remoteAddress) && !tailscaleServe)) return next();

  const queryToken = String(req.query && req.query.pair || '');
  const cookieToken = cookieValue(req.get('cookie'), 'webstock_lan_token');
  if (tokenMatches(expected, queryToken)) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Set-Cookie', 'webstock_lan_token=' + encodeURIComponent(expected) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000' + (tailscaleServe ? '; Secure' : ''));
    if (['GET', 'HEAD'].includes(req.method) && queryToken) return res.redirect(302, req.path || '/');
    return next();
  }
  if (tokenMatches(expected, cookieToken)) return next();

  if (String(req.path || '').startsWith('/api') || req.path === '/ai-status') {
    return res.status(401).json({ success: false, error: '该设备尚未与 WebStock 配对' });
  }
  return res.status(401).type('text/plain').send('该设备尚未与 WebStock 配对，请使用 Windows 端显示的完整配对地址。');
}

module.exports = {
  isLoopbackAddress,
  isLocalNetworkAddress,
  resolveSafeListenHost,
  cookieValue,
  tokenMatches,
  isTailscaleServeRequest,
  requireLanPairing
};
