/* TABLE21 boot fallback (classic script, same origin, allowed by the CSP). If the app has not replaced the splash
   within 12 s (no network, a blocked file), say so in one line and offer a retry. It never shows fake progress. */
(function () {
  var t = setTimeout(function () {
    var s = document.querySelector('.splash');
    if (!s) return;
    s.classList.add('failed');
    var st = document.getElementById('splash-status');
    var he = (document.documentElement.lang || 'he') === 'he';
    if (st) st.textContent = he ? 'הטעינה לוקחת יותר מהרגיל. בדקו את החיבור ונסו שוב.' : 'Loading is taking longer than usual. Check the connection and try again.';
    var b = document.getElementById('splash-retry');
    if (b) {
      if (!he) b.textContent = 'Try again';
      b.onclick = function () { location.reload(); };
    }
  }, 12000);
  new MutationObserver(function (_m, obs) {
    if (!document.querySelector('.splash')) { clearTimeout(t); obs.disconnect(); }
  }).observe(document.getElementById('root'), { childList: true });
})();
