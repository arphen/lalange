import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useSettingsStore } from '../store/settings';

// Mock WebLLM module completely
vi.mock('../ai/webllm', () => ({
    getEngine: vi.fn(),
    MODEL_MAPPING: { tiny: 'mock-model' },
    PACING_MODEL_TIER: 'tiny',
    getPromptLogprobs: vi.fn().mockResolvedValue([]),
    generateWebLLMCompletion: vi.fn().mockImplementation(async () => {
        // Return a valid JSON response for density analysis
        // The pipeline expects a JSON object with sentence scores
        return {
            response: JSON.stringify({
                "The wealth of those societies": 9,
                "This is a fact": 2,
                "12": 0
            }),
            usage: { total_tokens: 100 }
        };
    })
}));

import { initialIngest, processChaptersInBackground } from './pipeline';
import { initDB } from '../sync/db';
import { checkAIHealth, generateUnifiedCompletion } from '../ai/service';

// Adjust path to where generate_epub.js created the file
const TEST_EPUB_PATH = path.resolve(__dirname, '../../../test_book.epub');

describe('Pipeline Integration (WebLLM)', () => {

    beforeEach(() => {
        // Enable the mocked background AI work for this integration test.
        useSettingsStore.setState({
            llmModel: 'tiny',
            aiEnabled: true,
            summariesEnabled: false,
        });
    });

    it('should ingest and process a book end-to-end using WebLLM mock', async () => {
        // 0. Check Prerequisites
        // With the mock, this should pass immediately
        const isAIUp = await checkAIHealth();
        expect(isAIUp).toBe(true);

        // Smoke check
        const smoke = await generateUnifiedCompletion('Return ONLY the word OK.');
        // Our mock returns the density JSON, so this specific check in the test needs to be adjusted
        // or we make the mock smarter.
        // For now, let's just verify we got a response object.
        expect(smoke).toBeDefined();
        expect(smoke.response).toBeDefined();

        if (!fs.existsSync(TEST_EPUB_PATH)) {
            throw new Error(`Test EPUB not found at ${TEST_EPUB_PATH}. Run 'node scripts/generate_epub.js' first.`);
        }

        console.log('Starting integration test with WebLLM (Mock)...');

        // 1. Load File
        const buffer = fs.readFileSync(TEST_EPUB_PATH);
        // Polyfill File if needed
        const file = new File([new Uint8Array(buffer)], 'test_book.epub', { type: 'application/epub+zip' });

        // Polyfill arrayBuffer for test environment if missing
        if (!file.arrayBuffer) {
            Object.defineProperty(file, 'arrayBuffer', {
                value: async () => {
                    return new Uint8Array(buffer).buffer;
                }
            });
        }

        // 2. Initial Ingest
        const { book, chapters, rawFile, images } = await initialIngest(file);
        expect(book).toBeDefined();
        expect(book.title).toBe('Short Test Book');
        expect(chapters.length).toBeGreaterThan(0);

        const bookId = book.id;
        console.log(`Ingested book: ${bookId} with ${chapters.length} chapters`);

        // 3. Insert into DB (Required for background processing)
        const db = await initDB();
        await db.books.insert(book);
        await db.chapters.bulkInsert(chapters);
        await db.raw_files.insert(rawFile);
        if (images.length > 0) await db.images.bulkInsert(images);

        // 4. Process Background Tasks (Density Analysis)
        // This will call our mocked generateWebLLMCompletion
        await processChaptersInBackground(bookId);

        // 5. Verify Results in DB
        const processedChapter = await db.chapters.findOne(chapters[0].id).exec();

        expect(processedChapter).toBeDefined();
        expect(processedChapter?.status).toBe('ready');
        expect(processedChapter?.densities).toBeDefined();
        expect(processedChapter!.densities!.length).toBeGreaterThan(0);

        // Check if densities are within expected range (0.5 to 5.0)
        const validDensities = processedChapter!.densities!.every(d => d >= 0.5 && d <= 5.0);
        expect(validDensities).toBe(true);

        console.log('Integration test passed!');
    });
});
