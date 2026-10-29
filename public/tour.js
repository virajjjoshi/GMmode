/* Tour: a guided "what we've built" page, powered by real data.
   Loaded before app.js; uses its helpers at call time. */
'use strict';

async function renderTour() {
  const app = $('#app');
  app.innerHTML = `
    <section class="tour-hero">
      <div class="tour-kicker">v0.3 · built ${esc(new Date().toLocaleDateString([], { month: 'long', year: 'numeric' }))}</div>
      <h1 class="tour-title">THE SECOND SCREEN<br>FOR <span class="hl">SPORTS FANS</span></h1>
      <p class="tour-sub">Keep the game on your TV. Trash Talk Live is the couch: live scores with a funny take on every game, Twitch-style live rooms, fantasy wired in, and prediction games for bragging rights.</p>
      <div class="stats tour-stats">
        <div class="stat hot"><b data-t="live">0</b><span>games live now</span></div>
        <div class="stat"><b data-t="games">0</b><span>games today</span></div>
        <div class="stat"><b data-t="leagues">10</b><span>leagues covered</span></div>
        <div class="stat"><b data-t="takes">0</b><span>takes posted</span></div>
        <div class="stat"><b data-t="lines">0</b><span>jokes on the board</span></div>
      </div>
      <div class="spot-cta tour-cta" id="tourCta"><a class="btn primary" href="#/">Open the scoreboard</a></div>
    </section>

    <h2 class="tour-h2">What's working today</h2>
    <div class="tour-grid">
      <article class="tour-card" style="--tc:var(--accent)">
        <div class="tc-ico">🏟️</div><h3>Scoreboard of Chaos</h3>
        <p>Live scores across 10 leagues. Every game gets a vibe badge and a chaos meter that reads the score, the clock, and the standings.</p>
        <div class="tc-demo" id="tdScores"></div>
        <a class="tc-link" href="#/">See every game →</a>
      </article>
      <article class="tour-card" style="--tc:var(--orange)">
        <div class="tc-ico">🎙️</div><h3>The Humor Engine</h3>
        <p>An "unpaid intern" writes a joke for every game state: nail-biters, blowouts, upsets, overtime. These are live, from tonight's games:</p>
        <div class="tc-demo tc-quote" id="tdJokes"><span class="typing"></span></div>
        <a class="tc-link" href="#/?sort=chaos">Most chaotic games →</a>
      </article>
      <article class="tour-card" style="--tc:var(--hot)">
        <div class="tc-ico">🔴</div><h3>Live Rooms</h3>
        <p>A Twitch-style room for every game: a live field drawn for each sport (the football chains move, basketball shot charts, a baseball diamond with runners), tappable play-by-play, a Hype Battle tug-of-war, quick polls like "4th down: go for it?", and big moments like TIP-OFF and RED ZONE.</p>
        <div class="tc-demo" id="tdLive"></div>
        <a class="tc-link" id="tdLiveLink" href="#/live">Open the live rooms →</a>
      </article>
      <article class="tour-card" style="--tc:var(--purple)">
        <div class="tc-ico">🔮</div><h3>The Call &amp; Polls</h3>
        <p>"Who scores next?" calls in every live room, and a "Who Ya Got?" poll on every game. Points for being right, extra for beating the crowd.</p>
        <div class="tc-demo tc-rules">
          <div><b>+10</b><span>for a right call</span></div>
          <div><b>+0–10</b><span>crowd bonus: the fewer who called it, the more you get</span></div>
          <div><b>45s</b><span>anti-snipe lock, so no calling it after you see it on TV</span></div>
        </div>
        <a class="tc-link" href="#/hall">Prophet leaderboard →</a>
      </article>
      <article class="tour-card" style="--tc:var(--good)">
        <div class="tc-ico">🧑‍🌾</div><h3>Fantasy, Connected</h3>
        <p>Plug in a Sleeper username to get your live matchup, the Fantasy Therapist, bench regret, standings and a league trash-talk thread. Your players are flagged on every game card.</p>
        <div class="tc-demo" id="tdFantasy"></div>
        <a class="tc-link" href="#/fantasy">Connect a league →</a>
      </article>
      <article class="tour-card" style="--tc:var(--cool)">
        <div class="tc-ico">💬</div><h3>Threads &amp; Hall of Takes</h3>
        <p>Every game has its own forum. Rate your take Mild, Spicy or ☢️ Nuclear, and the crowd votes 🔥 fire or 🧢 cap. The best and worst land in the Hall of Takes.</p>
        <div class="tc-demo" id="tdTakes"></div>
        <a class="tc-link" href="#/hall">Hall of Takes →</a>
      </article>
    </div>

    <h2 class="tour-h2">Under the hood</h2>
    <div class="tour-tech">
      ${[
        ['⚡', 'Zero dependencies', 'Plain Node and vanilla JS. No build step, starts in under a second.'],
        ['📡', 'Live data, cached smart', 'ESPN\'s live feed, served stale-while-revalidate so a slow upstream never freezes the page.'],
        ['🔁', 'Real-time rooms', 'Server-Sent Events push chat, reactions and scores. The server only polls a game while someone is watching it.'],
        ['🛡️', 'Safe by default', 'Rate limits, slow mode, profanity softening, input validation, and all user text escaped (no XSS).'],
        ['📱', 'Works on phones', 'Responsive down to phone width, and tested by driving real Chrome on desktop and mobile.'],
        ['🧪', 'Demo crowd', 'One click fills a room with clearly labelled simulated fans, to show how it feels at scale.'],
      ].map(([i, t, d]) => `<div class="tech"><span>${i}</span><div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    </div>

    <h2 class="tour-h2">Where it's going</h2>
    <ol class="timeline">
      <li class="done"><b>v0.1 · Scores + Community</b><span>10 leagues, vibe badges, chaos meter, threads, polls, reactions, Hall of Takes</span></li>
      <li class="done"><b>v0.2 · Live + Fantasy</b><span>Live Rooms, The Call, intern bot, Sleeper fantasy, demo crowd</span></li>
      <li class="done now"><b>v0.3 · The Live Field</b> <em>you are here</em><span>A field for every sport, tappable play-by-play, sport-specific moments, crowd polls, Hype Battle</span></li>
      <li><b>Phase 2 · Launch-ready</b><span>Real accounts (Clerk), Postgres, moderation tools, hosting + domain, licensed data feed, terms &amp; privacy</span></li>
      <li><b>Phase 3 · Growth</b><span>Mobile app + push alerts, private league rooms, creator co-streams, Claude-written roasts, ESPN + Yahoo fantasy</span></li>
    </ol>

    <section class="panel tour-decide">
      <h3>🧭 Decisions for us</h3>
      <ol>
        <li><b>Name:</b> "Trash Talk Live" or "GMmode"?</li>
        <li><b>Next build:</b> real accounts first (recommended) or more fantasy platforms?</li>
        <li><b>Platform:</b> web/PWA first (recommended) or straight to mobile?</li>
        <li><b>Betting:</b> stay free-to-play (recommended) until legal is sorted?</li>
      </ol>
    </section>`;

  const set = (k, v) => { const b = $(`[data-t="${k}"]`); if (!b) return; b.parentElement.hidden = !v; countUp(b, v); };
  let games = [], hall = null;
  try { [{ games }, hall] = await Promise.all([api(`/scoreboard?league=all&date=${ymd(new Date())}`), api('/hall')]); } catch { /* keep static */ }
  if (!$('.tour-hero')) return; // navigated away
  const live = games.filter((g) => g.status.state === 'in');
  set('live', live.length); set('games', games.length); set('leagues', new Set(games.map((g) => g.league)).size || 10);
  set('takes', hall?.totals.takes || 0); set('lines', new Set(games.map((g) => g.vibe.line)).size);

  // Scoreboard preview: three most chaotic games.
  const top = [...games].filter((g) => g.home && g.away).sort((a, b) => (b.status.state === 'in') - (a.status.state === 'in') || b.vibe.chaos - a.vibe.chaos).slice(0, 3);
  $('#tdScores').innerHTML = top.length ? top.map((g) => `<a class="mini" href="#/game/${esc(g.league)}/${esc(g.id)}">
      <span class="mini-t">${logo(g.away)}${esc(g.away.abbr)} <b>${g.status.state === 'pre' ? '' : esc(g.away.score ?? 0)}</b></span>
      <span class="mini-t">${logo(g.home)}${esc(g.home.abbr)} <b>${g.status.state === 'pre' ? '' : esc(g.home.score ?? 0)}</b></span>
      <span class="badge ${esc(g.vibe.badgeClass)}">${esc(g.vibe.badge)}</span></a>`).join('') : '<p class="muted">No games on today. The scoreboard is resting.</p>';

  // Joke ticker: types out real lines from tonight's games.
  const lines = [...new Set(games.map((g) => g.vibe.line))].sort(() => Math.random() - 0.5).slice(0, 8);
  typeLines($('#tdJokes .typing'), lines.length ? lines : ['No games tonight. The intern is on break, and so are the jokes.']);

  // Live rooms preview.
  const hot = [...live].sort((a, b) => b.vibe.chaos - a.vibe.chaos)[0];
  $('#tdLive').innerHTML = hot
    ? `<div class="mini-stage" style="--away-c:${sideColors(hot).a};--home-c:${sideColors(hot).h}"><span class="live-pill"><span class="dot"></span>LIVE</span>
        <div>${logo(hot.away)}<b>${esc(hot.away.score ?? 0)}</b><i>–</i><b>${esc(hot.home.score ?? 0)}</b>${logo(hot.home)}</div><small>${esc(hot.status.short)} · ${live.length} room${live.length > 1 ? 's' : ''} open</small></div>`
    : '<p class="muted">No games live right now. Rooms open automatically at kickoff.</p>';
  if (hot) {
    $('#tdLiveLink').href = `#/live/${hot.league}/${hot.id}`; $('#tdLiveLink').textContent = 'Jump into the hottest room →';
    $('#tourCta').insertAdjacentHTML('beforeend', `<a class="btn ghost" href="#/live/${esc(hot.league)}/${esc(hot.id)}">🔴 Hottest live room: ${esc(hot.away.abbr)} @ ${esc(hot.home.abbr)}</a>`);
  }

  // Fantasy preview.
  const f = fantasyLink();
  $('#tdFantasy').innerHTML = f?.leagueId
    ? `<div class="mini-fz">✅ Connected: <b>${esc(f.leagueName)}</b> as ${esc(f.userName)}</div>`
    : '<div class="mini-fz">🌙 Sleeper: live · ESPN: next · Yahoo: next</div>';

  // Takes preview.
  const t = hall?.topTakes?.[0];
  $('#tdTakes').innerHTML = t
    ? `<div class="mini-take"><span>${esc(t.avatar || '🙂')}</span><div><b>${esc(t.name)}</b> <small class="muted">on ${esc(t.gameLabel)}</small><p>"${esc(t.text.slice(0, 120))}"</p><small>🔥 ${t.fire} · 🧢 ${t.cap}</small></div></div>`
    : '<p class="muted">No takes yet. Be the first legend.</p>';
}

function typeLines(el, lines) {
  if (!el) return;
  let li = 0, ci = 0, del = false;
  const tick = () => {
    if (!el.isConnected) return;
    const line = lines[li % lines.length];
    if (reduceMotion) { el.textContent = line; li++; return setTimeout(tick, 4000); }
    if (!del) { ci++; el.textContent = line.slice(0, ci); if (ci >= line.length) { del = true; return setTimeout(tick, 2600); } }
    else { ci -= 3; el.textContent = line.slice(0, Math.max(0, ci)); if (ci <= 0) { del = false; li++; ci = 0; } }
    setTimeout(tick, del ? 12 : 26);
  };
  tick();
}
