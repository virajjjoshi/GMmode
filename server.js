// Trash Talk Live: zero-dependency Node server.
// Serves the SPA in /public and a small JSON API on /api.

if (typeof fetch !== 'function') {
  console.error(`\n  Trash Talk Live needs Node 18+ (you're on ${process.version}).\n  Run: nvm use   (this repo's .nvmrc pins Node 22)\n`);
  process.exit(1);
}

const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const espn = require('./lib/espn');
const store = require('./lib/store');
const humor = require('./lib/humor');
const live = require('./lib/live');
const fantasy = require('./lib/fantasy');
const predict = require('./lib/predict');
const bets = require('./lib/bets').createBets({ users: store.getUser });
store.setReceiptCheck(bets.service.hasReceipt);
const games = require('./lib/games').createGames();
const statics = require('./lib/static').createStatic(path.join(__dirname, 'public'));

// ---------- config (all optional; see .env.example) ----------
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const PROD = process.env.NODE_ENV === 'production';
// Behind a load balancer (Fly, Render, Railway, nginx) the socket address is the
// proxy's. TRUST_PROXY=1 reads the client IP from X-Forwarded-For instead, so
// rate limits apply per fan, not per proxy. Only set it when a proxy is in front.
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const STARTED = Date.now();

// Sent on every response. The CSP allows Google Fonts and HTTPS images (team
// logos from ESPN, avatars from Sleeper) and nothing inline for scripts.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com', "img-src 'self' data: https:", "connect-src 'self'", "manifest-src 'self'",
  "worker-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
function securityHeaders(req) {
  const h = {
    'content-security-policy': CSP,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  if (req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted) h['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = String(req.headers['fly-client-ip'] || req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (fwd.length) return req.headers['fly-client-ip'] ? fwd[0] : fwd[fwd.length - 1]; // the hop our proxy added
  }
  return req.socket.remoteAddress || 'x';
}

// ---------- helpers ----------
function send(res, code, body) {
  let out = Buffer.from(JSON.stringify(body));
  const h = { ...res.baseHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Accept-Encoding' };
  // Scoreboards are ~100 KB of JSON; gzip makes them ~10x smaller on phones.
  if (out.length > 1024 && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] || ''))) {
    out = zlib.gzipSync(out, { level: 6 }); h['content-encoding'] = 'gzip';
  }
  h['content-length'] = out.length;
  res.writeHead(code, h);
  res.end(out);
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg) => new HttpError(400, msg);

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const ch of req) {
    size += ch.length;
    if (size > 10_000) throw new HttpError(413, 'Whoa, that take is too long.');
    chunks.push(ch);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw bad('Invalid JSON'); }
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const isUid = (u) => typeof u === 'string' && /^[a-zA-Z0-9-]{16,64}$/.test(u);
const isDate = (d) => /^\d{8}$/.test(d);
const isId = (id) => /^\d{1,15}$/.test(id);

// Simple per-IP rate limiting: a burst bucket for all writes,
// plus a cooldown between posts so nobody floods a thread.
const buckets = new Map();
function limit(ip, key, max, windowMs) {
  const k = `${ip}:${key}`, now = Date.now();
  const arr = (buckets.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now); buckets.set(k, arr);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 60_000)) buckets.delete(k); }, 60_000).unref();

// Coarse per-IP ceiling on all API traffic (fixed one-minute windows), so one
// misbehaving client or scraper can't starve everyone else.
const API_PER_MIN = Number(process.env.API_RATE_PER_MIN) || 600;
const windows = new Map();
function underCeiling(ip) {
  const w = Math.floor(Date.now() / 60_000), e = windows.get(ip);
  if (!e || e.w !== w) { windows.set(ip, { w, n: 1 }); return true; }
  return ++e.n <= API_PER_MIN;
}
setInterval(() => { const w = Math.floor(Date.now() / 60_000); for (const [k, e] of windows) if (e.w < w) windows.delete(k); }, 60_000).unref();

function withVibe(g) {
  store.noteGame(g);
  return { ...g, vibe: humor.vibe(g) };
}

function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }

