import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = resolve(projectRoot, 'public/og-image.png');
const iconSizes = [192, 512];

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
            // Vite is still starting.
        }

        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    throw new Error(`Timed out waiting for ${url}`);
};

const port = await findAvailablePort();
const server = spawn(process.execPath, [
    resolve(projectRoot, 'node_modules/vite/bin/vite.js'),
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
    const url = `http://127.0.0.1:${port}/`;
    await waitForServer(url);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        colorScheme: 'dark',
        reducedMotion: 'reduce',
        viewport: { width: 1200, height: 630 },
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'ARCHIVE' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await mkdir(dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, type: 'png' });

        for (const size of iconSizes) {
                const iconPath = resolve(projectRoot, `public/icon-${size}.png`);
                await page.setViewportSize({ width: size, height: size });
                await page.setContent(`<!doctype html>
                    <html><head><style>
                        * { box-sizing: border-box; }
                        body { margin: 0; width: ${size}px; height: ${size}px; display: grid; place-items: center; background: #0a0a0a; }
                        .mark { width: 82%; height: 82%; display: grid; place-items: center; border: 1px solid #3c3c3c; color: #f000b8; font: 700 ${Math.round(size * 0.28)}px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0; }
                        .mark::after { content: ''; position: fixed; inset: 9%; border-top: ${Math.max(2, Math.round(size * 0.012))}px solid #d4af37; }
                    </style></head><body><div class="mark">XYZ</div></body></html>`);
                await page.screenshot({ path: iconPath, type: 'png' });
        }
    await context.close();

        console.log(`Generated social and app icon assets in ${dirname(outputPath)}`);
} finally {
    await browser?.close();
    server.kill('SIGTERM');
}