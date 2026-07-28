// scripts/parse_books.js
//
// Phase 1 of the Exhibition Render Pipeline.
//
// Parses Project Gutenberg .epub files into sanitized JSON word arrays that the
// RSVP React app can consume in "exhibition" mode.
//
// - Reads .epub files from a source directory (default: ./books).
// - Strips Project Gutenberg headers/footers/license boilerplate.
// - Removes metadata lines and unreadable / whitespace noise.
// - Writes one JSON word-array per book to public/exhibition-texts/<id>.json
// - Writes an index.json manifest (books + batch assignments).
//
// Usage:
//   node scripts/parse_books.js [--source=books] [--out=public/exhibition-texts] [--min-words=200]
//
// This script is dependency-light: it only uses jszip + cheerio, both already
// present in package.json, so it runs in plain Node without a build step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const m = raw.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] === undefined ? true : m[2];
  }
  return args;
}

const args = parseArgs(process.argv);
const SOURCE_DIR = path.resolve(ROOT, args.source || 'books');
const OUT_DIR = path.resolve(ROOT, args.out || 'public/exhibition-texts');
const MIN_WORDS = Number(args['min-words'] || 200);
const BATCH_SIZE = 6;

// ---------------------------------------------------------------------------
// Gutenberg cleaning patterns (mirrors src/core/ingest/cleaning.ts)
// ---------------------------------------------------------------------------
const START_MARKER = /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[\s\S]*?\*{3}/i;
const END_MARKER = /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[\s\S]*?\*{3}/i;

const METADATA_LINE_PATTERNS = [
  /^\s*Title:\s*.+$/gim,
  /^\s*Author:\s*.+$/gim,
  /^\s*Release [Dd]ate:\s*.+$/gim,
  /^\s*Language:\s*.+$/gim,
  /^\s*Credits:\s*.+$/gim,
  /^\s*Produced by\s*.+$/gim,
  /^\s*Transcriber['’]?s?\s*[Nn]ote.*$/gim,
  /^\s*Most recently updated:\s*.+$/gim,
  /^.*\[eBook #\d+\].*$/gim,
  /^\s*The Project Gutenberg (?:eBook|EBook) of.*$/gim,
  /^\s*This (?:eBook|ebook) is for the use of anyone anywhere.*$/gim,
];

// HTML elements Project Gutenberg wraps its machine header/footer in.
const BOILERPLATE_SELECTOR = [
  '[class*="pg-boilerplate"]',
  '[class*="pgheader"]',
  '[class*="pg-header"]',
  '[class*="pg-footer"]',
  '#pg-header',
  '#pg-footer',
  '#pg-machine-header',
  'script',
  'style',
].join(', ');

// ---------------------------------------------------------------------------
// EPUB reading
// ---------------------------------------------------------------------------
async function readEpubText(filePath) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  // 1. Locate the OPF via META-INF/container.xml
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('No META-INF/container.xml (not a valid EPUB)');
  const containerXml = await containerFile.async('string');
  const $c = cheerio.load(containerXml, { xmlMode: true });
  const opfPath = $c('rootfile').attr('full-path');
  if (!opfPath) throw new Error('No rootfile full-path in container.xml');

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`OPF not found at ${opfPath}`);
  const opfXml = await opfFile.async('string');
  const $o = cheerio.load(opfXml, { xmlMode: true });

  const opfDir = path.posix.dirname(opfPath);

  // Metadata
  const title = $o('metadata').find('dc\\:title, title').first().text().trim() || path.basename(filePath, '.epub');
  const author = $o('metadata').find('dc\\:creator, creator').first().text().trim() || 'Unknown';

  // 2. Build manifest id -> href map
  const manifest = {};
  $o('manifest > item').each((_, el) => {
    const id = $o(el).attr('id');
    const href = $o(el).attr('href');
    if (id && href) manifest[id] = href;
  });

  // 3. Walk the spine in reading order
  const spineHrefs = [];
  $o('spine > itemref').each((_, el) => {
    const idref = $o(el).attr('idref');
    if (idref && manifest[idref]) spineHrefs.push(manifest[idref]);
  });

  // 4. Extract text from each spine document
  const parts = [];
  for (const href of spineHrefs) {
    const decodedHref = decodeURIComponent(href.split('#')[0]);
    const fullPath = opfDir && opfDir !== '.' ? path.posix.join(opfDir, decodedHref) : decodedHref;
    const entry = zip.file(fullPath) || zip.file(decodedHref);
    if (!entry) continue;
    const html = await entry.async('string');
    const $ = cheerio.load(html);
    $(BOILERPLATE_SELECTOR).remove();
    const text = $('body').text() || $.root().text() || '';
    if (text.trim()) parts.push(text);
  }

  return { title, author, rawText: parts.join('\n\n') };
}

