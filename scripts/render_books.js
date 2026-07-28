// scripts/render_books.js
//
// Phase 3 of the Exhibition Render Pipeline.
//
// Drives a headless Chromium instance through the RSVP app's exhibition mode,
// capturing one .webm per book into renders/raw/.
//
// Usage:
//   node scripts/render_books.js --batch=test --duration=30
//   node scripts/render_books.js --batch=all  --duration=600
//   node scripts/render_books.js --batch=1    --duration=600
//
// Flags:
//   --batch=test|all|1|2|3   which books to render (from the parse manifest)
//   --duration=<seconds>     per-book recording length (default 30)
//   --wpm=<n>                base reading speed (default 450)
//   --fps=<n>                capture frame rate (default 30)
//   --port=<n>               dev server port (default 5173)
//   --out=<dir>              output dir (default renders/raw)
//   --start=<n>              start offset (0..1 or 0..100 percent, default 0)
//   --retries=<n>            retries per book on failure (default 2)
//   --force                  re-render books whose .webm already exists
//
// If nothing is already listening on --port, a Vite dev server is started
// automatically and shut down when rendering finishes.
// Existing outputs are only skipped when their probed duration matches the
// requested --duration (so short test clips never satisfy full renders).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

const args = parseArgs(process.argv);
const BATCH = String(args.batch || 'test');
const DURATION = Math.max(1, Number(args.duration || 30));
const WPM = Math.max(50, Number(args.wpm || 450));
const FPS = Math.max(1, Number(args.fps || 30));
const PORT = Number(args.port || 5173);
const OUT_DIR = path.resolve(ROOT, args.out || 'renders/raw');
const FORCE = Boolean(args.force);
const RETRIES = Math.max(0, Number(args.retries || 2));
const RAW_START = Number(args.start || 0);
const START = Number.isFinite(RAW_START)
  ? Math.min(0.99, Math.max(0, RAW_START > 1 ? RAW_START / 100 : RAW_START))
  : 0;
const BASE_URL = `http://localhost:${PORT}`;
const MANIFEST_PATH = path.join(ROOT, 'public', 'exhibition-texts', 'index.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describeError(err) {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function isServerUp(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(url)) return true;
    await sleep(500);
  }
  return false;
}

function startDevServer() {
  console.log(`[render] starting Vite dev server on :${PORT} ...`);
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: { ...process.env, VITE_HTTPS: '0' },
    detached: false,
  });
  return child;
}

function resolveBookIds(manifest) {
  const batches = manifest.batches || {};
  if (BATCH === 'all') {
    // Render every unique book referenced by any batch (== all parsed books).
    const seen = new Set();
    const ids = [];
    for (const key of Object.keys(batches)) {
      for (const id of batches[key]) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    }
    return ids;
  }
  if (!batches[BATCH]) {
    throw new Error(`unknown batch "${BATCH}". Available: ${Object.keys(batches).join(', ')}`);
  }
  // Dedupe within a single batch (padding may repeat ids).
  return [...new Set(batches[BATCH])];
}

async function waitForDownload(filePath, timeoutMs) {
  const start = Date.now();
  let lastSize = -1;
  let stableCount = 0;
  const partFile = `${filePath}.crdownload`;
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const size = fs.statSync(filePath).size;
      if (size > 0 && size === lastSize && !fs.existsSync(partFile)) {
        stableCount++;
        if (stableCount >= 2) return true;
      } else {
        stableCount = 0;
      }
      lastSize = size;
    }
    await sleep(500);
  }
  return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
}

function getDurationSeconds(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const res = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) return null;
  const d = Number(res.stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

function isDurationMatch(filePath, targetSeconds) {
  const d = getDurationSeconds(filePath);
  if (d == null) return false;
  // Keep tolerance tight for short clips, looser for long captures.
  const tolerance = targetSeconds <= 60 ? 2.5 : 15;
  return Math.abs(d - targetSeconds) <= tolerance;
}

function cleanupStaleDownloadArtifacts(id) {
  const outFile = path.join(OUT_DIR, `${id}.webm`);
  const partFile = `${outFile}.crdownload`;
  for (const p of [outFile, partFile]) {
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }
}

async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--window-size=1280,1080',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-usermedia-screen-capturing',
      '--disable-dev-shm-usage',
    ],
  });

  // Set download behaviour at the browser level (works on newer Chromium where
  // the per-page Page.setDownloadBehavior is unavailable).
  try {
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: OUT_DIR,
      eventsEnabled: true,
    });
  } catch {
    // Fall back to the per-page handler set in renderBook().
  }

  return browser;
}

async function waitForExhibitionDone(page, timeoutMs) {
  const start = Date.now();
  let lastState = null;

  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) throw new Error('page closed while waiting for completion');

    try {
      const state = await page.evaluate(() => ({
        state: window.__EXHIBITION_STATE__,
        done: window.__EXHIBITION_DONE__ === true,
        error: window.__EXHIBITION_ERROR__,
      }));
      lastState = state;

      if (state.state === 'error') {
        throw new Error(state.error || 'exhibition render reported error');
      }
      if (state.done) return;
    } catch (err) {
      // During long recordings Chromium may transiently reset contexts; ignore
      // these and continue polling until the hard timeout.
      const msg = describeError(err);
      const transient = /execution context|cannot find context|frame (was )?detached|session closed|target closed/i.test(
        msg,
      );
      if (!transient) {
        throw new Error(`state poll failed: ${msg}`);
      }
    }

    await sleep(1000);
  }

  const tail = lastState ? ` (last state: ${JSON.stringify(lastState)})` : '';
  throw new Error(`state wait timeout after ${timeoutMs}ms${tail}`);
}

