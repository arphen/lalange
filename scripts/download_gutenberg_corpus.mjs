import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'test-fixtures', 'gutenberg');
const GUTENDEX_URL = 'https://gutendex.com/books/';
const USER_AGENT = 'XYZ EPUB corpus harness/1.0';
const PAGE_SIZE_FALLBACK = 32;
const CATALOG_RETRIES = 3;
const DOWNLOAD_CONCURRENCY = 3;

const parseArgs = (argv) => Object.fromEntries(argv.slice(2).flatMap((argument) => {
    const match = argument.match(/^--([^=]+)(?:=(.*))?$/);
    return match ? [[match[1], match[2] ?? true]] : [];
}));

const args = parseArgs(process.argv);
const count = Number(args.count || 6);
const seed = String(args.seed || 'xyz-epub-corpus');
const outputDir = path.resolve(ROOT, String(args.out || path.relative(ROOT, DEFAULT_OUTPUT_DIR)));
const shouldRunTests = args.run === true || args.run === 'true';
const shouldClean = args.clean === true || args.clean === 'true';

if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error('--count must be an integer between 1 and 100');
}

const hashSeed = (value) => {
    let hash = 2166136261;
    for (const character of value) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0 || 1;
};

const createRandom = (value) => {
    let state = hashSeed(value);
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x100000000;
    };
};

const random = createRandom(seed);

const fetchJson = async (url) => {
    let lastError;
    for (let attempt = 1; attempt <= CATALOG_RETRIES; attempt++) {
        try {
            const response = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': USER_AGENT,
                },
                signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) throw new Error(`Gutendex returned HTTP ${response.status} for ${url}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            if (attempt < CATALOG_RETRIES) console.warn(`  catalog request failed (attempt ${attempt}/${CATALOG_RETRIES}), retrying`);
        }
    }
    throw lastError;
};

const fetchBinary = async (url) => {
    const response = await fetch(url, {
        headers: {
            Accept: 'application/epub+zip',
            'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Download returned HTTP ${response.status} for ${url}`);
    return Buffer.from(await response.arrayBuffer());
};

const isValidEpub = async (data) => {
    try {
        const zip = await JSZip.loadAsync(data);
        return Boolean(zip.file('META-INF/container.xml'));
    } catch {
        return false;
    }
};

const chooseBooks = async () => {
    const firstPageUrl = new URL(GUTENDEX_URL);
    firstPageUrl.searchParams.set('languages', 'en');
    firstPageUrl.searchParams.set('mime_type', 'application/epub+zip');
    firstPageUrl.searchParams.set('copyright', 'false');
    firstPageUrl.searchParams.set('page', '1');

    const firstPage = await fetchJson(firstPageUrl);
    const pageSize = firstPage.results.length || PAGE_SIZE_FALLBACK;
    const totalPages = Math.ceil(firstPage.count / pageSize);
    const pages = [firstPage];
    const pagesNeeded = Math.min(totalPages, Math.ceil(count / pageSize));
    for (let pageNumber = 2; pageNumber <= pagesNeeded; pageNumber++) {
        const pageUrl = new URL(firstPageUrl);
        pageUrl.searchParams.set('page', String(pageNumber));
        pages.push(await fetchJson(pageUrl));
    }

    const candidates = pages.flatMap((page) => page.results)
        .filter((book) => book.formats?.['application/epub+zip']);
    const selected = new Map();

    while (selected.size < count && candidates.length > 0) {
        const candidateIndex = Math.floor(random() * candidates.length);
        const [book] = candidates.splice(candidateIndex, 1);
        if (book && !selected.has(book.id)) selected.set(book.id, book);
    }

    if (selected.size < count) {
        throw new Error(`Gutendex yielded only ${selected.size} unique EPUB books in ${pages.length} catalog page(s)`);
    }

    return [...selected.values()];
};

const downloadBook = async (book, index) => {
    const downloadUrl = book.formats['application/epub+zip'];
    const fileName = `gutenberg-${book.id}.epub`;
    const targetPath = path.join(outputDir, fileName);
    const existing = await fs.readFile(targetPath).catch(() => null);

    if (existing && !shouldClean && await isValidEpub(existing)) {
        console.log(`  [${index}] cached ${fileName}`);
        return { book, fileName, downloadUrl, bytes: existing.length };
    }

    const data = await fetchBinary(downloadUrl);
    if (!await isValidEpub(data)) throw new Error(`Downloaded file is not a valid EPUB: ${downloadUrl}`);
    const temporaryPath = `${targetPath}.tmp`;
    await fs.writeFile(temporaryPath, data);
    await fs.rename(temporaryPath, targetPath);
    console.log(`  [${index}] downloaded ${fileName} (${Math.round(data.length / 1024)} KiB)`);
    return { book, fileName, downloadUrl, bytes: data.length };
};

const runCorpusTest = () => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'test:epub-corpus'], {
        cwd: ROOT,
        env: {
            ...process.env,
            EPUB_CORPUS_DIR: outputDir,
            RUN_EPUB_CORPUS: '1',
        },
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
};

const main = async () => {
    console.log(`[gutenberg-corpus] seed=${seed} count=${count}`);
    console.log(`[gutenberg-corpus] output=${path.relative(ROOT, outputDir) || '.'}`);
    await fs.mkdir(outputDir, { recursive: true });

    if (shouldClean) {
        const existingFiles = await fs.readdir(outputDir);
        await Promise.all(existingFiles
            .filter((file) => /^gutenberg-\d+\.epub$/.test(file))
            .map((file) => fs.rm(path.join(outputDir, file))));
    }

    const books = await chooseBooks();
    const downloaded = [];
    for (let index = 0; index < books.length; index += DOWNLOAD_CONCURRENCY) {
        const batch = books.slice(index, index + DOWNLOAD_CONCURRENCY);
        downloaded.push(...await Promise.all(batch.map((book, batchIndex) => (
            downloadBook(book, index + batchIndex + 1)
        ))));
    }

    const manifest = {
        source: 'Gutendex / Project Gutenberg',
        generatedAt: new Date().toISOString(),
        seed,
        requestedCount: count,
        books: downloaded.map(({ book, fileName, downloadUrl, bytes }) => ({
            id: book.id,
            title: book.title,
            authors: book.authors,
            file: fileName,
            downloadUrl,
            bytes,
        })),
    };
    await fs.writeFile(
        path.join(outputDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
    );

    console.log(`[gutenberg-corpus] ready: ${downloaded.length} EPUBs`);
    if (shouldRunTests) runCorpusTest();
};

main().catch((error) => {
    console.error(`[gutenberg-corpus] fatal: ${error.message}`);
    process.exitCode = 1;
});