// ---------------------------------------------------------------------------
// Text sanitation
// ---------------------------------------------------------------------------
function sanitize(rawText) {
  let text = rawText;

  // Slice between START / END markers when present (belt-and-suspenders on top
  // of the HTML boilerplate removal).
  const startMatch = text.match(START_MARKER);
  if (startMatch) text = text.slice(startMatch.index + startMatch[0].length);
  const endMatch = text.match(END_MARKER);
  if (endMatch) text = text.slice(0, endMatch.index);

  // Drop the trailing "full license" section if it survived.
  const licenseIdx = text.search(/START:\s*FULL LICENSE|THE FULL PROJECT GUTENBERG LICENSE/i);
  if (licenseIdx !== -1) text = text.slice(0, licenseIdx);

  // Remove metadata lines.
  for (const re of METADATA_LINE_PATTERNS) text = text.replace(re, ' ');

  // Normalise unicode whitespace + strip control characters (keep normal ws).
  text = text
    .replace(/\u00A0/g, ' ') // nbsp
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width chars

  // Collapse runs of whitespace (this also kills "massive whitespace" blocks).
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

function tokenize(text) {
  return text
    .split(/\s+/)
    .map((w) => w.trim())
    // Drop tokens that carry no letters/digits (pure separators like "***", "—").
    .filter((w) => w.length > 0 && /[A-Za-zÀ-ÿ0-9]/.test(w));
}

// ---------------------------------------------------------------------------
// Batch assignment: fixed-size chunks of 6, last chunk wraps to guarantee that
// every grid stitch always has exactly 6 inputs.
// ---------------------------------------------------------------------------
function buildBatches(ids) {
  const batches = {};
  if (ids.length === 0) return batches;

  batches.test = padTo(ids.slice(0, BATCH_SIZE), BATCH_SIZE, ids);

  const numBatches = Math.max(1, Math.ceil(ids.length / BATCH_SIZE));
  for (let b = 0; b < numBatches; b++) {
    const chunk = ids.slice(b * BATCH_SIZE, b * BATCH_SIZE + BATCH_SIZE);
    if (chunk.length === 0) break;
    batches[String(b + 1)] = padTo(chunk, BATCH_SIZE, ids);
  }
  return batches;
}

function padTo(chunk, size, pool) {
  const out = [...chunk];
  let i = 0;
  while (out.length < size && pool.length > 0) {
    out.push(pool[i % pool.length]);
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[parse-books] source : ${SOURCE_DIR}`);
  console.log(`[parse-books] output : ${OUT_DIR}`);

  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`\n[parse-books] ERROR: source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }

  const epubFiles = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => f.toLowerCase().endsWith('.epub'))
    .sort();

  if (epubFiles.length === 0) {
    console.error(`\n[parse-books] ERROR: no .epub files found in ${SOURCE_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const books = [];
  const failures = [];

  for (const file of epubFiles) {
    const id = slugify(path.basename(file, path.extname(file)));
    const filePath = path.join(SOURCE_DIR, file);
    try {
      const { title, author, rawText } = await readEpubText(filePath);
      const cleaned = sanitize(rawText);
      const words = tokenize(cleaned);

      if (words.length < MIN_WORDS) {
        failures.push({ file, reason: `only ${words.length} words (< ${MIN_WORDS})` });
        console.warn(`  ✗ ${file}: only ${words.length} words — skipped`);
        continue;
      }

      fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), JSON.stringify(words));
      books.push({ id, title, author, file, wordCount: words.length });
      console.log(`  ✓ ${file}  ->  ${id}.json  (${words.length.toLocaleString()} words) — "${title}"`);
    } catch (err) {
      failures.push({ file, reason: err.message });
      console.warn(`  ✗ ${file}: ${err.message}`);
    }
  }

  const ids = books.map((b) => b.id);
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, SOURCE_DIR),
    batchSize: BATCH_SIZE,
    books,
    batches: buildBatches(ids),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2));

  console.log('\n[parse-books] summary');
  console.log(`  parsed  : ${books.length}/${epubFiles.length}`);
  console.log(`  failed  : ${failures.length}`);
  console.log(`  manifest: ${path.relative(ROOT, path.join(OUT_DIR, 'index.json'))}`);
  console.log(`  batches : ${Object.keys(manifest.batches).filter((k) => k !== 'test').length} full grid(s) + test`);

  if (failures.length) {
    console.log('\n  failures:');
    for (const f of failures) console.log(`    - ${f.file}: ${f.reason}`);
  }

  if (books.length === 0) {
    console.error('\n[parse-books] ERROR: no books parsed successfully.');
    process.exit(1);
  }
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

main().catch((err) => {
  console.error('[parse-books] fatal:', err);
  process.exit(1);
});