async function renderBook(browser, id) {
  const outFile = path.join(OUT_DIR, `${id}.webm`);

  let page;
  let client;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1080, deviceScaleFactor: 1 });

    client = await page.target().createCDPSession();
    try {
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: OUT_DIR,
      });
    } catch {
      // Newer Chromium exposes this only at the browser level (set in main()).
    }

    const url = `${BASE_URL}/?exhibition=true&book=${encodeURIComponent(id)}&duration=${DURATION}&wpm=${WPM}&fps=${FPS}&start=${START}`;
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    // Allow generous headroom for long captures where background throttling
    // can delay timers despite anti-throttling flags.
    const budget = DURATION * 1000 + Math.max(5 * 60 * 1000, Math.floor(DURATION * 1000 * 0.75));
    await waitForExhibitionDone(page, budget);

    // The download is written asynchronously after onstop fires.
    const ok = await waitForDownload(outFile, 30000);
    if (!ok) throw new Error(`download did not appear: ${outFile}`);
    return outFile;
  } finally {
    try {
      if (client) await client.detach();
    } catch {
      // ignore cleanup errors
    }
    try {
      if (page && !page.isClosed()) await page.close();
    } catch {
      // ignore cleanup errors
    }
  }
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`[render] ERROR: manifest not found: ${MANIFEST_PATH}`);
    console.error('[render] Run `node scripts/parse_books.js` (or `make parse-books`) first.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const ids = resolveBookIds(manifest);

  if (ids.length === 0) {
    console.error(`[render] ERROR: no books resolved for batch "${BATCH}".`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`[render] batch    : ${BATCH}  (${ids.length} book${ids.length === 1 ? '' : 's'})`);
  console.log(`[render] duration : ${DURATION}s  |  wpm ${WPM}  |  fps ${FPS}`);
  console.log(`[render] start    : ${(START * 100).toFixed(1)}%`);
  console.log(`[render] retries  : ${RETRIES}`);
  console.log(`[render] output   : ${path.relative(ROOT, OUT_DIR)}`);

  // Ensure a server is running.
  let devServer = null;
  if (!(await isServerUp(BASE_URL))) {
    devServer = startDevServer();
    const up = await waitForServer(BASE_URL, 90000);
    if (!up) {
      if (devServer) devServer.kill('SIGTERM');
      console.error(`[render] ERROR: dev server did not come up on ${BASE_URL}`);
      process.exit(1);
    }
  } else {
    console.log(`[render] reusing existing server at ${BASE_URL}`);
  }

  const succeeded = [];
  const failed = [];

  try {
    for (const id of ids) {
      const outFile = path.join(OUT_DIR, `${id}.webm`);
      if (!FORCE && isDurationMatch(outFile, DURATION)) {
        console.log(`  • ${id}: already rendered (${DURATION}s) — skipping (use --force to redo)`);
        succeeded.push(id);
        continue;
      }
      if (!FORCE && fs.existsSync(outFile)) {
        const found = getDurationSeconds(outFile);
        const label = found == null ? 'unknown' : `${found.toFixed(2)}s`;
        console.log(`  • ${id}: existing output duration ${label} != requested ${DURATION}s — re-rendering`);
      }

      let done = false;
      let lastError = 'unknown error';
      for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
        const attemptLabel = RETRIES > 0 ? ` (attempt ${attempt}/${RETRIES + 1})` : '';
        process.stdout.write(`  ⏺ ${id}: recording ${DURATION}s${attemptLabel} ... `);
        const t0 = Date.now();
        cleanupStaleDownloadArtifacts(id);
        let browser;
        try {
          browser = await launchBrowser();
          await renderBook(browser, id);
          const secs = ((Date.now() - t0) / 1000).toFixed(1);
          const mb = (fs.statSync(outFile).size / 1e6).toFixed(1);
          const duration = getDurationSeconds(outFile);
          if (!isDurationMatch(outFile, DURATION)) {
            const actual = duration == null ? 'unknown' : `${duration.toFixed(2)}s`;
            throw new Error(`output duration mismatch (${actual}, expected ${DURATION}s)`);
          }
          console.log(`done (${mb} MB, ${secs}s wall)`);
          succeeded.push(id);
          done = true;
          break;
        } catch (err) {
          lastError = describeError(err);
          console.log('FAILED');
          console.warn(`     ${lastError}`);
          if (attempt <= RETRIES) {
            const backoff = 1500 * attempt;
            console.warn(`     retrying in ${backoff}ms ...`);
            await sleep(backoff);
          }
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch {
              // ignore cleanup errors
            }
          }
        }
      }

      if (!done) {
        failed.push({ id, error: lastError });
      }
    }
  } finally {
    if (devServer) {
      console.log('[render] stopping dev server');
      devServer.kill('SIGTERM');
    }
  }

  console.log(`\n[render] summary: ${succeeded.length} ok, ${failed.length} failed`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.id}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[render] fatal:', err);
  process.exit(1);
});
