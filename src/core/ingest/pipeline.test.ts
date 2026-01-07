import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { processChaptersInBackground } from './pipeline';
import { initDB, type MyDatabase } from '../sync/db';
import JSZip from 'jszip';

// Mock dependencies
vi.mock('../sync/db', () => ({
    initDB: vi.fn(),
}));

vi.mock('../ai/service', () => ({
    checkAIHealth: vi.fn().mockResolvedValue(true),
    generateUnifiedCompletion: vi.fn().mockResolvedValue({
        response: JSON.stringify({ "some text": 5 })
    }),
    getPromptLogprobs: vi.fn().mockResolvedValue([])
}));

describe('processChaptersInBackground', () => {
    let mockDb: {
        raw_files: { findOne: Mock };
        chapters: { findOne: Mock };
        books: { findOne: Mock };
    };
    let mockChapterDoc: {
        status: string;
        title: string;
        patch: Mock;
        incrementalPatch: Mock;
        incrementalModify: Mock;
        toJSON: () => Record<string, unknown>;
        [key: string]: unknown;
    };
    let mockRawFileDoc: { data: string };

    beforeEach(() => {
        // Setup mock DB
        mockChapterDoc = {
            status: 'pending',
            title: 'Chapter 1',
            patch: vi.fn().mockImplementation(async (update) => {
                Object.assign(mockChapterDoc, update);
                return mockChapterDoc; // Return self as updated doc
            }),
            incrementalPatch: vi.fn().mockImplementation(async (update) => {
                Object.assign(mockChapterDoc, update);
                return mockChapterDoc;
            }),
            incrementalModify: vi.fn().mockImplementation(async (cb) => {
                const update = cb(mockChapterDoc);
                Object.assign(mockChapterDoc, update);
                return mockChapterDoc;
            }),
            toJSON: () => mockChapterDoc
        };

        mockRawFileDoc = {
            data: btoa('dummy zip content') // This won't be a valid zip, but we'll mock JSZip load
        };

        mockDb = {
            raw_files: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockRawFileDoc)
                })
            },
            chapters: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue(mockChapterDoc)
                })
            },
            books: {
                findOne: vi.fn().mockReturnValue({
                    exec: vi.fn().mockResolvedValue({
                        incrementalPatch: vi.fn()
                    })
                })
            }
        };

        vi.mocked(initDB).mockResolvedValue(mockDb as unknown as MyDatabase);

        // Mock JSZip to return a valid structure
        const mockZip = {
            files: {
                'content.opf': { async: vi.fn().mockResolvedValue('<package><manifest><item id="c1" href="c1.html"/></manifest><spine><itemref idref="c1"/></spine></package>') },
                'c1.html': { async: vi.fn().mockResolvedValue('<html><body><p>Test content</p></body></html>') }
            },
            file: vi.fn((name) => {
                if (name.endsWith('.opf')) return { async: vi.fn().mockResolvedValue('<package><manifest><item id="c1" href="c1.html"/></manifest><spine><itemref idref="c1"/></spine></package>') };
                if (name.endsWith('c1.html')) return { async: vi.fn().mockResolvedValue('<html><body><p>Test content</p></body></html>') };
                return null;
            })
        };

        // We need to mock JSZip.loadAsync
        vi.spyOn(JSZip, 'loadAsync').mockResolvedValue(mockZip as unknown as JSZip);
    });

    it('should handle document updates without conflict', async () => {
        // This test simulates the flow. The key is that the second patch call
        // should use the document returned by the first patch call if RxDB returns a new instance.
        // In our mock, we return the same instance, but in reality RxDB might return a new one.
        // To properly test the fix, we should make our mock behave like RxDB (return new instance).

        const docRev1 = { ...mockChapterDoc, _rev: '1-rev' };
        const docRev2 = { ...mockChapterDoc, status: 'processing', _rev: '2-rev' };

        // Update mock to return new instance on patch
        docRev1.patch = vi.fn().mockResolvedValue(docRev2);
        docRev1.incrementalPatch = vi.fn().mockResolvedValue(docRev2);
        docRev1.incrementalModify = vi.fn().mockResolvedValue(docRev2);

        docRev2.incrementalPatch = vi.fn().mockResolvedValue({ ...docRev2, status: 'ready', _rev: '3-rev' });
        docRev2.incrementalModify = vi.fn().mockResolvedValue({ ...docRev2, status: 'ready', _rev: '3-rev' });

        mockDb.chapters.findOne = vi.fn().mockReturnValue({
            exec: vi.fn()
                .mockResolvedValueOnce(docRev1)
                .mockResolvedValue(docRev2)
        });

        await processChaptersInBackground('book-id');

        // Verify that the first patch was called on docRev1
        expect(docRev1.patch).toHaveBeenCalled();

        // Verify that the second patch was called on docRev2 (the result of the first patch)
        // If the code is buggy, it will call patch on docRev1 again or fail to use docRev2
        expect(docRev2.incrementalPatch).toHaveBeenCalled();
    });
});
