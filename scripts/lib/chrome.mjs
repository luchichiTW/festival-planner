// Minimal headless-Chrome driver over the DevTools protocol — no packages, just the Chrome already installed.
// Used by scripts/icons.mjs (render icons) and tests/e2e.test.mjs (phone-width browser tests).
// Set CHROME_PATH if Chrome is somewhere else.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function chromePath() {
  const p = CANDIDATES.find((c) => fs.existsSync(c));
  if (!p) throw new Error('找不到 Chrome；設定 CHROME_PATH 指向 Chrome 執行檔');
  return p;
}

class Connection {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject, method } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }
}

export class Page {
  constructor(conn, sessionId, targetId) {
    this.conn = conn;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.events = [];
    conn.listeners.add((m) => { if (m.sessionId === sessionId) this.events.push(m); });
  }
  send(method, params) { return this.conn.send(method, params, this.sessionId); }
  // Resolves with the first event of this name that arrives after the call (or matches pred).
  waitFor(method, pred = () => true, ms = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.conn.listeners.delete(fn); reject(new Error(`timeout waiting for ${method}`)); }, ms);
      const fn = (m) => {
        if (m.sessionId === this.sessionId && m.method === method && pred(m.params)) {
          clearTimeout(t);
          this.conn.listeners.delete(fn);
          resolve(m.params);
        }
      };
      this.conn.listeners.add(fn);
    });
  }
  async goto(url, { waitUntil = 'Page.loadEventFired' } = {}) {
    const loaded = this.waitFor(waitUntil);
    const r = await this.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    await loaded;
  }
  async reload() {
    const loaded = this.waitFor('Page.loadEventFired');
    await this.send('Page.reload', { ignoreCache: false });
    await loaded;
  }
  // Evaluates an expression (or a function source with args) in the page and returns its JSON value.
  async eval(expr, ...args) {
    const expression = typeof expr === 'function' ? `(${expr})(...${JSON.stringify(args)})` : expr;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }
  async until(fn, { ms = 10000, every = 100, args = [] } = {}) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await this.eval(fn, ...args).catch((e) => e);
      if (last && !(last instanceof Error)) return last;
      await sleep(every);
    }
    throw new Error(`until: condition not met within ${ms} ms (${fn.toString().slice(0, 120)}) last=${last instanceof Error ? last.message : JSON.stringify(last)}`);
  }
  async screenshot(file, clip) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: !!clip });
    if (file) fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return Buffer.from(r.data, 'base64');
  }
  // Center of the first element matching the selector, in CSS pixels, scrolled onto the screen.
  // Re-checks after two frames: the page may still be scrolling itself (e.g. the board's scroll on startup).
  async center(selector) {
    await this.send('Page.bringToFront'); // input only reaches the front tab
    for (let i = 0; i < 4; i++) {
      const c = await this.eval(async (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        return { x, y, on: x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight };
      }, selector);
      if (!c) throw new Error(`no element ${selector}`);
      if (c.on) return { x: c.x, y: c.y };
    }
    throw new Error(`${selector} stays off screen`);
  }
  async tap(selector) {
    const { x, y } = await this.center(selector);
    if (process.env.FP_DEBUG) console.log('tap', selector, x, y, await this.eval(`(() => { const e = document.elementFromPoint(${x}, ${y}); return e ? (e.closest('[data-id]')?.dataset.id || e.id || e.className) : null; })()`));
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
  async longPress(selector, ms = 650) {
    const { x, y } = await this.center(selector);
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await sleep(ms);
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async type(text) { await this.send('Input.insertText', { text }); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// userDataDir: reuse a profile (e.g. to reopen a site after its service worker installed); it is kept on close.
export async function launch({ args = [], userDataDir } = {}) {
  const dir = userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'fp-chrome-'));
  const proc = spawn(chromePath(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--hide-scrollbars', '--mute-audio', ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`Chrome did not start:\n${buf}`)), 15000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`Chrome exited (${code}):\n${buf}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
  const conn = new Connection(ws);
  return {
    conn,
    // safeArea: { top, bottom, left, right } in CSS px, like an iPhone's notch and home indicator.
    // locale: what navigator.language reports (default zh-TW, like the phones these pages are made for).
    async newPage({ width = 390, height = 844, scale = 3, mobile = true, touch = true, timezone, safeArea, locale = 'zh-TW' } = {}) {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      const page = new Page(conn, sessionId, targetId);
      await page.send('Page.enable');
      await page.send('Runtime.enable');
      await page.send('Network.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
      if (touch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      if (timezone) await page.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
      if (locale) await page.send('Emulation.setLocaleOverride', { locale });
      if (safeArea) await page.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, bottom: 0, left: 0, right: 0, ...safeArea } });
      return page;
    },
    async close() {
      // Graceful first, so the profile (localStorage, caches) is written to disk; then make sure it's gone.
      await Promise.race([conn.send('Browser.close').catch(() => {}), sleep(3000)]);
      try { ws.close(); } catch { /* already closed */ }
      if (proc.exitCode === null) proc.kill();
      await new Promise((r) => { if (proc.exitCode !== null) r(); else proc.once('exit', r); });
      // Chrome's helper processes can still be writing to the profile for a moment after exit: retry the removal.
      if (!userDataDir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}
