// Generates a static density map for the Manifesto.
//
// This is intentionally heuristic-only so it runs in Node without requiring
// the browser-only WebLLM runtime.
// If you want LLM-derived densities, you can replace `estimateDensity` with
// output from your preferred pipeline and keep the same JSON format.
//
// Usage:
//   node scripts/generate_manifesto_densities.js
//
// Output:
//   src/content/manifesto.densities.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const manifestoPath = path.join(__dirname, '..', 'src', 'content', 'manifesto.ts');
const densitiesOutPath = path.join(__dirname, '..', 'src', 'content', 'manifesto.densities.json');

const manifestoSrc = fs.readFileSync(manifestoPath, 'utf8');

// Extract paragraphs array in a very small, robust way.
// (We avoid TS execution; we just scrape the literal strings.)
const paragraphMatches = [...manifestoSrc.matchAll(/MANIFESTO_PARAGRAPHS:\s*string\[\]\s*=\s*\[([\s\S]*?)\];/g)];
if (paragraphMatches.length === 0) {
  throw new Error('Could not find MANIFESTO_PARAGRAPHS in src/content/manifesto.ts');
}
const arrayBody = paragraphMatches[0][1];
const stringMatches = [...arrayBody.matchAll(/'([^']*)'/g)].map(m => m[1]);

const text = stringMatches.join('\n\n');
const words = text.trim().split(/\s+/).filter(Boolean);

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function estimateDensity(word) {
  // Base around 1.0, push higher for punctuation/long/rare-looking words.
  let d = 1.0;

  const clean = word.replace(/[^A-Za-z]/g, '');
  const len = clean.length;

  // length penalty
  d += clamp((len - 6) * 0.05, 0, 0.6);

  // punctuation wrap-up: use higher density (slower)
  if (/[.!?]["']?$/.test(word)) d += 0.8;
  else if (/[;:]["']?$/.test(word)) d += 0.5;
  else if (/[,—-]$/.test(word)) d += 0.3;

  // caps look like entities/acronyms
  if (/^[A-Z]{2,}$/.test(clean)) d += 0.4;

  // slightly slow down emphasized tokens
  if (word.includes('-')) d += 0.15;

  return clamp(Number(d.toFixed(2)), 0.6, 2.4);
}

const densities = words.map(estimateDensity);
fs.writeFileSync(densitiesOutPath, JSON.stringify(densities, null, 2) + '\n', 'utf8');
console.log(`Wrote ${densities.length} densities to ${densitiesOutPath}`);
