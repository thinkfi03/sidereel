// Weekly Ledger: shareable card (1200x675, exported at 2x, X/Twitter-card size).
const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('./stats');

const BRAND = 'Sidereel';
const MEDIA = path.join(__dirname, 'media');

function rankFor(reelMin, lines) {
  // Minutes of reels per 100 lines of code.
  const ratio = reelMin / Math.max(1, lines / 100);
  if (reelMin < 5) return { title: 'The Ascetic', line: 'Barely looked up. Barely blinked.' };
  if (ratio < 1) return { title: 'The Craftsman', line: 'Wrote far more than you watched.' };
  if (ratio < 3) return { title: 'The Equilibrist', line: 'Equal parts work and wander.' };
  if (ratio < 8) return { title: 'The Flâneur', line: 'Wandered often. Shipped anyway.' };
  return { title: 'The Devotee', line: 'Devoted to the scroll. The code can wait.' };
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

function summarize() {
  const days = stats.lastDays(7);
  const reelSec = days.reduce((a, d) => a + d.reelSec, 0);
  const lines = days.reduce((a, d) => a + d.lines, 0);
  const reels = days.reduce((a, d) => a + d.reels, 0);
  const reelMin = reelSec / 60;
  const peak = days.reduce((a, d) => (d.reelSec > a.reelSec ? d : a), days[0]);
  return {
    brand: BRAND,
    days,
    reelSec,
    lines,
    reels,
    rank: rankFor(reelMin, lines),
    ratio: (reelMin / Math.max(1, lines / 100)).toFixed(1),
    week: isoWeek(days[6].date),
    peak: peak.reelSec > 0 ? peak.date : null,
  };
}

function fmtHM(sec) {
  const m = Math.round(sec / 60);
  return { h: Math.floor(m / 60), m: m % 60 };
}

function tweetText(s) {
  const { h, m } = fmtHM(s.reelSec);
  const time = h ? `${h}h ${m}m` : `${m}m`;
  return `Week ${s.week}, by ${s.brand}: ${time} watched, ${s.lines.toLocaleString('en-US')} lines written. ${s.rank.title}.`;
}

function html(webview, s) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const font = (f) => webview.asWebviewUri(vscode.Uri.file(path.join(MEDIA, 'fonts', f))).toString();
  const data = JSON.stringify({ ...s, hm: fmtHM(s.reelSec) }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; img-src data:; font-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  @font-face { font-family: 'Instrument Serif'; font-style: normal; font-weight: 400; src: url('${font('InstrumentSerif-400.woff2')}') format('woff2'); }
  @font-face { font-family: 'Instrument Serif'; font-style: italic; font-weight: 400; src: url('${font('InstrumentSerif-400-italic.woff2')}') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 400; src: url('${font('IBMPlexMono-400.woff2')}') format('woff2'); }
  @font-face { font-family: 'IBM Plex Mono'; font-style: normal; font-weight: 500; src: url('${font('IBMPlexMono-500.woff2')}') format('woff2'); }
  body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: var(--vscode-foreground); }
  canvas { width: 100%; max-width: 960px; display: block; border-radius: 3px;
    box-shadow: 0 1px 2px rgba(0,0,0,.25), 0 18px 50px rgba(0,0,0,.35); }
  .row { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
  button { font: inherit; padding: 8px 16px; min-height: 36px; border-radius: 3px; border: 0; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
  p.hint { opacity: .6; font-size: 12px; }
</style></head>
<body>
<canvas id="c" width="2400" height="1350" role="img" aria-label="Weekly Ledger card"></canvas>
<div class="row">
  <button id="save">Save PNG</button>
  <button id="post" class="secondary">Post on X</button>
  <button id="copy" class="secondary">Copy caption</button>
</div>
<p class="hint">Post on X opens a pre-filled post. Attach the saved PNG there.</p>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const s = ${data};
const c = document.getElementById('c'), g = c.getContext('2d');
const W = 1200, H = 675, L = 76;
const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';
const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const T = {
  bg: '#100F0D', bg2: '#1B1915',
  ink: '#EEE7D7', dim: 'rgba(238,231,215,.56)', faint: 'rgba(238,231,215,.16)', hair: 'rgba(238,231,215,.09)',
  accent: '#E2582F',
};

function txt(str, x, y, font, color, align = 'left', spacing = '0px') {
  g.font = font; g.fillStyle = color; g.textAlign = align; g.letterSpacing = spacing;
  g.fillText(str, x, y); const w = g.measureText(str).width; g.letterSpacing = '0px'; return w;
}
function line(x1, y1, x2, y2, color, w = 1) {
  g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
}
const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
const dmy = (d) => { const t = new Date(d + 'T12:00:00'); return t.getDate() + '.' + ROMAN[t.getMonth()]; };
const wk = (d, opt = 'short') => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: opt });

function draw() {
  g.setTransform(2, 0, 0, 2, 0, 0);

  // Ground: warm black, soft light from the upper left, fine grain.
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(260, 120, 0, 260, 120, 900);
  glow.addColorStop(0, T.bg2); glow.addColorStop(1, 'rgba(16,15,13,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = rnd() > .5 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.22)';
    g.fillRect(rnd() * W, rnd() * H, 1, 1);
  }

  // Passe-partout frame with corner registration ticks.
  g.strokeStyle = T.faint; g.lineWidth = 1; g.strokeRect(28.5, 28.5, W - 57, H - 57);
  [[28.5, 28.5], [W - 28.5, 28.5], [28.5, H - 28.5], [W - 28.5, H - 28.5]].forEach(([x, y]) => {
    line(x - 8, y, x + 8, y, T.dim); line(x, y - 8, x, y + 8, T.dim);
  });

  // Masthead
  const colR = 700;
  let x = L;
  x += txt('SIDEREEL', x, 82, '500 11px ' + MONO, T.ink, 'left', '3.5px');
  txt('THE WEEKLY LEDGER  /  No. ' + String(s.week).padStart(2, '0'), x + 22, 82, '400 11px ' + MONO, T.dim, 'left', '2.5px');
  txt(dmy(s.days[0].date) + ' — ' + dmy(s.days[6].date) + '.' + s.days[6].date.slice(0, 4),
    colR, 82, '400 11px ' + MONO, T.dim, 'right', '2px');
  line(L, 100.5, colR, 100.5, T.faint);

  // Hero figure: hours and minutes, units set in italic at a smaller size.
  x = L - 4; const base = 282;
  const big = '400 200px ' + SERIF, unit = 'italic 400 84px ' + SERIF;
  if (s.hm.h) { x += txt(String(s.hm.h), x, base, big, T.ink, 'left', '-6px'); x += txt('h', x + 4, base, unit, T.dim) + 26; }
  x += txt(String(s.hm.m), x, base, big, T.ink, 'left', '-6px'); txt('m', x + 4, base, unit, T.dim);

  // The sentence.
  txt('spent watching this week, set against', L, 338, '400 30px ' + SERIF, T.dim);
  x = L;
  x += txt(s.lines.toLocaleString('en-US'), x, 376, 'italic 400 30px ' + SERIF, T.accent);
  txt(' lines of code written.', x, 376, '400 30px ' + SERIF, T.dim);

  // Classification
  line(L, 424.5, colR, 424.5, T.hair);
  txt('CLASSIFICATION', L, 456, '400 10px ' + MONO, T.dim, 'left', '3px');
  txt(s.rank.title, L - 2, 514, 'italic 400 60px ' + SERIF, T.ink);
  txt(s.rank.line, L, 550, '400 21px ' + SERIF, T.dim);

  // Footer
  line(L, 590.5, W - L, 590.5, T.faint);
  const foot = [
    s.reels.toLocaleString('en-US') + ' REELS',
    s.ratio + ' MIN / 100 LINES',
    s.peak ? 'PEAK ' + wk(s.peak, 'long').toUpperCase() : 'NO PEAK',
  ].join('   ·   ');
  txt(foot, L, 618, '400 10px ' + MONO, T.dim, 'left', '2px');
  txt('SIDEREEL FOR VS CODE', W - L, 618, '400 10px ' + MONO, T.dim, 'right', '2px');

  // Sidereal dial: one spoke per day. Filled = minutes watched, hollow = lines written.
  const cx = 944, cy = 336, R = 170, r0 = 56;
  g.strokeStyle = T.faint; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = T.hair; g.beginPath(); g.arc(cx, cy, (R + r0) / 2, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = T.faint; g.beginPath(); g.arc(cx, cy, r0, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 168; i++) { // one tick per hour of the week
    const a = -Math.PI / 2 + i * Math.PI * 2 / 168, long = i % 24 === 0;
    const r1 = R + 4, r2 = R + (long ? 14 : 7);
    line(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), cx + r2 * Math.cos(a), cy + r2 * Math.sin(a), long ? T.dim : T.hair);
  }
  const maxR = Math.max(1, ...s.days.map(d => d.reelSec)), maxL = Math.max(1, ...s.days.map(d => d.lines));
  const pts = s.days.map((d, i) => {
    const a = -Math.PI / 2 + (i + 0.5) * Math.PI * 2 / 7;
    const rr = r0 + (R - r0 - 8) * d.reelSec / maxR, rl = r0 + (R - r0 - 8) * d.lines / maxL;
    return { a, d, rr, rl };
  });
  // Constellations
  const poly = (key, color, dash) => {
    g.setLineDash(dash); g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
    pts.forEach((p, i) => { const X = cx + p[key] * Math.cos(p.a), Y = cy + p[key] * Math.sin(p.a); i ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.closePath(); g.stroke(); g.setLineDash([]);
  };
  poly('rl', 'rgba(238,231,215,.30)', [2, 4]);
  poly('rr', 'rgba(226,88,47,.55)', []);
  pts.forEach((p) => {
    const ca = Math.cos(p.a), sa = Math.sin(p.a);
    line(cx + r0 * ca, cy + r0 * sa, cx + p.rr * ca, cy + p.rr * sa, 'rgba(226,88,47,.9)', 1.5);
    g.fillStyle = T.accent; g.beginPath(); g.arc(cx + p.rr * ca, cy + p.rr * sa, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = T.ink; g.lineWidth = 1.25; g.beginPath(); g.arc(cx + p.rl * ca, cy + p.rl * sa, 3.5, 0, Math.PI * 2); g.stroke();
    const lr = R + 32;
    g.textBaseline = 'middle';
    txt(wk(p.d.date).toUpperCase(), cx + lr * ca, cy + lr * sa, '400 9px ' + MONO, T.dim, 'center', '1.5px');
    g.textBaseline = 'alphabetic';
  });
  // Hub
  txt('WEEK', cx, cy - 10, '400 8px ' + MONO, T.dim, 'center', '2.5px');
  txt(String(s.week), cx, cy + 22, 'italic 400 34px ' + SERIF, T.ink, 'center');

  // Key, top right, on the masthead line
  const ky = 82, kx = W - L;
  const ww = txt('WRITTEN', kx, ky, '400 10px ' + MONO, T.dim, 'right', '2px');
  g.strokeStyle = T.ink; g.lineWidth = 1.25; g.beginPath(); g.arc(kx - ww - 10, ky - 3.5, 3.5, 0, Math.PI * 2); g.stroke();
  const wa = txt('WATCHED', kx - ww - 30, ky, '400 10px ' + MONO, T.dim, 'right', '2px');
  g.fillStyle = T.accent; g.beginPath(); g.arc(kx - ww - 30 - wa - 10, ky - 3.5, 3.5, 0, Math.PI * 2); g.fill();
}

Promise.all([
  document.fonts.load('200px "Instrument Serif"'),
  document.fonts.load('italic 84px "Instrument Serif"'),
  document.fonts.load('400 11px "IBM Plex Mono"'),
  document.fonts.load('500 11px "IBM Plex Mono"'),
]).catch(() => {}).then(() => { draw(); document.title = 'ready'; });

document.getElementById('save').onclick = () =>
  vscode.postMessage({ type: 'save', png: c.toDataURL('image/png').split(',')[1] });
document.getElementById('post').onclick = () => vscode.postMessage({ type: 'post' });
document.getElementById('copy').onclick = () => vscode.postMessage({ type: 'copy' });
</script></body></html>`;
}

function show() {
  const s = summarize();
  const panel = vscode.window.createWebviewPanel('sidereelLedger', 'Weekly Ledger', vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.file(MEDIA)],
  });
  panel.webview.html = html(panel.webview, s);
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'save') {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Desktop', `${BRAND.toLowerCase()}-week-${s.week}.png`)),
        filters: { Images: ['png'] },
      });
      if (!uri) return;
      fs.writeFileSync(uri.fsPath, Buffer.from(msg.png, 'base64'));
      await vscode.env.clipboard.writeText(uri.fsPath);
      vscode.window.showInformationMessage(`Saved ${path.basename(uri.fsPath)} (path copied).`);
    } else if (msg.type === 'post') {
      const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(tweetText(s));
      vscode.env.openExternal(vscode.Uri.parse(url, true));
    } else if (msg.type === 'copy') {
      await vscode.env.clipboard.writeText(tweetText(s));
      vscode.window.showInformationMessage('Caption copied.');
    }
  });
}

module.exports = { show, rankFor, summarize };
