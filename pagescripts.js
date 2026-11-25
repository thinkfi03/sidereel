// Scripts injected into the Reels page when running in a Chromium browser (Windows/Linux, or
// macOS with alwaysOnTop off). Keep in sync with the equivalents in native/Sidereel.m.

// On Reels pages: one wheel/trackpad flick = next/prev reel; also Down/Up and j/k keys.
const SCROLL_JS = `(function(){
  if (window.__sidereelScroll) return; window.__sidereelScroll = true;
  const onReels = () => /^\\/reels?\\//.test(location.pathname);
  function scroller() {
    let best = null, ba = 0;
    for (const el of document.querySelectorAll('div,main,section')) {
      if (el.clientHeight < 200 || el.scrollHeight <= el.clientHeight + 50) continue;
      if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      const a = el.clientHeight * el.clientWidth; if (a > ba) { ba = a; best = el; }
    }
    return best || document.scrollingElement;
  }
  let last = 0;
  function go(d) { const t = Date.now(); if (t - last < 500) return; last = t;
    const s = scroller(); s.scrollBy({ top: d * s.clientHeight, behavior: 'smooth' }); }
  const editing = () => { const a = document.activeElement;
    return a && (/INPUT|TEXTAREA/.test(a.tagName) || a.isContentEditable); };
  window.addEventListener('wheel', e => { if (!onReels() || editing()) return;
    if (e.target.closest && e.target.closest('[role=dialog]')) return;
    e.preventDefault(); if (Math.abs(e.deltaY) >= 4) go(e.deltaY > 0 ? 1 : -1); }, { passive: false, capture: true });
  window.addEventListener('keydown', e => { if (!onReels() || editing()) return;
    if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); go(-1); } }, true);
})();`;

// Returns "<playing 0|1>|<key>" where key identifies the current reel.
const STATUS_JS = `(function(){
  const p = [...document.querySelectorAll('video')].find(v => !v.paused && !v.ended && v.readyState > 2);
  const m = location.pathname.match(/^\\/reels?\\/([^\\/?#]+)/);
  const key = m ? m[1] : (p ? (p.currentSrc || '').slice(-48) : '');
  return (p ? '1' : '0') + '|' + key.replace(/\\s/g, '');
})()`;

const PAUSE_JS = `document.querySelectorAll('video').forEach(v => v.pause());`;

module.exports = { SCROLL_JS, STATUS_JS, PAUSE_JS };
