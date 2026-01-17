import manifestoDensities from './manifesto.densities.json';

export const MANIFESTO_PARAGRAPHS: string[] = [
  'XYZ represents a shift towards local-only usage of LLMs as a means to wrest control from Big AI.',
  'We utilize already available models to perform LLM-agent interactions locally on the user side, without any interaction with any other server.',
  'No logins. No tracking. Just free, open source software.',
  'Even the code on the user side could theoretically be made to be analyzed with an LLM to assert no malicious code was injected.',
  'This is the next generation of open software.',
];

export const MANIFESTO_TEXT = MANIFESTO_PARAGRAPHS.join('\n\n');

// Keep tokenization consistent with ingestion (whitespace split)
export const MANIFESTO_WORDS: string[] = MANIFESTO_TEXT
  .trim()
  .split(/\s+/)
  .filter(w => w.length > 0);

// Densities are precomputed once and checked into the repo.
// If the JSON length ever drifts, fall back to a neutral density.
export const MANIFESTO_DENSITIES: number[] = Array.isArray(manifestoDensities) && manifestoDensities.length === MANIFESTO_WORDS.length
  ? manifestoDensities
  : new Array(MANIFESTO_WORDS.length).fill(1.0);
