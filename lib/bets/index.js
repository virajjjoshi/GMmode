// Bets wiring: storage + service + /api/bets/* routes.
//   BETS_DATA_FILE=path            where bet data lives (default data/bets.json)
//   SHARPSPORTS_PUBLIC_KEY / _PRIVATE_KEY   turn on real sportsbook linking

const path = require('node:path');
const { createStore } = require('../predict/persist');
const { createService, BetError } = require('./service');

const file = process.env.BETS_DATA_FILE || path.join(__dirname, '..', '..', 'data', 'bets.json');
const store = createStore(file);
for (const k of ['accounts', 'slips', 'lines', 'shared']) store.db[k] ||= {};

function createBets({ users }) {
  const service = createService({ store, users });
  service.rebuildReceipts();

  async function handle({ req, res, url, parts, me, ip, send, readBody, HttpError, clean, limit }) {
    const method = req.method;
    const [a] = parts;
    const need = () => { if (!me) throw new HttpError(400, 'Missing fan id. Refresh the page.'); };
    const body = async () => {
      need();
      if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer. Too many clicks.');
      return readBody(req);
    };
    try {
      if (method === 'GET' && a === 'config') return send(res, 200, service.config());
      if (method === 'GET' && a === 'me') { need(); return send(res, 200, await service.view(me)); }
      if (method === 'GET' && a === 'action') { need(); return send(res, 200, await service.action(me)); }
      if (method === 'GET' && a === 'feed') return send(res, 200, await service.feed(me));
      if (method === 'GET' && a === 'hall') return send(res, 200, await service.hall(me));

      if (method === 'POST') {
        const x = await body();
        if (a === 'age') {
          if (x.confirm !== true) throw new HttpError(400, 'You need to be 21+ to use the Bets section.');
          return send(res, 200, service.confirmAge(me));
        }
        if (a === 'link') {
          if (!limit(ip, 'bets-link', 6, 60_000)) throw new HttpError(429, 'Slow down. That\'s a lot of linking.');
          if (x.provider === 'demo') return send(res, 200, await service.linkDemo(me));
          if (x.provider === 'sharpsports') {
            const back = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/#/bets?linked=1`;
            return send(res, 200, await service.linkSharp(me, back));
          }
          throw new HttpError(400, 'Unknown provider.');
        }
        if (a === 'unlink') return send(res, 200, service.unlink(me, x.provider === 'demo' ? 'demo' : 'sharpsports'));
        if (a === 'sync') { await service.sync(me, true); return send(res, 200, await service.view(me)); }
        if (a === 'share') {
          const profile = { name: clean(x.name, 24), avatar: clean(x.avatar, 8) };
          return send(res, 200, service.share(me, clean(x.slipId, 80), x.where, !!x.on, profile));
        }
        if (a === 'vote') return send(res, 200, service.vote(me, clean(x.slipId, 80), x.side));
      }
    } catch (e) {
      if (e instanceof BetError) throw new HttpError(e.code, e.message);
      throw e;
    }
    throw new HttpError(404, 'Nothing here but tumbleweeds.');
  }

  function flush() { try { store.flush(); } catch { /* best effort */ } }
  return { handle, service, flush };
}

module.exports = { createBets };
