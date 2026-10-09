// Static QA preview only. No business services or database modules are imported.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.woff2':'font/woff2' };
http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname.startsWith('/api/') || pathname === '/ai-status') {
    res.writeHead(503, { 'Content-Type':'application/json' });
    return res.end(JSON.stringify({success:false,error:'Fixture route required; no business backend exists here.'}));
  }
  if (pathname === '/sw.js') { res.writeHead(200, {'Content-Type':'text/javascript'}); return res.end('// QA: no service worker caching.'); }
  const file = path.resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  let body = fs.readFileSync(file);
  if (pathname === '/' || pathname === '/index.html') body = body.toString().replace('</body>', '<script src="/test/qa/desktop-ux-bootstrap.js"></script></body>');
  if (pathname === '/js/app.js') body = body.toString().replace(/^init\(\);\s*$/m, '');
  res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
  res.end(body);
}).listen(3073, '127.0.0.1', () => console.log('Static isolated QA http://127.0.0.1:3073'));
