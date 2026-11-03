// Prediction Leagues storage: a JSON file, like lib/store.js, kept separate so
// it can't disturb takes/polls. Collections are keyed so the "constraints" hold
// by construction: one membership per league+fan, one pick per league+fan+game,
// one record per game. Schema changes go in MIGRATIONS (append only).

const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = [
  // v1: initial schema
  (db) => Object.assign(db, {
    leagues: db.leagues || {},     // id -> league
    members: db.members || {},     // `${leagueId}:${uid}` -> membership
    invites: db.invites || {},     // code -> invite
    picks: db.picks || {},         // `${leagueId}:${uid}:${gameKey}` -> pick
    games: db.games || {},         // `${league}:${id}` -> game record (shared across leagues)
    probs: db.probs || {},         // gameKey -> ESPN Matchup Predictor snapshot
    resultLog: db.resultLog || [], // audit trail of every outcome change
    activity: db.activity || {},   // leagueId -> recent events
  }),
];

function createStore(file, { saveDelay = 300 } = {}) {
  let db = {};
  if (file) {
    try { db = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw new Error(`Can't read ${file}: ${e.message}. Not overwriting it.`); }
  }
  const from = db.version || 0;
  for (let v = from; v < MIGRATIONS.length; v++) MIGRATIONS[v](db);
  db.version = MIGRATIONS.length;

  let timer = null;
  function flush() {
    clearTimeout(timer); timer = null;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, file);
  }
  function save() {
    if (!file) return;
    clearTimeout(timer);
    timer = setTimeout(flush, saveDelay);
  }
  if (from !== db.version) save();
  return { db, save, flush };
}

module.exports = { createStore, MIGRATIONS };
