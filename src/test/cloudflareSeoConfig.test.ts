import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const redirects = readFileSync(resolve(process.cwd(), 'public/_redirects'), 'utf8');
const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8');

describe('Cloudflare SEO routing', () => {
    it('serves private app routes through the sanitized app shell', () => {
        for (const route of ['/reader/*', '/settings/*', '/sync', '/exchange/*', '/EXCHANGE/*', '/library']) {
            expect(redirects).toContain(`${route} /app-shell 200`);
        }
    });

    it('marks private routes and direct shell access as noindex', () => {
        for (const route of ['/reader/*', '/settings/*', '/sync', '/exchange/*', '/EXCHANGE/*', '/library', '/app-shell', '/app-shell.html']) {
            expect(headers).toMatch(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+X-Robots-Tag: noindex, nofollow`));
        }
    });
});