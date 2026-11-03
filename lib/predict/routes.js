// Prediction Leagues HTTP layer: /api/pl/*. Parses input and forwards to the
// service; every permission and deadline check happens in the service.

const { PlError } = require('./service');

const isLid = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{6,16}$/.test(v);

function createRoutes(service) {
  return async function handle({ req, res, url, parts, me, ip, send, readBody, HttpError, clean, limit }) {
    const method = req.method;
    const [a, b, c, d] = parts;
    const need = () => { if (!me) throw new HttpError(400, 'Missing fan id. Refresh the page.'); };
    const body = async () => {
      need();
      if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer. Too many clicks.');
      const x = await readBody(req);
      const profile = { name: clean(x.name, 24), avatar: clean(x.avatar, 8) };
      service.touch(me, profile.name, profile.avatar);
      return { x, profile };
    };
    const week = () => { const w = url.searchParams.get('week'); return w && /^\d{1,2}$/.test(w) ? Number(w) : null; };

    try {
      if (method === 'GET' && a === 'config') return send(res, 200, service.config());
      if (method === 'GET' && a === 'home') { need(); return send(res, 200, await service.home(me)); }
      if (method === 'GET' && a === 'discover') return send(res, 200, { leagues: service.discover(me) });
      if (method === 'GET' && a === 'me' && b === 'stats') { need(); return send(res, 200, service.myStats(me)); }

      if (a === 'invites' && b) {
        const code = clean(b, 16);
        if (method === 'GET' && !c) return send(res, 200, service.invitePreview(me, code));
        if (method === 'POST' && c === 'join') {
          const { profile } = await body();
          return send(res, 200, service.join(me, null, { code, profile }));
        }
      }

      if (a === 'leagues' && !b && method === 'POST') {
        const { x, profile } = await body();
        if (!limit(ip, 'pl-create', 5, 60_000)) throw new HttpError(429, 'Slow down. That\'s a lot of new leagues.');
        const input = {
          name: clean(x.leagueName, 40), description: clean(x.description, 200), avatar: clean(x.leagueAvatar, 8), visibility: x.visibility,
          sports: x.sports, seasonStart: x.seasonStart, seasonEnd: x.seasonEnd, format: x.format, rules: x.rules, settings: x.settings,
        };
        return send(res, 201, service.createLeague(me, input, profile));
      }

      if (a === 'leagues' && isLid(b)) {
        const lid = b;
        if (method === 'GET') {
          if (!c) return send(res, 200, await service.leagueOverview(me, lid));
          if (c === 'slate') return send(res, 200, await service.slate(me, lid, week()));
          if (c === 'week') return send(res, 200, await service.weekBoard(me, lid, week()));
          if (c === 'season') return send(res, 200, await service.seasonBoard(me, lid));
          if (c === 'members' && !d) return send(res, 200, service.members(me, lid));
          if (c === 'members' && d) return send(res, 200, service.memberProfile(me, lid, clean(d, 16)));
          if (c === 'invite') return send(res, 200, service.getInvite(me, lid));
        }
        if (method === 'PATCH' && !c) {
          const { x } = await body();
          const input = {};
          for (const k of ['visibility', 'sports', 'seasonStart', 'seasonEnd', 'format', 'rules', 'settings']) if (x[k] !== undefined) input[k] = x[k];
          if (x.leagueName !== undefined) input.name = clean(x.leagueName, 40); // `name` is the fan's display name on every request
          if (x.description !== undefined) input.description = clean(x.description, 200);
          if (x.leagueAvatar !== undefined) input.avatar = clean(x.leagueAvatar, 8);
          return send(res, 200, service.updateLeague(me, lid, input));
        }
        if (method === 'POST') {
          const { x, profile } = await body();
          if (c === 'join') return send(res, 200, service.join(me, lid, { code: x.code ? clean(x.code, 16) : null, profile }));
          if (c === 'leave') return send(res, 200, service.leave(me, lid));
          if (c === 'archive') return send(res, 200, service.archiveLeague(me, lid));
          if (c === 'invite') return send(res, 200, service.manageInvite(me, lid, { action: x.action, expiresInDays: x.expiresInDays, maxUses: x.maxUses }));
          if (c === 'picks') return send(res, 200, await service.savePicks(me, lid, x.picks));
        }
        if (method === 'DELETE' && c === 'members' && d) {
          need();
          if (!limit(ip, 'w', 40, 10_000)) throw new HttpError(429, 'Easy there, speed racer.');
          return send(res, 200, service.removeMember(me, lid, clean(d, 16)));
        }
      }
    } catch (e) {
      if (e instanceof PlError) throw new HttpError(e.code, e.message);
      throw e;
    }
    throw new HttpError(404, 'Nothing here but tumbleweeds.');
  };
}

module.exports = { createRoutes };