// ---------- API ----------
async function api(req, res, url) {
  const ip = clientIp(req);
  if (!underCeiling(ip)) throw new HttpError(429, 'Too many requests. Give it a minute.');
  const uid = req.headers['x-fan-id'];
  const me = isUid(uid) ? uid : null;
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const method = req.method;

  if (method === 'GET' && parts[0] === 'leagues') {
    return send(res, 200, Object.entries(espn.LEAGUES).map(([key, l]) => ({ key, label: l.label, emoji: l.emoji, sport: l.sport })));
  }

  if (method === 'GET' && parts[0] === 'scoreboard') {
    const league = url.searchParams.get('league') || 'all';
    const date = url.searchParams.get('date') || ymd(new Date());
    if (!isDate(date)) throw bad('bad date');
    const keys = league === 'all' ? Object.keys(espn.LEAGUES) : [league];
    if (!keys.every((k) => espn.LEAGUES[k])) throw bad('unknown league');
    const results = await Promise.allSettled(keys.map((k) => espn.scoreboard(k, date)));
    const games = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).map(withVibe);
    for (const g of games) {
      const key = `${g.league}:${g.id}`;
      g.takeCount = store.listComments(key).length;
      g.poll = store.pollView(key);
      g.viewers = live.viewers(key);
    }
    return send(res, 200, { date, games, failed: keys.filter((_, i) => results[i].status === 'rejected') });
  }

  if (parts[0] === 'game') {
    const [, league, id, sub] = parts;
    if (!espn.LEAGUES[league] || !isId(id)) throw bad('unknown game');
    const key = `${league}:${id}`;

    if (method === 'GET' && !sub) {
      const sum = await espn.summary(league, id);
      sum.game = withVibe(sum.game);
      return send(res, 200, {
        ...sum,
        key,
        commentary: humor.commentary(sum),
        excuses: humor.EXCUSES,
        social: social(key, me),
      });
    }
    if (method === 'GET' && sub === 'social') return send(res, 200, social(key, me));

    if (method === 'POST') {
      if (!me) throw bad('Missing fan id. Refresh the page.');
      if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer. Too many clicks.');
      const body = await readBody(req);
      const name = clean(body.name, 24), avatar = clean(body.avatar, 8);
      if (name) store.touchUser(me, name, avatar);

      if (sub === 'comments') {
        const text = clean(body.text, 500);
        if (name.length < 2) throw bad('Pick a name first (2+ characters).');
        if (text.length < 2) throw bad('Say something! Even "booo" counts.');
        if (!limit(ip, 'post', 1, 4000)) throw new HttpError(429, 'Cooldown! Let that last take breathe for a few seconds.');
        const heat = ['mild', 'spicy', 'nuclear'].includes(body.heat) ? body.heat : 'mild';
        const parentId = body.parentId ? clean(body.parentId, 64) : null;
        try { return send(res, 201, store.addComment(key, { uid: me, name, avatar, text, heat, parentId })); }
        catch (e) { throw bad(e.message); }
      }
      if (sub === 'poll') {
        if (!['home', 'away'].includes(body.side)) throw bad('Pick a side.');
        const sum = await espn.summary(league, id);
        if (sum.game.status.state === 'post') throw bad('Polls are closed. No predicting the past, Doc Brown.');
        return send(res, 200, store.vote(key, me, body.side));
      }
      if (sub === 'react') {
        try { return send(res, 200, store.react(key, body.emoji, Number(body.n) || 1)); }
        catch (e) { throw bad(e.message); }
      }
    }
  }

  if (parts[0] === 'comments' && parts[1]) {
    const id = clean(parts[1], 64);
    if (!me) throw bad('Missing fan id.');
    if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer.');
    if (method === 'POST' && parts[2] === 'vote') {
      const body = await readBody(req);
      if (!['fire', 'cap'].includes(body.kind)) throw bad('bad vote');
      try { return send(res, 200, store.voteComment(id, me, body.kind)); }
      catch { throw new HttpError(404, 'That take vanished.'); }
    }
    if (method === 'DELETE') {
      try { store.deleteComment(id, me); return send(res, 200, { ok: true }); }
      catch { throw new HttpError(403, 'You can only delete your own takes.'); }
    }
  }

  // ----- Live Rooms -----
  if (parts[0] === 'live') {
    const [, league, id, sub] = parts;
    if (!espn.LEAGUES[league] || !isId(id)) throw bad('unknown game');
    if (method === 'GET' && sub === 'stream') {
      const fan = url.searchParams.get('fan');
      if (!limit(ip, 'stream', 20, 60_000)) throw new HttpError(429, 'Too many reconnects. Chill for a minute.');
      return live.join(league, id, isUid(fan) ? fan : null, req, res);
    }
    if (method === 'POST') {
      if (!me) throw bad('Missing fan id. Refresh the page.');
      if (!limit(ip, 'live', 60, 10_000)) throw new HttpError(429, 'Easy there, speed racer.');
      const body = await readBody(req);
      const name = clean(body.name, 24), avatar = clean(body.avatar, 8);
      if (name.length < 2) throw bad('Pick a name first (2+ characters).');
      store.touchUser(me, name, avatar);
      if (sub === 'chat') {
        const text = clean(body.text, 200);
        if (!text) throw bad('Say something!');
        return send(res, 201, live.chat(league, id, { uid: me, name, avatar, text }));
      }
      if (sub === 'react') { live.react(league, id, body.emoji, Number(body.n) || 1); return send(res, 200, { ok: true }); }
      if (sub === 'demo') return send(res, 200, live.setDemo(league, id, !!body.on));
      if (sub === 'hype') { live.hype(league, id, body.side, Number(body.n) || 1); return send(res, 200, { ok: true }); }
      if (sub === 'mpoll') return send(res, 200, live.votePoll(league, id, { uid: me, pollId: clean(body.pollId, 64), option: clean(body.option, 16) }));
      if (sub === 'call') {
        if (!['home', 'away'].includes(body.side)) throw bad('Pick a side.');
        return send(res, 200, live.makeCall(league, id, { uid: me, name, avatar, side: body.side, callId: clean(body.callId, 64) }));
      }
    }
  }

  // ----- Fantasy (Sleeper) -----
  if (parts[0] === 'fantasy') {
    const isNum = (v) => /^\d{1,25}$/.test(v || '');
    if (method === 'GET' && parts[1] === 'sleeper' && parts[2] === 'user') {
      const username = clean(decodeURIComponent(parts[3] || ''), 40);
      if (!/^[A-Za-z0-9_.-]{2,40}$/.test(username)) throw bad('That doesn\'t look like a Sleeper username.');
      return send(res, 200, await fantasy.connect(username));
    }
    if (method === 'GET' && parts[1] === 'sleeper' && parts[2] === 'league' && isNum(parts[3])) {
      const user = url.searchParams.get('user'), week = url.searchParams.get('week');
      if (!isNum(user)) throw bad('bad user');
      if (week && !/^\d{1,2}$/.test(week)) throw bad('bad week');
      if (parts[4] === 'mine') return send(res, 200, await fantasy.myPlayers(parts[3], user));
      return send(res, 200, await fantasy.league(parts[3], user, week));
    }
  }

  // ----- Prediction Leagues -----
  if (parts[0] === 'pl') {
    return predict.handle({ req, res, url, parts: parts.slice(1), me, ip, send, readBody, HttpError, clean, limit });
  }

  // ----- Bets (linked sportsbooks) -----
  if (parts[0] === 'bets') {
    return bets.handle({ req, res, url, parts: parts.slice(1), me, ip, send, readBody, HttpError, clean, limit });
  }

  // ----- Games (historical perfect-season challenges) -----
  if (parts[0] === 'games') {
    return games.handle({ req, res, url, parts: parts.slice(1), me, ip, send, readBody, HttpError, clean, limit });
  }

  // Takes from every game thread, for the Takes hub.
  if (method === 'GET' && parts[0] === 'takes') {
    const league = url.searchParams.get('league') || null;
    if (league && !espn.LEAGUES[league]) throw bad('unknown league');
    const sort = ['hot', 'new', 'top'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'hot';
    return send(res, 200, store.feed({ league, sort, uid: me, receipts: url.searchParams.get('money') === '1', limit: 40 }));
  }

  if (method === 'GET' && parts[0] === 'hall') return send(res, 200, store.hall());

  throw new HttpError(404, 'Nothing here but tumbleweeds.');
}

