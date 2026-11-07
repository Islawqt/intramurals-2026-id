// Loads the newest version without clearing cache: if version.json is newer than this page,
// reload once with ?v=<new> (a new URL, so the browser can't serve the old copy).
(function () {
  const meta = document.querySelector('meta[name="app-version"]');
  if (!meta) return;
  const resume = document.currentScript && document.currentScript.hasAttribute('data-resume');
  function check() {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        if (!j.v || j.v === meta.content) return;
        const u = new URL(location.href);
        if (u.searchParams.get('v') === j.v) return;      // already tried this version: don't loop
        u.searchParams.set('v', j.v);
        location.replace(u.toString());
      })
      .catch(() => {});
  }
  check();
  // Installed apps stay open for hours: check again whenever the app comes back to the screen
  if (resume) document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
