// Installable app helper for the SSC Admin and SSC Scanner pages
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  const btn = document.getElementById('installBtn'), tip = document.getElementById('installTip');
  if (!btn || !tip) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;                                         // already opened as the app
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => {           // Android / desktop Chrome
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; tip.hidden = true; });
  // iPhone / iPad Safari has no install button: show how
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) tip.hidden = false;
})();
