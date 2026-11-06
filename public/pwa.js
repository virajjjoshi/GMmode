/* Installable app: register the service worker and offer "Install the app"
   where the browser supports it. Nothing here is required for the site to work. */
(() => {
  // Off on localhost so code edits show up on refresh; add ?sw=1 to test it locally.
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !local) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // A new deploy is waiting: take it on the next navigation, not mid-game.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          sw && sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) window.__ttlUpdateReady = true;
          });
        });
      }).catch(() => { /* private mode etc. */ });
    });
    window.addEventListener('hashchange', () => {
      if (window.__ttlUpdateReady && !/^#\/live\//.test(location.hash)) { window.__ttlUpdateReady = false; location.reload(); }
    });
  }

  let deferred = null;
  const btn = document.getElementById('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferred = e;
    if (btn) btn.hidden = false;
  });
  btn && btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* dismissed */ }
    deferred = null; btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { if (btn) btn.hidden = true; });
})();
