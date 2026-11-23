// GM Mode wiring: storage + MLB worlds + service + /api/office/* routes.
//   GET  config                    the current MLB world (teams, data date, counts)
//   GET  saves                     your saves
//   POST saves {team}              take over a team (new save on the newest world)
//   GET  saves/:id                 the front office: roster, depth chart, budget, free agents, news
//   GET  saves/:id/teams/:team     another team's roster with trade values (trade screen)
//   POST saves/:id/sign {playerId, aav, years}
//   POST saves/:id/release {playerId}
//   POST saves/:id/trade {partner, give[], get[], execute}
//   POST saves/:id/advance         next offseason week (AI teams sign free agents)
//   POST saves/:id/simulate        simulate next season + postseason
//   GET  saves/:id/sims/:n         one simulated season in full
//   DELETE saves/:id
//   GM_DATA_FILE=path   where saves live (default data/gm.json)
// MLB snapshots are cached under DATA_DIR/office/.

const { createStore } = require('../predict/persist');
const { createWorlds } = require('./mlb');
const { createService, GmError } = require('./service');
const { dataFile } = require('../paths');

function createOffice({ file = process.env.GM_DATA_FILE || dataFile('gm.json'), worlds = null, now } = {}) {
  const store = createStore(file);
  worlds ||= createWorlds({ dir: dataFile('office') });
  const service = createService({ store, worlds, now });
  const isId = (v) => /^[0-9a-f-]{36}$/.test(v || '');
  setInterval(() => { try { worlds.prune(service.versionsInUse()); } catch { /* best effort */ } }, 6 * 3600_000).unref();

  async function handle({ req, res, parts, me, ip, send, readBody, HttpError, limit }) {
    const method = req.method;
    const [a, id, sub, arg] = parts;
    const need = () => { if (!me) throw new HttpError(400, 'Missing fan id. Refresh the page.'); };
    const body = async () => {
      need();
      if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there. Too many clicks.');
      return readBody(req);
    };
    try {
      if (method === 'GET' && a === 'config') return send(res, 200, service.config(await worlds.current()));
      if (a === 'saves' && !id) {
        need();
        if (method === 'GET') return send(res, 200, { saves: service.list(me) });
        if (method === 'POST') {
          const x = await body();
          if (!limit(ip, 'gm-new', 12, 60_000)) throw new HttpError(429, 'That\'s a lot of new saves. Give it a minute.');
          const s = service.create(me, await worlds.current(), x.team);
          return send(res, 201, service.view(me, s.id));
        }
      }
      if (a === 'saves' && isId(id)) {
        need();
        if (method === 'GET' && !sub) return send(res, 200, service.view(me, id));
        if (method === 'GET' && sub === 'teams' && /^\d{1,4}$/.test(arg || '')) return send(res, 200, service.teamView(me, id, arg));
        if (method === 'GET' && sub === 'sims' && /^\d{1,4}$/.test(arg || '')) return send(res, 200, service.simView(me, id, arg));
        if (method === 'DELETE' && !sub) return send(res, 200, service.remove(me, id));
        if (method === 'POST') {
          const x = await body();
          if (sub === 'sign') return send(res, 200, service.sign(me, id, x));
          if (sub === 'release') return send(res, 200, service.release(me, id, x));
          if (sub === 'trade') return send(res, 200, service.trade(me, id, { partner: x.partner, give: Array.isArray(x.give) ? x.give : [], get: Array.isArray(x.get) ? x.get : [], execute: x.execute === true }));
          if (sub === 'advance') return send(res, 200, service.advance(me, id));
          if (sub === 'simulate') {
            if (!limit(ip, 'gm-sim', 30, 60_000)) throw new HttpError(429, 'Let the last season breathe for a second.');
            return send(res, 200, service.simulate(me, id));
          }
        }
      }
    } catch (e) {
      if (e instanceof GmError) throw new HttpError(e.code, e.message);
      throw e;
    }
    throw new HttpError(404, 'Nothing here but tumbleweeds.');
  }

  return { handle, service, flush: () => store.flush() };
}

module.exports = { createOffice };
