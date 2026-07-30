import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8');

describe('Cloudflare Pages headers', () => {
    it('allows same-origin camera access for QR scanning', () => {
        expect(headers).toMatch(/^\s+Permissions-Policy:.*\bcamera=\(self\)/m);
        expect(headers).not.toMatch(/^\s+Permissions-Policy:.*\bcamera=\(\)/m);
    });

    it('always revalidates the stable service worker URL', () => {
        expect(headers).toMatch(/\/sw\.js\n\s+Cache-Control: no-cache, no-store, must-revalidate/);
        expect(headers).not.toMatch(/^\/\*\.js$/m);
    });

    it('does not pin SPA fallbacks under asset URLs', () => {
        expect(headers).not.toMatch(/^\s+Cache-Control:.*\bimmutable\b/m);
    });
});