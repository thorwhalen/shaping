/**
 * Measures how a slider drag feels while the viewer rebuilds the model (shaping#9): a drag of N
 * steps on one slider at a CPU throttle. Per drag it reports
 *
 * - `slowestStepMs`: the slowest input step, as the driver waits for it (the hand's view);
 * - `longestTaskMs`, `longTasksMs`: the longest main-thread task, and all of them (over 50 ms) summed;
 * - `finalModelMs`: release to the final model in the store (no rebuild running), timed in the page;
 * - `gestureEndMs`: release to the end of the gesture (the final model painted; drafts end here).
 *
 * It drives a development build (`pnpm dev`), which exposes the store as `window.__app`. The first
 * drag of a page is a warm-up and is not reported. Compare builds by alternating them, one dev
 * server each, and report every run: on a loaded machine single runs are noise.
 *
 * Run from `app/` with the dev server up:
 *
 *   node scripts/measure-drag.mjs                       # the Shadow blocks starter, Round, 6x throttle
 *   node scripts/measure-drag.mjs --design "Letters turned into rings" --runs 4
 *   node scripts/measure-drag.mjs --gpu                 # on the machine's GPU instead of software GL
 *   node scripts/measure-drag.mjs --cdp http://localhost:9222 --throttle 1   # a browser already running
 *
 * `--cdp` attaches to any browser that serves the DevTools protocol, so it also measures on a
 * phone: Chrome on Android with USB debugging, then
 * `adb forward tcp:9222 localabstract:chrome_devtools_remote` and `adb reverse tcp:5173 tcp:5173`.
 * A real device needs no throttle.
 *
 * Needs a browser for playwright-core: `pnpm exec playwright-core install chromium-headless-shell`.
 * Software GL by default; `--gpu` draws on the machine's GPU (still headless). Prints one JSON line
 * per run and a summary line of medians.
 */
import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';

const DEFAULTS = {
  url: 'http://localhost:5173/',
  design: 'New: Shadow blocks',
  slider: 'Round',
  steps: '40',
  throttle: '6',
  runs: '4',
  scale: '2',
  width: '1280',
  height: '800',
  settleMs: '1500',
  timeoutMs: '120000',
};

const { values: opt } = parseArgs({
  options: {
    ...Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, { type: 'string', default: v }])),
    gpu: { type: 'boolean', default: false },
    cdp: { type: 'string' },
  },
});
const num = (k) => Number(opt[k]);

/** Software GL keeps runs comparable across machines; `--gpu` measures the real device. */
const SOFTWARE_GL = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const HARDWARE_GL = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])];

const SETTLED = `(() => { const s = window.__app?.getState(); return !!(s && s.model && !s.stale && !s.gesturing); })()`;
const TWO_FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))';

/**
 * Armed in the page before a drag: long tasks, and the store's flips after the pointer is released
 * (the last rebuild landing, the gesture ending), timed by the page's own clock.
 */
function arm() {
  const w = window;
  const log = (w.__measure = { longTasks: [], model: 0, gesture: 0, up: 0 });
  w.__measureOff?.();
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => log.longTasks.push(e.duration)));
  observer.observe({ type: 'longtask' });
  addEventListener('pointerup', () => void (log.up = performance.now()), { once: true, capture: true });
  let prev = w.__app.getState();
  const unsubscribe = w.__app.subscribe((s) => {
    if (log.up) {
      if (prev.stale && !s.stale) log.model = performance.now() - log.up;
      if (prev.gesturing && !s.gesturing) log.gesture = performance.now() - log.up;
    }
    prev = s;
  });
  w.__measureOff = () => (observer.disconnect(), unsubscribe());
}

async function openPage() {
  if (opt.cdp) {
    const browser = await chromium.connectOverCDP(opt.cdp);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    // Closes only the tab it opened; on an attached browser, close() just disconnects.
    return { browser, page, close: async () => (await page.close(), await browser.close()) };
  }
  const browser = await chromium.launch({ args: opt.gpu ? HARDWARE_GL : SOFTWARE_GL });
  const context = await browser.newContext({ viewport: { width: num('width'), height: num('height') }, deviceScaleFactor: num('scale') });
  return { browser, page: await context.newPage(), close: () => browser.close() };
}

async function settled(page) {
  await page.waitForFunction(SETTLED, null, { timeout: num('timeoutMs'), polling: 50 });
  await page.evaluate(TWO_FRAMES);
}

/** One drag across the slider (alternating direction), timed step by step. */
async function drag(page, cdp, run) {
  const box = await page.getByLabel(opt.slider, { exact: true }).boundingBox();
  if (!box) throw new Error(`No slider labelled ${JSON.stringify(opt.slider)} on screen.`);
  const y = box.y + box.height / 2;
  const [from, to] = run % 2 ? [box.x + box.width - 4, box.x + 4] : [box.x + 4, box.x + box.width - 4];
  const steps = num('steps');
  await page.evaluate(arm);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: num('throttle') });
  try {
    await page.mouse.move(from, y);
    await page.mouse.down();
    const times = [];
    for (let i = 1; i <= steps; i++) {
      const t = performance.now();
      await page.mouse.move(from + ((to - from) * i) / steps, y);
      times.push(performance.now() - t);
    }
    await page.mouse.up();
    await settled(page);
    const m = await page.evaluate(() => (window.__measureOff(), window.__measure));
    return {
      value: await page.getByLabel(opt.slider, { exact: true }).inputValue(),
      slowestStepMs: Math.round(Math.max(...times)),
      longestTaskMs: Math.round(Math.max(0, ...m.longTasks)),
      longTasksMs: Math.round(m.longTasks.reduce((a, b) => a + b, 0)),
      finalModelMs: Math.round(m.model),
      gestureEndMs: Math.round(m.gesture || m.model),
    };
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
}

async function main() {
  const { page, close } = await openPage();
  try {
    await page.goto(opt.url);
    await page.waitForFunction('!!window.__app', null, { timeout: num('timeoutMs') }).catch(() => {
      throw new Error(`window.__app is missing at ${opt.url}: measure a development build (pnpm dev).`);
    });
    await page.getByText(opt.design, { exact: true }).first().click();
    await settled(page);
    await page.waitForTimeout(num('settleMs'));
    const cdp = await page.context().newCDPSession(page);
    const runs = [];
    for (let run = 0; run <= num('runs'); run++) {
      const r = await drag(page, cdp, run);
      await page.waitForTimeout(num('settleMs'));
      if (run === 0) continue; // the warm-up: a page's first drag does not reliably reach the slider
      console.log(JSON.stringify({ run, ...r }));
      runs.push(r);
    }
    const median = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor((runs.length - 1) / 2)];
    console.log(JSON.stringify({ summary: { design: opt.design, slider: opt.slider, steps: num('steps'), throttle: num('throttle'), runs: runs.length, ...Object.fromEntries(['slowestStepMs', 'longestTaskMs', 'longTasksMs', 'finalModelMs', 'gestureEndMs'].map((k) => [k, median(k)])) } }));
  } finally {
    await close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
