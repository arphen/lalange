import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = path.resolve(ROOT, process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] || 'books');
const OUTPUT_FILE = path.resolve(ROOT, process.argv.find((arg) => arg.startsWith('--out='))?.split('=')[1]
    || 'src/core/rsvp/phrases/commonEnglishNgrams.ts');
const GENERATOR_VERSION = '1';
const LIMIT = 500;
const compareDeterministically = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const START_MARKER = /\*{3}\s*START OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[\s\S]*?\*{3}/i;
const END_MARKER = /\*{3}\s*END OF (?:THE |THIS )?PROJECT GUTENBERG E-?BOOK[\s\S]*?\*{3}/i;
const BOILERPLATE_SELECTOR = [
    '[class*="pg-boilerplate"]', '[class*="pgheader"]', '[class*="pg-header"]',
    '[class*="pg-footer"]', '#pg-header', '#pg-footer', '#pg-machine-header', 'script', 'style',
].join(', ');
const LEADING_QUOTE_OR_BRACKET = /^[\s"'`“‘([{]+/u;
const TRAILING_LOOKUP_PUNCTUATION = /[.!?,;:"'”’)}\]]+$/u;
const INTERNAL_BOUNDARY_PUNCTUATION = /[.!?;:,]["'”’)}\]]*$/u;
const TERMINAL_PUNCTUATION = /[.!?]["'”’)}\]]*$/u;
const NUMERALS_ONLY = /^\p{N}+$/u;
const MALFORMED_OCR_MARKER = /[�]/u;
const REFERENCE_TOKEN_PATTERNS = [
    /^\[ref\][,.;:!?]?$/i,
    /^\[\d{1,4}[a-z]?\][,.;:!?]?$/i,
    /^\((?:p|pp)\.?\s*\d{1,4}(?:\s*[—-]\s*\d{1,4})?\)[,.;:!?]?$/i,
    /^\(\d{1,4}[.,]\d{1,4}(?:\[\d+\])?\)[,.;:!?]?$/i,
    /^\(\d{1,4},\s*[a-z]{2,4}(?:\[\d+\])?\)[,.;:!?]?$/i,
    /^\(\d{1,4}[—-]\d{1,4}\)[,.;:!?]?$/i,
    /^\(\d{2,3}\)[,.;:!?]?$/,
];

const normalizePhraseToken = (token) => token
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[’‘]/gu, "'")
    .replace(LEADING_QUOTE_OR_BRACKET, '')
    .replace(TRAILING_LOOKUP_PUNCTUATION, '');

const isStandalonePause = (token) => /^(?:[—–―]+|--+)$/.test(token.trim());
const isContinuation = (token) => token.endsWith('-') && token.length > 1;
const isSlashContinuation = (token) => token.endsWith('/') && token.length > 1;
const isReferenceToken = (token) => REFERENCE_TOKEN_PATTERNS.some((pattern) => pattern.test(token.trim()));

const isEligibleToken = (token) => {
    const normalized = normalizePhraseToken(token);
    if (!normalized || !/\p{L}/u.test(normalized)) return false;
    if (NUMERALS_ONLY.test(normalized) || MALFORMED_OCR_MARKER.test(token)) return false;
    if (isReferenceToken(token) || isStandalonePause(token) || isContinuation(token) || isSlashContinuation(token)) return false;
    const lexicalCharacters = Array.from(normalized).filter((character) => /[\p{L}\p{N}'-]/u.test(character));
    return lexicalCharacters.length > 0 && lexicalCharacters.length <= 12 && normalized.length <= 12;
};

const normalizeText = (text) => {
    let normalized = text;
    const startMatch = normalized.match(START_MARKER);
    if (startMatch) normalized = normalized.slice(startMatch.index + startMatch[0].length);
    const endMatch = normalized.match(END_MARKER);
    if (endMatch) normalized = normalized.slice(0, endMatch.index);
    const licenseIndex = normalized.search(/START:\s*FULL LICENSE|THE FULL PROJECT GUTENBERG LICENSE/i);
    if (licenseIndex !== -1) normalized = normalized.slice(0, licenseIndex);
    return normalized
        .replace(/\u00A0/g, ' ')
        .replace(/[\u0000-\u001F\u007F]/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/([—–―]+|--+)/g, ' $1 ')
        .replace(/\s+/g, ' ')
        .trim();
};

const readEpubText = async (filePath) => {
    const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
    const container = zip.file('META-INF/container.xml');
    if (!container) throw new Error(`Missing EPUB container: ${filePath}`);
    const containerXml = await container.async('string');
    const containerDocument = cheerio.load(containerXml, { xmlMode: true });
    const opfPath = containerDocument('rootfile').attr('full-path');
    if (!opfPath) throw new Error(`Missing EPUB rootfile: ${filePath}`);
    const opf = zip.file(opfPath);
    if (!opf) throw new Error(`Missing EPUB OPF: ${filePath}`);
    const opfDocument = cheerio.load(await opf.async('string'), { xmlMode: true });
    const opfDir = path.posix.dirname(opfPath);
    const manifest = new Map();
    opfDocument('manifest > item').each((_, element) => {
        const id = opfDocument(element).attr('id');
        const href = opfDocument(element).attr('href');
        if (id && href) manifest.set(id, href);
    });
    const spine = [];
    opfDocument('spine > itemref').each((_, element) => {
        const href = manifest.get(opfDocument(element).attr('idref'));
        if (href) spine.push(href);
    });
    const parts = [];
    for (const href of spine) {
        const decodedHref = decodeURIComponent(href.split('#')[0]);
        const fullPath = opfDir && opfDir !== '.' ? path.posix.join(opfDir, decodedHref) : decodedHref;
        const entry = zip.file(fullPath) || zip.file(decodedHref);
        if (!entry) continue;
        const document = cheerio.load(await entry.async('string'));
        document(BOILERPLATE_SELECTOR).remove();
        const text = document('body').text() || document.root().text();
        if (text.trim()) parts.push(text);
    }
    return parts.join('\n\n');
};

const countNgrams = (text) => {
    const counts = [new Map(), new Map()];
    let sentence = [];

    const flush = () => {
        for (const size of [2, 3]) {
            for (let index = 0; index + size <= sentence.length; index++) {
                const tokens = sentence.slice(index, index + size);
                if (tokens.slice(0, -1).some((token) => INTERNAL_BOUNDARY_PUNCTUATION.test(token))) continue;
                const phrase = tokens.map(normalizePhraseToken).join(' ');
                if (phrase.length <= 24) counts[size - 2].set(phrase, (counts[size - 2].get(phrase) || 0) + 1);
            }
        }
        sentence = [];
    };

    for (const token of normalizeText(text).split(/\s+/)) {
        if (isStandalonePause(token)) {
            flush();
            continue;
        }
        if (!isEligibleToken(token)) {
            flush();
            continue;
        }
        sentence.push(token);
        if (TERMINAL_PUNCTUATION.test(token)) flush();
    }
    flush();
    return counts;
};

const rank = (counts) => Array.from(counts.entries())
    .sort(([leftPhrase, leftCount], [rightPhrase, rightCount]) => rightCount - leftCount || compareDeterministically(leftPhrase, rightPhrase))
    .slice(0, LIMIT)
    .map(([phrase]) => phrase);

const formatArray = (name, values) => `${name} = [\n${values.map((value) => `    ${JSON.stringify(value)},`).join('\n')}\n] as const;`;

const main = async () => {
    const candidateFiles = fs.readdirSync(SOURCE_DIR)
        .filter((file) => /^pg\d+.*\.epub$/i.test(file))
        .sort(compareDeterministically);
    const files = [];
    for (const file of candidateFiles) {
        try {
            await JSZip.loadAsync(fs.readFileSync(path.join(SOURCE_DIR, file)));
            files.push(file);
        } catch {
            console.warn(`[common-ngrams] skipping malformed EPUB: ${file}`);
        }
    }
    if (files.length === 0) throw new Error(`No readable Project Gutenberg EPUBs found in ${SOURCE_DIR}`);

    const counts = [new Map(), new Map()];
    const hash = crypto.createHash('sha256');
    for (const file of files) {
        const filePath = path.join(SOURCE_DIR, file);
        hash.update(file);
        hash.update(fs.readFileSync(filePath));
        const bookCounts = await countNgrams(await readEpubText(filePath));
        for (const index of [0, 1]) {
            for (const [phrase, count] of bookCounts[index]) {
                counts[index].set(phrase, (counts[index].get(phrase) || 0) + count);
            }
        }
    }

    const bigrams = rank(counts[0]);
    const trigrams = rank(counts[1]);
    const sourceHash = hash.digest('hex');
    const output = [
        `// Generated by scripts/generate_common_ngrams.mjs. Do not edit by hand.`,
        `// Corpus identifiers: ${files.join(', ')}`,
        `// Corpus source hash: ${sourceHash}`,
        `// Generator version: ${GENERATOR_VERSION}`,
        '',
        formatArray('export const COMMON_BIGRAMS', bigrams),
        '',
        formatArray('export const COMMON_TRIGRAMS', trigrams),
        '',
        `export const COMMON_BIGRAM_RANKS: ReadonlyMap<string, number> = new Map(`,
        `    COMMON_BIGRAMS.map((phrase, rank) => [phrase, rank]),`,
        `);`,
        '',
        `export const COMMON_TRIGRAM_RANKS: ReadonlyMap<string, number> = new Map(`,
        `    COMMON_TRIGRAMS.map((phrase, rank) => [phrase, rank]),`,
        `);`,
        '',
        `export const COMMON_NGRAM_RANK_LIMIT = ${LIMIT};`,
        '',
        `export const COMMON_NGRAM_METADATA = {`,
        `    corpus: 'Project Gutenberg EPUB corpus',`,
        `    generatorVersion: '${GENERATOR_VERSION}',`,
        `    sourceHash: '${sourceHash}',`,
        `    corpusIdentifiers: ${JSON.stringify(files)},`,
        `} as const;`,
        '',
    ].join('\n');

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, output);
    console.log(`[common-ngrams] books=${files.length} bigrams=${bigrams.length} trigrams=${trigrams.length}`);
    console.log(`[common-ngrams] output=${path.relative(ROOT, OUTPUT_FILE)}`);
};

main().catch((error) => {
    console.error(`[common-ngrams] fatal: ${error.message}`);
    process.exitCode = 1;
});