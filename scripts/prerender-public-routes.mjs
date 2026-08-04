import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'cheerio';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDirectory = resolve(projectRoot, 'dist');
const routeManifestPath = resolve(projectRoot, 'src/seo/publicRoutes.json');

const findAvailablePort = () => new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : null;
        server.close(() => port ? resolvePort(port) : reject(new Error('Could not find an available port')));
    });
});

const waitForServer = async (url) => {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // The preview server is still starting.
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    throw new Error(`Timed out waiting for ${url}`);
};

const routes = JSON.parse(await readFile(routeManifestPath, 'utf8'))
    .filter((route) => route.includeInSitemap);
const appShellPath = resolve(distDirectory, 'app-shell.html');
const appShellHtml = await readFile(resolve(distDirectory, 'index.html'), 'utf8');
const appShellDocument = load(appShellHtml);
appShellDocument('title').text('XYZ Private Application');
appShellDocument('meta[name="robots"]').attr('content', 'noindex, nofollow');
appShellDocument([
    'link[rel="canonical"]',
    'meta[name="description"]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]',
    'script[type="application/ld+json"]',
    'noscript',
].join(',')).remove();
appShellDocument('#root').empty();
await writeFile(appShellPath, `${appShellDocument.html()}\n`, 'utf8');
const port = await findAvailablePort();
const preview = spawn(process.execPath, [
    resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
});

let browser;

try {
    await waitForServer(`http://127.0.0.1:${port}/`);
    browser = await chromium.launch({ headless: true });

    for (const route of routes) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const url = `http://127.0.0.1:${port}${route.pathname}`;

        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        if (!response?.ok()) {
            throw new Error(`Could not render ${route.pathname}: HTTP ${response?.status() ?? 'unknown'}`);
        }
        await page.waitForFunction(
            ({ canonicalUrl, description, title }) => (
                document.title === `${title} | XYZ`
                && document.querySelector('link[rel="canonical"]')?.getAttribute('href') === canonicalUrl
                && document.querySelector('meta[name="description"]')?.getAttribute('content') === description
                && Boolean(document.querySelector('h1')?.textContent?.trim())
            ),
            route,
        );
        await page.evaluate(() => document.fonts.ready);

        if (route.pathname !== '/') {
            await page.locator('noscript').evaluateAll((elements) => {
                for (const element of elements) element.remove();
            });
        }

        const html = await page.content();
        const outputPath = route.pathname === '/'
            ? resolve(distDirectory, 'index.html')
            : resolve(distDirectory, `${route.pathname.slice(1)}.html`);

        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${html}\n`, 'utf8');
        await context.close();

        console.log(`Prerendered ${route.pathname} -> ${outputPath}`);
    }
} finally {
    await browser?.close();
    preview.kill('SIGTERM');
}