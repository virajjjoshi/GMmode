// Tiny JSON-file store for takes, polls, reactions and final results.
// Good enough for local / a single small server; swap for Postgres later.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let db = { comments: {}, polls: {}, reactions: {}, results: {}, labels: {}, users: {} };
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch { /* first run */ }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
  }, 300);
}

const REACTIONS = ['🔥', '😂', '😭', '🤡', '🐐', '🧂', '💀', '🚀'];

// Keep it PG-13 and funny: swap the worst words for something sillier.
const SOFTEN = [
  [/\bf+u+c+k+(ing|ed|er|s)?\b/gi, 'fudge$1'],
  [/\bs+h+i+t+(ty|s)?\b/gi, 'shoot$1'],
  [/\bb+i+t+c+h+(es|y)?\b/gi, 'biscuit$1'],
  [/\ba+s+s+h+o+l+e+s?\b/gi, 'goofball'],
  [/\bd+a+m+n+(ed|it)?\b/gi, 'dang$1'],
];
function soften(text) {
  return SOFTEN.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

function touchUser(uid, name, avatar) {
  if (!uid || !name) return;
  const u = db.users[uid];
  if (!u || u.name !== name || u.avatar !== avatar) { db.users[uid] = { name, avatar }; save(); }
}

function publicComment(c, uid) {
  const fire = Object.values(c.votes).filter((v) => v === 'fire').length;
  const cap = Object.values(c.votes).filter((v) => v === 'cap').length;
  return {
    id: c.id, parentId: c.parentId, name: c.name, avatar: c.avatar, text: c.text, heat: c.heat,
    createdAt: c.createdAt, fire, cap, score: fire - cap,
    myVote: uid ? c.votes[uid] || null : null, mine: !!uid && c.uid === uid,
    gameKey: c.gameKey, gameLabel: db.labels[c.gameKey] || c.gameKey,
  };
}

function listComments(gameKey, uid) {
  return Object.values(db.comments).filter((c) => c.gameKey === gameKey).map((c) => publicComment(c, uid));
}

function addComment(gameKey, { uid, name, avatar, text, heat, parentId }) {
  if (parentId && (!db.comments[parentId] || db.comments[parentId].gameKey !== gameKey)) throw new Error('bad parent');
  const id = crypto.randomUUID();
  db.comments[id] = {
    id, gameKey, parentId: parentId || null, uid, name, avatar, text: soften(text), heat,
    createdAt: Date.now(), votes: {},
  };
  save();
  return publicComment(db.comments[id], uid);
}

function voteComment(id, uid, kind) {
  const c = db.comments[id];
  if (!c) throw new Error('not found');
  if (c.votes[uid] === kind) delete c.votes[uid]; // toggle off
  else c.votes[uid] = kind;
  save();
  return publicComment(c, uid);
}

function deleteComment(id, uid) {
  const c = db.comments[id];
  if (!c || c.uid !== uid) throw new Error('not yours');
  for (const k of Object.keys(db.comments)) if (db.comments[k].parentId === id) delete db.comments[k];
  delete db.comments[id];
  save();
}

function pollView(gameKey, uid) {
  const p = db.polls[gameKey] || {};
  let home = 0, away = 0;
  for (const s of Object.values(p)) s === 'home' ? home++ : away++;
  return { home, away, mine: uid ? p[uid] || null : null };
}
function vote(gameKey, uid, side) {
  db.polls[gameKey] ||= {};
  db.polls[gameKey][uid] = side;
  save();
  return pollView(gameKey, uid);
}

function reactionsView(gameKey) {
  const r = db.reactions[gameKey] || {};
  return Object.fromEntries(REACTIONS.map((e) => [e, r[e] || 0]));
}
function react(gameKey, emoji, n = 1) {
  if (!REACTIONS.includes(emoji)) throw new Error('bad emoji');
  db.reactions[gameKey] ||= {};
  db.reactions[gameKey][emoji] = (db.reactions[gameKey][emoji] || 0) + Math.min(10, Math.max(1, n));
  save();
  return reactionsView(gameKey);
}

// Called whenever we see a game; remembers labels + who won, for the prophet board.
function noteGame(g) {
  const key = `${g.league}:${g.id}`;
  const label = `${g.away?.abbr || '?'} @ ${g.home?.abbr || '?'} (${g.leagueLabel})`;
  let dirty = false;
  if (db.labels[key] !== label) { db.labels[key] = label; dirty = true; }
  if (g.status.state === 'post' && !db.results[key] && g.home && g.away) {
    const hs = g.home.score ?? 0, as = g.away.score ?? 0;
    db.results[key] = hs === as ? 'tie' : hs > as ? 'home' : 'away';
    dirty = true;
  }
  if (dirty) save();
}

function hall() {
  const all = Object.values(db.comments).map((c) => publicComment(c));
  const topTakes = [...all].sort((a, b) => b.score - a.score || b.createdAt - a.createdAt).slice(0, 15);
  const clowns = [...all].filter((c) => c.cap > 0).sort((a, b) => b.cap - a.cap).slice(0, 5);

  const users = {};
  for (const c of Object.values(db.comments)) {
    const u = (users[c.uid] ||= { name: c.name, avatar: c.avatar, takes: 0, fire: 0, cap: 0, right: 0, wrong: 0 });
    const known = db.users[c.uid];
    u.name = known?.name || c.name; u.avatar = known?.avatar || c.avatar; u.takes++;
    for (const v of Object.values(c.votes)) v === 'fire' ? u.fire++ : u.cap++;
  }
  for (const [key, voters] of Object.entries(db.polls)) {
    const res = db.results[key];
    if (!res || res === 'tie') continue;
    for (const [uid, side] of Object.entries(voters)) {
      const known = db.users[uid] || {};
      const u = (users[uid] ||= { name: known.name || null, avatar: known.avatar || null, takes: 0, fire: 0, cap: 0, right: 0, wrong: 0 });
      side === res ? u.right++ : u.wrong++;
    }
  }
  const named = Object.values(users).filter((u) => u.name);
  const takeMasters = [...named].sort((a, b) => (b.fire - b.cap) - (a.fire - a.cap)).slice(0, 10);
  const prophets = named.filter((u) => u.right + u.wrong > 0)
    .sort((a, b) => b.right - a.right || a.wrong - b.wrong).slice(0, 10);
  return { topTakes, clowns, takeMasters, prophets, totals: { takes: all.length, games: Object.keys(db.labels).length } };
}

module.exports = {
  REACTIONS, touchUser, listComments, addComment, voteComment, deleteComment,
  pollView, vote, reactionsView, react, noteGame, hall,
};
