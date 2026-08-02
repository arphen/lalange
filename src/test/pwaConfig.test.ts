import { describe, expect, it } from 'vitest';
import {
    PWA_INJECT_REGISTER,
    PWA_MAX_PRECACHE_FILE_BYTES,
    PWA_PRECACHE_GLOB_IGNORES,
    PWA_PRECACHE_GLOB_PATTERNS,
} from '../../pwa.config';

describe('PWA precache configuration', () => {
    it('leaves service worker registration to the isolated update controller', () => {
        expect(PWA_INJECT_REGISTER).toBe(false);
    });

    it('keeps optional AI and TTS runtimes out of the app install', () => {
        expect(PWA_PRECACHE_GLOB_IGNORES).toEqual(expect.arrayContaining([
            '**/*.wasm',
            '**/assets/web-llm-*.js',
            '**/assets/kokoro-*.js',
            '**/assets/transformers.web-*.js',
        ]));
        expect(PWA_MAX_PRECACHE_FILE_BYTES).toBeLessThanOrEqual(2 * 1024 * 1024);
    });

    it('precaches module workers used by local document readers', () => {
        expect(PWA_PRECACHE_GLOB_PATTERNS).toContain('**/*.{js,mjs,css,html}');
    });
});