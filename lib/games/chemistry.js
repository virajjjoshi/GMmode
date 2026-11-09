// Games: team chemistry. Drafted players with a verified history together play
// a little better together, and the bonus is paid in fantasy points per game.
//
// What counts (all from ESPN records, nothing inferred from names):
//   college      both players' ESPN athlete records list the same college id
//   teammates    both appeared for the same franchise in the same season BEFORE
//                the rolled season (ESPN's season-by-season statistics log).
//                Same franchise in different years is not a connection.
//   national     soccer only: both appeared for the same national team in the
//                same international competition season (World Cup, Euros,
//                qualifiers, friendlies...), and ESPN marks that team as a
//                national team (isNational).
// Everyone you draft is a teammate in the rolled season by definition, so that
// season never counts.
//
// How much it's worth, as a share of each connected player's own PPG:
//   college +1%, teammates +0.5% per shared season (up to 3 seasons, +1.5%),
//   national team +1%. Categories stack for a pair up to +2%; a player's total
//   from all his connections is capped at +3%. Each pair and each shared season
//   is counted once. Sized from the simulations: a fully connected core (the
//   1990s Bulls, a long-tenured Patriots offense) gains a few wins a season at
//   most, far less than the gap between a strong and a weak draft, and
//   chemistry can never turn a weak player into a strong one.

const RULES = {
  college: 0.01, season: 0.005, maxSeasons: 3, national: 0.01,
  pairCap: 0.02, playerCap: 0.03,
};

const COMPS = {
  'fifa.world': 'World Cup', 'fifa.worldq': 'World Cup qualifying', 'fifa.friendly': 'friendlies', 'fifa.confederations': 'Confederations Cup',
  'uefa.euro': 'Euros', 'uefa.euroq': 'Euro qualifying', 'uefa.nations': 'Nations League', 'conmebol.america': 'Copa América',
  'concacaf.gold': 'Gold Cup', 'concacaf.nations': 'CONCACAF Nations League', 'caf.nations': 'Africa Cup of Nations', 'afc.asian': 'Asian Cup',
  'fifa.olympics': 'Olympics',
};
const compName = (slug) => COMPS[slug] || COMPS[Object.keys(COMPS).find((k) => slug.startsWith(`${k}.`))] || slug;

const pairKey = (a, b) => (String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`);
const pct = (x) => `${Math.round(x * 1000) / 10}%`;

// One pair's verified connections. bio: { college:{id,name}|null, past:[{s,t,lg}], nat:[{c,s,t}] }
function pair(a, b, names = {}, label = (s) => String(s)) {
  if (!a || !b) return null;
  const kinds = [];
  let rate = 0;
  if (a.college?.id && a.college.id === b.college?.id) {
    kinds.push({ kind: 'college', text: `Both went to ${a.college.name || 'the same college'}`, rate: RULES.college });
    rate += RULES.college;
  }
  if (a.past?.length && b.past?.length) {
    const mine = new Map(a.past.map((x) => [`${x.s}|${x.t}`, x]));
    const shared = new Map();
    for (const x of b.past) { const k = `${x.s}|${x.t}`; if (mine.has(k)) shared.set(k, x); }
    if (shared.size) {
      const seasons = [...shared.values()].sort((x, y) => x.s - y.s);
      const n = new Set(seasons.map((x) => x.s)).size; // a season counts once even across two franchises
      const r = RULES.season * Math.min(RULES.maxSeasons, n);
      const where = seasons.map((x) => `${label(x.s, x.lg)} ${names.teams?.[`${x.s}|${x.t}`] || 'same team'}`);
      kinds.push({
        kind: 'teammates', seasons: n, rate: r,
        text: `Teammates before: ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` and ${where.length - 3} more` : ''}`,
      });
      rate += r;
    }
  }
  if (a.nat?.length && b.nat?.length) {
    const mine = new Set(a.nat.map((x) => `${x.c}|${x.s}|${x.t}`));
    const shared = b.nat.filter((x) => mine.has(`${x.c}|${x.s}|${x.t}`));
    if (shared.length) {
      const team = shared[0].t;
      const comps = [...new Set(shared.filter((x) => x.t === team).map((x) => `${x.s} ${compName(x.c)}`))];
      kinds.push({ kind: 'national', rate: RULES.national, text: `Played together for ${names.nat?.[team] || 'their country'}: ${comps.slice(0, 3).join(', ')}${comps.length > 3 ? '…' : ''}` });
      rate += RULES.national;
    }
  }
  if (!kinds.length) return null;
  return { kinds, rate: Math.min(RULES.pairCap, rate) };
}

// Every connected pair in a pool, computed once per team-season.
function pairsFor(players, bios, names, label) {
  const out = {};
  const ids = players.map((p) => p.id).filter((id) => bios[id]);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const c = pair(bios[ids[i]], bios[ids[j]], names, label);
      if (c) out[pairKey(ids[i], ids[j])] = c;
    }
  }
  return out;
}

// Chemistry for a set of drafted players. members: [{ id, name, ppg }] where
// ppg is the model PPG in the slot he fills. Returns the PPG bonus per player,
// the links between them and the team total.
function compute(members, pairs) {
  const players = {};
  const links = [];
  for (const m of members) players[m.id] = { id: m.id, rate: 0, raw: 0, bonus: 0, links: 0 };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i], b = members[j];
      const c = pairs[pairKey(a.id, b.id)];
      if (!c) continue;
      players[a.id].raw += c.rate; players[b.id].raw += c.rate;
      players[a.id].links++; players[b.id].links++;
      links.push({ a: a.id, b: b.id, aName: a.name, bName: b.name, rate: c.rate, kinds: c.kinds });
    }
  }
  let total = 0;
  for (const m of members) {
    const p = players[m.id];
    p.rate = Math.min(RULES.playerCap, p.raw);
    p.capped = p.raw > RULES.playerCap;
    p.bonus = Math.round((m.ppg || 0) * p.rate * 100) / 100;
    total += p.bonus;
  }
  // Each link's share of the bonus, for display: what it adds to both players.
  for (const l of links) {
    const pa = players[l.a], pb = players[l.b];
    const share = (p, m) => (p.raw ? (p.bonus * l.rate) / p.raw : 0);
    l.ppg = Math.round((share(pa) + share(pb)) * 100) / 100;
  }
  links.sort((x, y) => y.ppg - x.ppg);
  return { total: Math.round(total * 100) / 100, players, links };
}

// What adding a candidate would do to the team's chemistry PPG.
function delta(members, candidate, pairs) {
  const before = compute(members, pairs).total;
  const after = compute([...members, candidate], pairs);
  const mine = after.links.filter((l) => l.a === candidate.id || l.b === candidate.id);
  return { ppg: Math.round((after.total - before) * 100) / 100, with: mine.map((l) => ({ id: l.a === candidate.id ? l.b : l.a, name: l.a === candidate.id ? l.bName : l.aName, kinds: l.kinds.map((k) => k.kind), text: l.kinds.map((k) => k.text).join(' · ') })) };
}

function describe() {
  return {
    college: pct(RULES.college), season: pct(RULES.season), maxSeasons: RULES.maxSeasons, national: pct(RULES.national),
    pairCap: pct(RULES.pairCap), playerCap: pct(RULES.playerCap),
  };
}

module.exports = { RULES, pair, pairKey, pairsFor, compute, delta, describe, compName };
