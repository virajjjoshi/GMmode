// Trash Talk Live: zero-dependency Node server.
// Serves the SPA in /public and a small JSON API on /api.

if (typeof fetch !== 'function') {
  console.error(`\n  Trash Talk Live needs Node 18+ (you're on ${process.version}).\n  Run: nvm use   (this repo's .nvmrc pins Node 22)\n`);
  process.exit(1);
}

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const espn = require('./lib/espn');
const store = require('./lib/store');
const humor = require('./lib/humor');
const live = require('./lib/live');
const fantasy = require('./lib/fantasy');

const PORT = Number(process.env.PORT) || 4321;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---------- helpers ----------
function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(json);
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

function withVibe(g) {
  store.noteGame(g);
  return { ...g, vibe: humor.vibe(g) };
}

function ymd(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }

// ---------- API ----------
async function api(req, res, url) {
  const ip = req.socket.remoteAddress || 'x';
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
    // One trash-talk thread per fantasy league, reusing the takes store.
    if (parts[1] === 'thread' && isNum(parts[2])) {
      const key = `fl:${parts[2]}`;
      if (method === 'GET') return send(res, 200, { comments: store.listComments(key, me) });
      if (method === 'POST') {
        if (!me) throw bad('Missing fan id.');
        if (!limit(ip, 'post', 1, 4000)) throw new HttpError(429, 'Cooldown! Let that last take breathe for a few seconds.');
        const body = await readBody(req);
        const name = clean(body.name, 24), avatar = clean(body.avatar, 8), text = clean(body.text, 500);
        if (name.length < 2 || text.length < 2) throw bad('Need a name and a take.');
        store.setLabel(key, `${clean(body.leagueName, 40) || 'Fantasy league'} (Fantasy)`);
        try { return send(res, 201, store.addComment(key, { uid: me, name, avatar, text, heat: 'spicy', parentId: body.parentId ? clean(body.parentId, 64) : null })); }
        catch (e) { throw bad(e.message); }
      }
    }
  }

  if (method === 'GET' && parts[0] === 'hall') return send(res, 200, store.hall());

  throw new HttpError(404, 'Nothing here but tumbleweeds.');
}

function social(key, me) {
  return { poll: store.pollView(key, me), reactions: store.reactionsView(key), comments: store.listComments(key, me) };
}

// ---------- static ----------
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      return fs.readFile(path.join(PUBLIC, 'index.html'), (e2, html) => {
        res.writeHead(e2 ? 404 : 200, { 'content-type': MIME['.html'] }); res.end(html || 'Not found');
      });
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      const code = e.code && Number.isInteger(e.code) ? e.code : 502;
      if (code >= 500) console.error(e.message);
      send(res, code, { error: code >= 500 ? 'The sports gods are offline. Try again in a sec.' : e.message });
    }
    return;
  }
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`\n  🏟️  Trash Talk Live is up at http://localhost:${PORT}\n`);
});
