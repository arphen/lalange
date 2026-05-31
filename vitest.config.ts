/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            // Mock virtual:pwa-register for tests
            'virtual:pwa-register': path.resolve(__dirname, 'src/test/__mocks__/pwa-register.ts'),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        css: true,
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            'packages/**',
            'e2e/**',
            'test-results/**',
            'screenshots/**',
        ],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'src/test/setup.ts',
            ],
        },
    },
})
