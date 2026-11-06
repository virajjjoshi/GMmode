// Static files for the SPA, production-style but still zero-dependency:
// - files are read once and kept in memory with gzip + brotli copies, and
//   re-read when their mtime changes (so editing during development still works)
// - index.html and sw.js are stamped with a build hash; asset URLs in index.html
//   get ?v=<hash>, and those versioned URLs are cached for a year (immutable)
// - ETag / If-None-Match for everything else
// - paths without an extension fall back to index.html (hash routes, deep links);
//   a missing file with an extension is a real 404 (never HTML served as JS)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt', '.xml']);

function createStatic(root) {
  root = path.resolve(root);
  const cache = new Map(); // abs path -> { mtimeMs, body, gz, br, etag, type }
  let build = { sig: '', hash: 'dev' };

  function compress(body, ext) {
    if (!COMPRESSIBLE.has(ext) || body.length < 512) return { gz: null, br: null };
    return {
      gz: zlib.gzipSync(body, { level: 9 }),
      br: zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }),
    };
  }

  function buildHash() {
    // Cheap: one stat per top-level file. Recomputed only when something changed.
    let sig = '';
    for (const f of fs.readdirSync(root)) {
      try { const s = fs.statSync(path.join(root, f)); if (s.isFile()) sig += `${f}:${s.mtimeMs}:${s.size};`; } catch { /* raced */ }
    }
    if (sig !== build.sig) build = { sig, hash: crypto.createHash('sha1').update(sig).digest('hex').slice(0, 10) };
    return build.hash;
  }

  function transform(rel, body) {
    if (rel !== '/index.html' && rel !== '/sw.js') return body;
    const v = buildHash();
    let s = body.toString('utf8');
    if (rel === '/sw.js') s = s.replace('__BUILD__', v);
    else s = s.replace(/(src|href)="\/([\w.-]+\.(?:js|css))"/g, `$1="/$2?v=${v}"`);
    return Buffer.from(s);
  }

  function load(abs, rel) {
    let st;
    try { st = fs.statSync(abs); } catch { return null; }
    if (!st.isFile()) return null;
    const stamp = rel === '/index.html' || rel === '/sw.js' ? `${st.mtimeMs}:${buildHash()}` : st.mtimeMs;
    const hit = cache.get(abs);
    if (hit && hit.stamp === stamp) return hit;
    const ext = path.extname(abs).toLowerCase();
    const body = transform(rel, fs.readFileSync(abs));
    const entry = {
      stamp, body, ...compress(body, ext), type: MIME[ext] || 'application/octet-stream',
      etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
    };
    cache.set(abs, entry);
    return entry;
  }

  function serve(req, res, url, headers = {}) {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD', ...headers }); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, headers); return res.end(); }
    if (rel === '/') rel = '/index.html';
    const abs = path.normalize(path.join(root, rel));
    if (!abs.startsWith(root + path.sep)) { res.writeHead(403, headers); return res.end(); }

    let f = load(abs, rel);
    if (!f) {
      if (path.extname(rel)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...headers }); return res.end('Not found'); }
      rel = '/index.html'; f = load(path.join(root, 'index.html'), rel); // SPA fallback for deep links
      if (!f) { res.writeHead(404, headers); return res.end(); }
    }

    const versioned = url.searchParams.has('v') && rel !== '/index.html' && rel !== '/sw.js';
    const h = {
      ...headers,
      'content-type': f.type,
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : rel === '/sw.js' || rel === '/index.html' ? 'no-cache' : 'public, max-age=0, must-revalidate',
      etag: f.etag,
      vary: 'Accept-Encoding',
    };
    if (rel === '/sw.js') h['service-worker-allowed'] = '/';
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, h); return res.end(); }

    const ae = String(req.headers['accept-encoding'] || '');
    let body = f.body;
    if (f.br && /\bbr\b/.test(ae)) { body = f.br; h['content-encoding'] = 'br'; }
    else if (f.gz && /\bgzip\b/.test(ae)) { body = f.gz; h['content-encoding'] = 'gzip'; }
    h['content-length'] = body.length;
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return { serve, buildHash };
}

module.exports = { createStatic, MIME };
