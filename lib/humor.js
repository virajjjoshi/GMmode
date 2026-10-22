// The comedy department. Everything here is deterministic per game + state,
// so a card's joke doesn't flicker every time the scores refresh.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(String(seed));
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? k)
  .replace(/(\w+s)'s\b/g, "$1'"); // Falcons's -> Falcons'

// What "close" and "blowout" mean differs wildly by sport.
const SCALE = {
  football:   { close: 8,  blowout: 21, periods: 4, low: 24,  high: 65 },
  basketball: { close: 6,  blowout: 20, periods: 4, low: 190, high: 250 },
  baseball:   { close: 1,  blowout: 6,  periods: 9, low: 3,   high: 17 },
  hockey:     { close: 1,  blowout: 4,  periods: 3, low: 2,   high: 10 },
  soccer:     { close: 1,  blowout: 3,  periods: 2, low: 0,   high: 6 },
};

const winPct = (rec) => {
  if (!rec) return null;
  const p = rec.split('-').map(Number);
  if (p.length < 2 || p.some(Number.isNaN)) return null;
  const g = p.reduce((a, b) => a + b, 0);
  return g ? p[0] / g : null;
};

const LINES = {
  pre: [
    "{home} and {away} are currently tied 0-0. Enjoy it, someone's about to ruin it.",
    "Pregame vibes: immaculate. Pregame nachos: questionable. {away} at {home}.",
    "Experts give {away} a chance. The experts are a guy named Steve. Steve is wrong a lot.",
    "Somewhere a {home} fan is already blaming the refs for something that hasn't happened yet.",
    "{away} travelled all the way to {homeLoc} and they'd like you to know the hotel was mid.",
    "Reminder: this game is a 100% verified Must-Win for {home}. Like the last 14.",
    "Hot dogs are being boiled. Hopes are being raised. {away} vs {home}, coming soon.",
    "The group chat has been arguing about {away}-{home} for 3 days. It ends today.",
  ],
  nailbiter: [
    "Cardiologists in {homeLoc} have been placed on standby.",
    "{diff}-point game late. Somebody hold the remote, nobody is allowed to change the channel.",
    "Fingernails across the country are an endangered species right now.",
    "This one is closer than your cousin's fantasy league feud.",
    "If you leave to beat traffic right now, you deserve the traffic.",
    "{leader} by {diff}. That's not a lead, that's a rumor.",
  ],
  close: [
    "Closer than a pair of jeans after Thanksgiving. {leader} up {diff}.",
    "Neither team is letting go. Clingy. Toxic. We love to see it.",
    "{leader} up {diff}, which in sports terms means \"absolutely nothing yet.\"",
    "Back-and-forth like a toddler deciding between two snacks.",
  ],
  blowout: [
    "Security, please escort {trailer} from the premises.",
    "{leader} up {diff}. {trailer} fans: up to their necks in regret.",
    "At this point {trailer} should just ask for a rematch in Mario Kart.",
    "Somebody check on {trailer}. Gently. With snacks.",
    "{trailer}'s game plan appears to be \"thoughts and prayers.\"",
    "This is no longer a game. This is a documentary.",
  ],
  normal_in: [
    "{leader} up {diff}. Nobody is panicking. (Everyone is panicking.)",
    "We're in the {period}. Snacks are dwindling. Hope is not.",
    "{trailer} down {diff}, which their fans are calling \"part of the plan.\"",
    "Mid-game report: vibes are mid, but the game is still on.",
    "{leader} in front, and {leader} fans are already acting like they invented the sport.",
  ],
  tied_in: [
    "Tied at {hs}. Nobody wants to win this, apparently.",
    "All square. The universe demands more chaos.",
    "Dead even. Like a group project where everyone did the same amount of nothing.",
  ],
  final_blowout: [
    "FINAL: {winner} {ws}, {loser} {ls}. {loser} fans are now pretending they're into curling.",
    "{winner} by {diff}. {loser} fans have entered witness protection.",
    "{loser} played like the group project member who \"had Wi-Fi issues.\"",
    "That wasn't a game, that was a {winner} highlight reel with extras.",
    "{loser} will be reviewing the tape. Then burning the tape.",
  ],
  final_close: [
    "{winner} by {diff}, barely. {loser} fans are typing paragraphs as we speak.",
    "A squeaker for {winner}. Somebody check {loser}'s locker room for broken Gatorade coolers.",
    "Won by {diff}. {winner} fans call it \"clutch.\" {loser} fans call it \"refs.\"",
    "A {diff}-point heartbreaker. {loser} fans: it's okay to cry in the car.",
  ],
  final_normal: [
    "{winner} {ws}, {loser} {ls}. {loser} would like to speak to a manager.",
    "W for {winner}. For {loser}: a long bus ride and a sad playlist.",
    "Final: {winner} {ws}, {loser} {ls}. Group chats in {loserLoc} have gone silent.",
    "{winner} handled business. {loser} handled... being there.",
  ],
  final_tie: [
    "Ends level at {hs}-{as}. Everybody loses. Especially the viewers.",
    "A draw: the sporting equivalent of \"we should hang out sometime.\"",
  ],
  ot: [
    "BONUS SPORTS! Free extra game, no coupon required.",
    "Overtime. The game is refusing to end, like a Marvel post-credits scene.",
    "We've gone to extra time. Babysitters everywhere are charging double.",
  ],
  upset: [
    "🚨 UPSET ALERT: {underdog} over {favorite}? That should be illegal.",
    "Nobody gave {underdog} the script. {favorite} fans are furious.",
    "Your bracket. Your parlay. Your dignity. All gone thanks to {underdog}.",
  ],
  snooze: [
    "Offense is optional, apparently. Combined {total} points.",
    "This game is being prescribed as a sleep aid.",
    "Both offenses called in sick. {total} total points.",
  ],
  fireworks: [
    "Defense? Never heard of her. {total} combined points.",
    "This scoreboard needs a cooling fan. {total} points and counting.",
    "Both defenses went to get snacks and never came back.",
  ],
};

const EXCUSES = [
  "The refs were clearly paid in Arby's coupons.",
  "Mercury is in retrograde. Look it up.",
  "The sun was in our eyes. It was a night game. Indoors.",
  "We were saving our energy for next season.",
  "The other team was using a cheat code. Up, up, down, down...",
  "Our best player ate gas station sushi pregame.",
  "Honestly the grass was too green. Distracting.",
  "The jerseys were too heavy. Wardrobe issue.",
  "Moral victory. We covered the vibe spread.",
  "The stadium DJ played the wrong walkout songs.",
  "We had them right where we wanted them: winning.",
  "Bad luck because I wore my lucky socks inside out.",
  "The ball was slippery. All of it. The whole game.",
  "My uncle says the league is rigged and he's never been wrong (he's always wrong).",
  "We let them win to boost league morale. You're welcome.",
];

function periodName(sport, p) {
  if (!p) return 'game';
  if (sport === 'baseball') return `${ordinal(p)} inning`;
  if (sport === 'hockey') return p > 3 ? 'overtime' : `${ordinal(p)} period`;
  if (sport === 'soccer') return p === 1 ? 'first half' : 'second half';
  return p > 4 ? 'overtime' : `${ordinal(p)} quarter`;
}
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Returns { badge, badgeClass, line, chaos } for a normalized game.
function vibe(g) {
  const sc = SCALE[g.sport] || SCALE.football;
  const { state, period, detail } = g.status;
  const h = g.home, a = g.away;
  if (!h || !a) return { badge: '🤷 MYSTERY', badgeClass: 'meh', line: 'Data went out for a hot dog.', chaos: 0 };
  const hs = h.score ?? 0, as = a.score ?? 0;
  const diff = Math.abs(hs - as);
  const total = hs + as;
  const leader = hs >= as ? h : a, trailer = hs >= as ? a : h;
  const v = {
    home: h.name, away: a.name, homeLoc: h.location || h.name, loserLoc: (trailer.location || trailer.name),
    leader: leader.name, trailer: trailer.name, winner: leader.name, loser: trailer.name,
    diff, total, hs, as, ws: Math.max(hs, as), ls: Math.min(hs, as), period: periodName(g.sport, period),
  };
  const r = rng(`${g.id}:${state}:${state === 'in' ? Math.floor(period) : ''}:${diff > sc.blowout ? 'b' : diff <= sc.close ? 'c' : 'n'}`);

  const ot = /OT|SO|Overtime|Extra|Shootout|AET|Pens/i.test(detail || '') || (g.sport !== 'baseball' && period > sc.periods && g.sport !== 'soccer');
  const lateness = state === 'post' ? 1 : state === 'in' ? Math.min(1, period / sc.periods) : 0;

  // Upset: the team with the clearly worse record is leading late or won.
  const hp = winPct(h.record), ap = winPct(a.record);
  let underdog = null, favorite = null;
  if (hp != null && ap != null && Math.abs(hp - ap) >= 0.2 && diff > 0 && lateness >= 0.5) {
    const dog = hp < ap ? h : a;
    if (dog === leader) { underdog = dog.name; favorite = (dog === h ? a : h).name; }
  }
  v.underdog = underdog; v.favorite = favorite;

  // Chaos meter: closeness x lateness, plus OT and upset bonuses.
  const closeness = Math.max(0, 1 - diff / (sc.blowout * 1.2));
  let chaos = state === 'pre' ? 0 : Math.round(closeness * (0.35 + 0.65 * lateness) * 75);
  if (ot) chaos += 20;
  if (underdog) chaos += 15;
  chaos = Math.max(state === 'pre' ? 0 : 3, Math.min(100, chaos));

  let badge, badgeClass, pool;
  if (state === 'pre') {
    badge = '⏳ WARMING UP'; badgeClass = 'pre'; pool = LINES.pre;
  } else if (underdog && r() < 0.8) {
    badge = '🚨 UPSET ALERT'; badgeClass = 'upset'; pool = LINES.upset;
  } else if (ot) {
    badge = '🕐 BONUS SPORTS'; badgeClass = 'ot'; pool = LINES.ot;
  } else if (state === 'post') {
    if (diff === 0) { badge = '🤝 EVERYONE LOSES'; badgeClass = 'meh'; pool = LINES.final_tie; }
    else if (diff >= sc.blowout) { badge = '⚰️ FUNERAL'; badgeClass = 'blowout'; pool = LINES.final_blowout; }
    else if (diff <= sc.close) { badge = '😮‍💨 SURVIVED'; badgeClass = 'close'; pool = LINES.final_close; }
    else if (total <= sc.low) { badge = '😴 SNOOZEFEST'; badgeClass = 'meh'; pool = LINES.snooze; }
    else if (total >= sc.high) { badge = '🎆 FIREWORKS'; badgeClass = 'fire'; pool = LINES.fireworks; }
    else { badge = '✅ IN THE BOOKS'; badgeClass = 'done'; pool = LINES.final_normal; }
  } else {
    if (diff === 0) { badge = '⚖️ DEAD EVEN'; badgeClass = 'close'; pool = LINES.tied_in; }
    else if (diff >= sc.blowout) { badge = '💀 BLOWOUT'; badgeClass = 'blowout'; pool = LINES.blowout; }
    else if (diff <= sc.close && lateness >= 0.75) { badge = '🔥 NAIL-BITER'; badgeClass = 'fire'; pool = LINES.nailbiter; }
    else if (diff <= sc.close) { badge = '🍿 GRAB POPCORN'; badgeClass = 'close'; pool = LINES.close; }
    else { badge = '📺 LIVE'; badgeClass = 'live'; pool = LINES.normal_in; }
  }
  return { badge, badgeClass, line: fill(pick(r, pool), v), chaos };
}

// Commentary from our unpaid intern, built from the stat leaders.
const LEADER_LINES = [
  "{player} put up {line}. Somebody check their pockets for a cheat code.",
  "{player}: {line}. The intern is now emotionally attached.",
  "{player} with {line}. That's a \"call your mom after the game\" performance.",
  "{player} posted {line} and is now legally allowed to talk trash for a week.",
  "{line} from {player}. Statistically, that's what the nerds call \"a lot.\"",
  "{player} ({line}) is playing like the controller is plugged in.",
];

// "1" alone means nothing; "1 goal" does.
function statLine(c) {
  const line = String(c.line || '').trim();
  if (!/^\d+(\.\d+)?$/.test(line)) return line;
  let cat = String(c.cat || '').replace(/ Leader$/i, '').toLowerCase();
  if (line === '1') cat = cat.replace(/s$/, '');
  return `${line} ${cat}`;
}

function commentary(sum) {
  const out = [];
  const g = sum.game;
  const r = rng(`c:${g.id}:${g.status.state}`);
  const v = vibe(g);
  out.push(v.line);
  const seen = new Set();
  for (const t of sum.leaders) {
    for (const c of t.cats.slice(0, 2)) {
      if (!c.player || seen.has(c.player) || g.status.state === 'pre') continue;
      seen.add(c.player);
      out.push(fill(pick(r, LEADER_LINES), { player: c.player, line: statLine(c) })
        .replace(/(?<!\.)\.\.(?!\.)/g, '.'));
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  if (g.status.state === 'pre') {
    out.push(fill(pick(r, LINES.pre), { home: g.home?.name, away: g.away?.name, homeLoc: g.home?.location || g.home?.name }));
    if (sum.odds) out.push(`Vegas says ${sum.odds}. Vegas also built a giant sphere, so take that how you want.`);
  }
  return [...new Set(out)];
}

function excuse(seed) {
  return pick(rng(seed), EXCUSES);
}

module.exports = { vibe, commentary, excuse, EXCUSES };
