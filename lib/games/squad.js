// Games: squad rules. A squad is { "<SLOT>.<i>": playerId }, e.g. { "QB.0": "2330",
// "WR.0": "...", "WR.1": "..." }. The server checks every squad it's sent, so the
// browser can't slip in a player from another roster, the same player twice,
// or a center at quarterback.

const { SPORTS, slotKeys } = require('./sports');

class SquadError extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

// Which of a player's eligible groups this slot accepts, highest model PPG first.
function fits(slot, player) {
  return slot.elig.filter((g) => player.elig.includes(g)).sort((a, b) => (player.pg?.[b] ?? 0) - (player.pg?.[a] ?? 0));
}

// Returns { squad, missing: [slot keys], errors: [...] }. With complete: true a
// missing slot is an error too. Unknown keys and empty values are dropped.
function check(sportKey, players, squad, { complete = false } = {}) {
  const byId = new Map(players.map((p) => [String(p.id), p]));
  const keys = slotKeys(sportKey);
  const known = new Map(keys.map((k) => [k.key, k.slot]));
  const clean = {}, errors = [], used = new Map();
  if (squad && typeof squad !== 'object') throw new SquadError('Bad squad.');
  for (const [k, raw] of Object.entries(squad || {})) {
    if (raw === null || raw === undefined || raw === '') continue;
    const slot = known.get(k);
    if (!slot) { errors.push(`There's no ${k} slot in this challenge.`); continue; }
    const id = String(raw);
    const p = byId.get(id);
    if (!p) { errors.push('That player wasn\'t on this team\'s roster that season.'); continue; }
    if (used.has(id)) { errors.push(`${p.name} is already in your squad.`); continue; }
    if (!fits(slot, p).length) { errors.push(`${p.name} (${p.pos}) can't fill a ${slot.label} slot.`); continue; }
    used.set(id, k);
    clean[k] = id;
  }
  const missing = keys.filter((k) => !clean[k.key]).map((k) => k.key);
  if (complete && missing.length) errors.push(`Still to fill: ${describeMissing(sportKey, missing)}.`);
  return { squad: clean, missing, errors };
}

function describeMissing(sportKey, missing) {
  const n = {};
  for (const k of missing) { const id = k.split('.')[0]; n[id] = (n[id] || 0) + 1; }
  return SPORTS[sportKey].slots.filter((s) => n[s.id]).map((s) => `${n[s.id]} ${n[s.id] > 1 ? s.plural || `${s.label}s` : s.label}`).join(', ');
}

// Squad -> [{ key, slot, player, group, ppg }] in slot order (the sim's input).
// ppg is the player's model fantasy PPG in the group this slot uses.
function resolve(sportKey, players, squad) {
  const byId = new Map(players.map((p) => [String(p.id), p]));
  return slotKeys(sportKey).map(({ key, slot }) => {
    const p = byId.get(String(squad[key] || ''));
    if (!p) return { key, slot, player: null, group: null, ppg: null };
    const group = fits(slot, p)[0];
    return { key, slot, player: p, group, ppg: p.pg[group] ?? p.mppg };
  });
}

// The highest-PPG legal squad (greedy, specific slots before flex). Used by
// tests and by the calibration script; the UI never auto-drafts for you.
function best(sportKey, players) {
  const keys = slotKeys(sportKey);
  const order = [...keys.filter((k) => !k.slot.flex), ...keys.filter((k) => k.slot.flex)];
  const squad = {}, used = new Set();
  for (const { key, slot } of order) {
    const pick = players
      .filter((p) => !used.has(p.id) && fits(slot, p).length)
      .sort((a, b) => (b.pg[fits(slot, b)[0]] ?? 0) - (a.pg[fits(slot, a)[0]] ?? 0))[0];
    if (pick) { squad[key] = pick.id; used.add(pick.id); }
  }
  return squad;
}

module.exports = { check, resolve, best, fits, describeMissing, SquadError };
