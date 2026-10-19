const https = require('node:https');

const HOSTS = new Set(['douyin.com', 'www.douyin.com', 'v.douyin.com', 'iesdouyin.com', 'www.iesdouyin.com']);
function checkedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('不允许的作者链接；仅支持抖音 HTTPS 主页或分享链接');
  }
  return url;
}
function canonicalProfile(url) {
  const match = url.pathname.match(/^\/(?:share\/)?user\/([A-Za-z0-9._-]+)\/?$/);
  return match && match[1] !== 'self' ? 'https://www.douyin.com/user/' + match[1] : '';
}
function requestRedirect(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', timeout: 12000, headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      res.resume();
      resolve({status: res.statusCode, headers: res.headers});
    });
    req.on('timeout', () => req.destroy(new Error('分享链接解析超时，请重试或粘贴完整作者主页')));
    req.on('error', () => reject(new Error('分享链接解析失败，请检查网络或粘贴完整作者主页')));
    req.end();
  });
}
async function resolveDouyinProfile(text, options = {}) {
  const links = String(text || '').slice(0, 10000).match(/https?:\/\/[^\s<>"']+/gi) || [];
  const unique = [...new Set(links.map(link => link.replace(/[)\]}>，。；;！？!?、]+$/u, '')))];
  if (unique.length !== 1) throw new Error('每次添加一个作者，请粘贴一条主页分享文字或完整主页链接');
  let url = checkedUrl(unique[0]);
  const visited = new Set();
  for (let count = 0; count < 5; count++) {
    const profileUrl = canonicalProfile(url);
    if (profileUrl) return {profileUrl, identityVerified: false, message: '链接已解析；作者身份在主页采集时再次核对'};
    if (url.hostname !== 'v.douyin.com' || !/^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
      throw new Error('这不是作者主页链接；视频分享请使用单视频导入');
    }
    if (visited.has(url.href)) throw new Error('分享链接出现重复重定向');
    visited.add(url.href);
    const response = await (options.request || requestRedirect)(url.href);
    if (response.status < 300 || response.status >= 400 || !response.headers.location) {
      throw new Error('分享链接未返回作者主页，请在抖音复制作者主页链接');
    }
    url = checkedUrl(new URL(response.headers.location, url).href);
  }
  throw new Error('分享链接重定向次数过多');
}
module.exports = {resolveDouyinProfile};
