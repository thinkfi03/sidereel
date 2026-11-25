// Drives a Chromium browser (Edge / Chrome / Chromium) app window over the DevTools protocol:
// injects the scroll fix, reports playback for stats, and pauses video for the boss key.
// On Windows it also runs a PowerShell helper that keeps the window on top and hides/shows it.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');
const { SCROLL_JS, STATUS_JS, PAUSE_JS } = require('./pagescripts');

const TICK_MS = 5000; // must match stats.js TICK_SECONDS

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPort(profileDir, proc, timeoutMs = 15000) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const end = Date.now() + timeoutMs;
  while (Date.now() < end && proc.exitCode === null) {
    try {
      const port = parseInt(fs.readFileSync(file, 'utf8').split('\n')[0], 10);
      if (port > 0) return port;
    } catch {}
    await sleep(200);
  }
  return null;
}

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      const p = msg.id && this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    };
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = () => reject(new Error('DevTools connection failed'));
    });
  }
  send(method, params = {}) {
    if (this.ws.readyState !== 1) return Promise.reject(new Error('closed'));
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return r && r.result ? r.result.value : undefined;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

/**
 * Starts the Chromium bridge for an already-spawned browser process.
 * hooks: { onTick(playing, key), onVisible(bool), log(msg) }
 * opts:  { profileDir, width, height, x, y }
 */
function attach(proc, opts, hooks) {
  let page = null;
  let timer = null;
  let win = null; // Windows window helper
  let visible = true;
  let stopped = false;

  (async () => {
    if (typeof WebSocket === 'undefined') return hooks.log('This VS Code has no WebSocket support; stats and scroll fix disabled.');
    const port = await waitForPort(opts.profileDir, proc);
    if (!port || stopped) return hooks.log('DevTools port not found; stats and scroll fix disabled.');
    let target = null;
    for (let i = 0; i < 50 && !target && !stopped; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch {}
      if (!target) await sleep(200);
    }
    if (!target || stopped) return hooks.log('No page target found.');
    page = new CdpPage(target.webSocketDebuggerUrl);
    await page.ready;
    await page.send('Page.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: SCROLL_JS });
    await page.eval(SCROLL_JS);
    timer = setInterval(async () => {
      if (!visible) return hooks.onTick(false, '-');
      try {
        const r = String((await page.eval(STATUS_JS)) || '0|');
        const [playing, key] = r.split('|');
        hooks.onTick(playing === '1', key || '-');
      } catch {}
    }, TICK_MS);
  })().catch((e) => hooks.log('DevTools: ' + e.message));

  if (process.platform === 'win32') {
    const script = path.join(__dirname, 'win', 'window.ps1');
    win = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      String(proc.pid), String(opts.width), String(opts.height), String(opts.x), String(opts.y),
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    win.on('error', (e) => hooks.log('Window helper failed: ' + e.message));
    win.stdin.on('error', () => {});
    readline.createInterface({ input: win.stdout }).on('line', (line) => {
      const [kind, v] = line.trim().split(/\s+/);
      if (kind === 'visible') { visible = v === '1'; hooks.onVisible(visible); }
      else if (kind === 'nowindow') hooks.log('Window helper could not find the browser window.');
    });
  }

  return {
    canHide: process.platform === 'win32',
    async hide() {
      if (page) await page.eval(PAUSE_JS).catch(() => {});
      if (win && win.stdin.writable) win.stdin.write('hide\n');
    },
    show() {
      if (win && win.stdin.writable) win.stdin.write('show\n');
    },
    /** Evaluate an expression in the page (used for diagnostics). */
    evaluate(expr) {
      return page ? page.eval(expr) : Promise.resolve(undefined);
    },
    async pause() {
      if (page) await page.eval(PAUSE_JS).catch(() => {});
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      if (page) page.close();
      if (win) { try { win.stdin.end(); win.kill(); } catch {} }
    },
  };
}

module.exports = { attach };