function social(key, me) {
  return { poll: store.pollView(key, me), reactions: store.reactionsView(key), comments: store.listComments(key, me) };
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  res.baseHeaders = securityHeaders(req);
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/healthz') {
    return send(res, 200, { ok: true, uptime: Math.round((Date.now() - STARTED) / 1000), build: statics.buildHash(), live: live.stats(), memMB: Math.round(process.memoryUsage().rss / 1048576) });
  }

  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      const code = e.code && Number.isInteger(e.code) ? e.code : 502;
      if (code >= 500) console.error(`[api] ${req.method} ${url.pathname} -> ${code}: ${e.message}`);
      if (!res.headersSent) send(res, code, { error: code >= 500 ? 'The sports gods are offline. Try again in a sec.' : e.message });
      else res.end();
    }
    const ms = Date.now() - t0;
    if (ms > 2000 && !url.pathname.endsWith('/stream')) console.warn(`[slow] ${req.method} ${url.pathname} ${ms}ms`);
    return;
  }
  statics.serve(req, res, url, res.baseHeaders);
});
// Load balancers keep connections open ~60s; outlast them so they don't hit a closed socket.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

server.listen(PORT, HOST, () => {
  console.log(`\n  Trash Talk Live is up at http://localhost:${PORT}${PROD ? ' (production)' : ''}\n`);
  predict.start();
});

// ---------- lifecycle ----------
// On deploy/restart the platform sends SIGTERM: stop taking requests, end live
// streams (clients reconnect to the new instance), and write every store to disk.
let stopping = false;
function flushAll() {
  for (const [name, fn] of [['takes', store.flush], ['predict', predict.flush], ['bets', bets.flush], ['games', games.flush]]) {
    try { fn(); } catch (e) { console.error(`[shutdown] ${name} save failed: ${e.message}`); }
  }
}
function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`[shutdown] ${sig}: saving data and closing`);
  server.close(() => { flushAll(); process.exit(0); });
  live.closeAll();
  server.closeIdleConnections?.();
  setTimeout(() => { flushAll(); process.exit(0); }, 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
