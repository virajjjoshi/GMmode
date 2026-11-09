// Games wiring: storage + historical data + service + /api/games/* routes.
//   GAMES_DATA_FILE=path   where attempts live (default data/games.json)
// Historical team-seasons are cached under DATA_DIR/games-history/.

const { createStore } = require('../predict/persist');
const { createHistory } = require('./history');
const { createService, GameError } = require('./service');
const { dataFile } = require('../paths');

function createGames({ file = process.env.GAMES_DATA_FILE || dataFile('games.json'), history = null, random } = {}) {
  const store = createStore(file);
  const service = createService({ store, history: history || createHistory({ cacheDir: dataFile('games-history') }), random });
  const isId = (v) => /^[0-9a-f-]{36}$/.test(v || '');

  async function handle({ req, res, url, parts, me, ip, send, readBody, HttpError, limit }) {
    const method = req.method;
    const [a, id, sub, n] = parts;
    const need = () => { if (!me) throw new HttpError(400, 'Missing fan id. Refresh the page.'); };
    const body = async () => {
      need();
      if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer. Too many clicks.');
      return readBody(req);
    };
    try {
      if (method === 'GET' && a === 'config') return send(res, 200, service.config());
      if (method === 'GET' && a === 'me') { need(); return send(res, 200, service.mine(me)); }
      if (a === 'attempts' && !id && method === 'POST') {
        const x = await body();
        // A roll can mean ~100+ upstream requests the first time a season is seen.
        if (!limit(ip, 'games-roll', 10, 60_000)) throw new HttpError(429, 'That\'s a lot of rolls. Give it a minute.');
        return send(res, 201, await service.roll(me, String(x.sport || '')));
      }
      if (a === 'attempts' && isId(id)) {
        if (method === 'GET' && !sub) return send(res, 200, await service.view(me, id));
        if (method === 'GET' && sub === 'runs' && /^\d{1,3}$/.test(n || '')) return send(res, 200, await service.runView(me, id, n));
        if (method === 'POST') {
          const x = await body();
          if (sub === 'squad') return send(res, 200, await service.saveSquad(me, id, x.squad));
          if (sub === 'lock') return send(res, 200, await service.lock(me, id, x.squad));
          if (sub === 'unlock') return send(res, 200, service.unlock(me, id));
          if (sub === 'simulate') {
            if (!limit(ip, 'games-sim', 30, 60_000)) throw new HttpError(429, 'Let the last season breathe for a second.');
            return send(res, 200, await service.simulate(me, id));
          }
        }
      }
    } catch (e) {
      if (e instanceof GameError) throw new HttpError(e.code, e.message);
      throw e;
    }
    throw new HttpError(404, 'Nothing here but tumbleweeds.');
  }

  return { handle, service, flush: () => store.flush() };
}

module.exports = { createGames };
