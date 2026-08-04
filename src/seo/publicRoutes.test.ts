import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES, getOpenGraphType, getPublicRoute } from './publicRoutes';

describe('public SEO routes', () => {
    it('contains unique canonical indexable routes', () => {
        const paths = PUBLIC_ROUTES.map((route) => route.pathname);
        const canonicals = PUBLIC_ROUTES.map((route) => route.canonicalUrl);
        const titles = PUBLIC_ROUTES.map((route) => route.title);
        const descriptions = PUBLIC_ROUTES.map((route) => route.description);

        expect(new Set(paths).size).toBe(paths.length);
        expect(new Set(canonicals).size).toBe(canonicals.length);
        expect(new Set(titles).size).toBe(titles.length);
        expect(new Set(descriptions).size).toBe(descriptions.length);

        for (const route of PUBLIC_ROUTES) {
            expect(route.canonicalUrl).toMatch(/^https:\/\/arphen\.xyz\//);
            expect(route.canonicalUrl).not.toMatch(/[?#]/);
            expect(route.title).not.toHaveLength(0);
            expect(route.description).not.toHaveLength(0);
            expect(route.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(route.includeInSitemap).toBe(true);
        }
    });

    it('references real social and application images with the advertised dimensions', () => {
        const imageUrl = PUBLIC_ROUTES[0].openGraphImage;
        expect(imageUrl).toBeDefined();
        expect(PUBLIC_ROUTES.every((route) => route.openGraphImage === imageUrl)).toBe(true);

        const socialImage = readFileSync(resolve(process.cwd(), 'public', new URL(imageUrl!).pathname.slice(1)));
        expect(socialImage.subarray(1, 4).toString('ascii')).toBe('PNG');
        expect(socialImage.readUInt32BE(16)).toBe(1200);
        expect(socialImage.readUInt32BE(20)).toBe(630);

        for (const size of [192, 512]) {
            const icon = readFileSync(resolve(process.cwd(), `public/icon-${size}.png`));
            expect(icon.subarray(1, 4).toString('ascii')).toBe('PNG');
            expect(icon.readUInt32BE(16)).toBe(size);
            expect(icon.readUInt32BE(20)).toBe(size);
        }
    });

    it('resolves every existing public route', () => {
        expect(getPublicRoute('/').canonicalUrl).toBe('https://arphen.xyz/');
        expect(getPublicRoute('/manifesto').canonicalUrl).toBe('https://arphen.xyz/manifesto');
        expect(getPublicRoute('/research').canonicalUrl).toBe('https://arphen.xyz/research');
        expect(getPublicRoute('/manual').canonicalUrl).toBe('https://arphen.xyz/manual');
    });

    it('maps application and editorial routes to their Open Graph types', () => {
        expect(getOpenGraphType(getPublicRoute('/'))).toBe('website');
        expect(getOpenGraphType(getPublicRoute('/research'))).toBe('article');
        expect(getOpenGraphType(getPublicRoute('/manual'))).toBe('article');
        expect(getOpenGraphType(getPublicRoute('/manifesto'))).toBe('article');
    });
});