const vscode = require('vscode');
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const os = require('os');
const path = require('path');
const fs = require('fs');
const stats = require('./stats');
const wrapped = require('./wrapped');
const chromium = require('./chromium');

const PROFILE_DIR = path.join(os.homedir(), '.sidereel-profile');
const NATIVE_BIN = path.join(__dirname, 'native', 'Sidereel.app', 'Contents', 'MacOS', 'Sidereel');
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

let proc = null; // running sidecar process
let isNative = false; // native floating window (supports boss key + stats)
let visible = false;
let statusItem = null;
let bridge = null; // Chromium DevTools bridge (non-native window)
let output = null;

function chromePath(cfg) {
  if (cfg.get('browserPath')) return cfg.get('browserPath');
  const local = process.env.LOCALAPPDATA || '';
  const candidates = {
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ],
    win32: [
      // Edge ships with every Windows install, so try it first.
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    linux: ['/usr/bin/google-chrome', '/usr/bin/microsoft-edge', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function screenWidth() {
  if (process.platform !== 'darwin') return 1440;
  try {
    const out = execSync(`osascript -e 'tell application "Finder" to get bounds of window of desktop'`, {
      encoding: 'utf8',
      timeout: 2000,
    });
    const w = parseInt(out.split(',')[2], 10);
    return Number.isFinite(w) ? w : 1440;
  } catch {
    return 1440;
  }
}

function updateStatus() {
  if (!statusItem) return;
  if (!proc) {
    statusItem.text = '$(play) Sidereel';
    statusItem.tooltip = 'Open Sidereel (Cmd+Alt+R)';
  } else if (!visible) {
    statusItem.text = '$(eye-closed) Sidereel';
    statusItem.tooltip = 'Sidereel hidden (boss key). Ctrl+Cmd+B to bring it back, Cmd+Alt+R to close.';
  } else {
    statusItem.text = '$(debug-stop) Sidereel';
    statusItem.tooltip = 'Close Sidereel (Cmd+Alt+R) · Boss key: Ctrl+Cmd+B';
  }
}

function send(cmd) {
  if (proc && isNative && proc.stdin.writable) proc.stdin.write(cmd + '\n');
}

function track(p, native) {
  proc = p;
  isNative = native;
  visible = true;
  p.on('error', (err) => {
    vscode.window.showErrorMessage(`Sidereel: failed to launch: ${err.message}`);
  });
  p.on('exit', () => {
    if (proc === p) {
      if (bridge) { bridge.stop(); bridge = null; }
      proc = null;
      isNative = false;
      visible = false;
      updateStatus();
    }
  });
  if (native) {
    p.stdin.on('error', () => {}); // ignore EPIPE if the window was closed
    readline.createInterface({ input: p.stdout }).on('line', (line) => {
      const [kind, a, b] = line.trim().split(/\s+/);
      if (kind === 'visible') {
        visible = a === '1';
        updateStatus();
      } else if (kind === 'tick') {
        stats.onTick(a === '1', b);
      }
    });
  }
  updateStatus();
}

// Files unpacked from a .vsix can lose the executable bit or carry a quarantine flag.
function prepareNativeApp() {
  try { fs.chmodSync(NATIVE_BIN, 0o755); } catch {}
  try {
    execSync(`xattr -dr com.apple.quarantine "${path.join(__dirname, 'native', 'Sidereel.app')}"`, { timeout: 3000 });
  } catch {}
}

function open() {
  if (proc) return;
  const cfg = vscode.workspace.getConfiguration('sidereel');

  // macOS: native floating window (always on top, boss key, stats).
  if (process.platform === 'darwin' && cfg.get('alwaysOnTop') && fs.existsSync(NATIVE_BIN)) {
    prepareNativeApp();
    const args = [
      cfg.get('url'),
      String(cfg.get('width')),
      String(cfg.get('height')),
      String(cfg.get('x')),
      String(cfg.get('y')),
      cfg.get('mobileLayout') ? '1' : '0',
      '1', // managed: talk to us over stdin/stdout
    ];
    track(spawn(NATIVE_BIN, args, { stdio: ['pipe', 'pipe', 'ignore'] }), true);
    return;
  }

  // Chromium app window (Edge / Chrome): Windows, Linux, or macOS with alwaysOnTop off.
  // Stats + scroll fix over DevTools; on Windows also always-on-top + boss-key hide.
  const bin = chromePath(cfg);
  if (!bin) {
    vscode.window.showErrorMessage('Sidereel: no Edge or Chrome found. Set "sidereel.browserPath".');
    return;
  }
  const width = cfg.get('width');
  const height = cfg.get('height');
  const x = cfg.get('x') >= 0 ? cfg.get('x') : Math.max(0, screenWidth() - width);
  // One profile per browser (Edge and Chrome can't share), so each keeps its own login.
  const profileDir = `${PROFILE_DIR}-${path.basename(bin).replace(/\.exe$/i, '').replace(/\s+/g, '-').toLowerCase()}`;
  try { fs.unlinkSync(path.join(profileDir, 'DevToolsActivePort')); } catch {}
  const args = [
    `--app=${cfg.get('url')}`,
    `--window-size=${width},${height}`,
    `--window-position=${x},${cfg.get('y')}`,
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0', // random free port, written to <profile>/DevToolsActivePort
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (cfg.get('mobileLayout')) args.push(`--user-agent=${IPHONE_UA}`);
  const p = spawn(bin, args, { stdio: 'ignore' });
  track(p, false);
  bridge = chromium.attach(p, { profileDir, width, height, x: cfg.get('x'), y: cfg.get('y') }, {
    onTick: stats.onTick,
    onVisible: (v) => { visible = v; updateStatus(); },
    log: (m) => output.appendLine(m),
  });
}

function close() {
  if (!proc) return;
  if (isNative) {
    send('quit'); // graceful: WebKit flushes cookies so you stay logged in
    const p = proc;
    setTimeout(() => p.exitCode === null && p.kill(), 3000);
  } else {
    if (bridge) { bridge.stop(); bridge = null; }
    proc.kill();
  }
}

function bossKey() {
  if (!proc) return;
  if (isNative) send(visible ? 'hide' : 'show');
  else if (bridge && bridge.canHide) visible ? bridge.hide() : bridge.show(); // Windows
  else close(); // macOS/Linux browser window can't be hidden from outside; close it instead
}

function activate(context) {
  output = vscode.window.createOutputChannel('Sidereel');
  context.subscriptions.push(output);
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'sidereel.toggle';
  updateStatus();
  statusItem.show();

  stats.activate(context);

  context.subscriptions.push(
    statusItem,
    vscode.commands.registerCommand('sidereel.open', open),
    vscode.commands.registerCommand('sidereel.close', close),
    vscode.commands.registerCommand('sidereel.toggle', () => (proc ? close() : open())),
    vscode.commands.registerCommand('sidereel.bossKey', bossKey),
    vscode.commands.registerCommand('sidereel.wrapped', wrapped.show)
  );
}

function deactivate() {
  close();
}

module.exports = { activate, deactivate };
