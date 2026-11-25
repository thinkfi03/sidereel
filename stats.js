// Watch stats: reel watch time, reels watched, and lines of code, per local day.
const vscode = require('vscode');

const TICK_SECONDS = 5; // must match TICK_SECONDS in native/Sidereel.m
const MAX_LINES_PER_CHANGE = 50; // big pastes / generated code don't count fully
const KEY_PREFIX = 'sidereel.day.';

let ctx = null;
let statusItem = null;
let seen = { day: '', keys: new Set() };

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function getDay(k) {
  return { reelSec: 0, reels: 0, lines: 0, ...(ctx.globalState.get(KEY_PREFIX + k) || {}) };
}

function bump(field, amount) {
  const k = dayKey();
  const d = getDay(k);
  d[field] += amount;
  ctx.globalState.update(KEY_PREFIX + k, d);
  render();
}

function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function render() {
  if (!statusItem) return;
  const d = getDay(dayKey());
  statusItem.text = `$(pulse) ${fmtTime(d.reelSec)} watched · ${d.lines.toLocaleString()} LoC`;
  statusItem.tooltip = `Today: ${d.reels} reels watched, ${fmtTime(d.reelSec)} of scrolling, ${d.lines} lines of code.\nClick for your Weekly Ledger.`;
}

/** Called for each "tick <playing> <key>" line from the native window. */
function onTick(playing, key) {
  if (!playing) return;
  bump('reelSec', TICK_SECONDS);
  const today = dayKey();
  if (seen.day !== today) seen = { day: today, keys: new Set() };
  if (key && key !== '-' && !seen.keys.has(key)) {
    seen.keys.add(key);
    bump('reels', 1);
  }
}

function onTextChange(e) {
  const scheme = e.document.uri.scheme;
  if (scheme !== 'file' && scheme !== 'untitled') return;
  if (e.reason) return; // undo / redo
  let n = 0;
  for (const c of e.contentChanges) {
    const added = (c.text.match(/\n/g) || []).length;
    const removed = c.range.end.line - c.range.start.line;
    if (added > removed) n += Math.min(added - removed, MAX_LINES_PER_CHANGE);
  }
  if (n) bump('lines', n);
}

/** Last `n` days, oldest first. */
function lastDays(n = 7) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ date: dayKey(d), ...getDay(dayKey(d)) });
  }
  return out;
}

function activate(context) {
  ctx = context;
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  statusItem.command = 'sidereel.wrapped';
  render();
  statusItem.show();
  context.subscriptions.push(statusItem, vscode.workspace.onDidChangeTextDocument(onTextChange));
  // Roll the counter over at midnight.
  const t = setInterval(render, 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(t) });
}

module.exports = { activate, onTick, lastDays, fmtTime };
