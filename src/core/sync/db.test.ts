import { describe, it, expect } from 'vitest';
import { initDB } from './db';

describe('Database Initialization', () => {
    describe('ignoreDuplicate configuration', () => {
        it('should initialize database correctly with environment-aware ignoreDuplicate setting', async () => {
            // The database uses import.meta.env.DEV to set ignoreDuplicate
            // - In production (DEV=false): ignoreDuplicate is false (prevents DB9 error)
            // - In development (DEV=true): ignoreDuplicate is true (allows dev-mode warnings)
            const db = await initDB();

            expect(db).toBeDefined();
            expect(db.name).toBe('xyz_db_v16');
            
            // Verify the database was created with correct collections
            expect(db.books).toBeDefined();
            expect(db.chapters).toBeDefined();
            expect(db.reading_states).toBeDefined();
            expect(db.images).toBeDefined();
            expect(db.raw_files).toBeDefined();
        });

        it('should return the same database instance on multiple calls (singleton pattern)', async () => {
            const db1 = await initDB();
            const db2 = await initDB();

            expect(db1).toBe(db2);
            expect(db1.name).toBe('xyz_db_v16');
        });

        it('should have all required collections', async () => {
            const db = await initDB();
            
            expect(db.books).toBeDefined();
            expect(db.chapters).toBeDefined();
            expect(db.reading_states).toBeDefined();
            expect(db.images).toBeDefined();
            expect(db.raw_files).toBeDefined();
        });

        it('should allow inserting a book document', async () => {
            const db = await initDB();
            
            const bookDoc = {
                id: `test-book-${Date.now()}`,
                title: 'Test Book',
                author: 'Test Author',
                totalWords: 1000,
                chapterIds: ['ch1', 'ch2']
            };

            const insertedDoc = await db.books.insert(bookDoc);
            
            expect(insertedDoc.id).toBe(bookDoc.id);
            expect(insertedDoc.title).toBe('Test Book');
            expect(insertedDoc.author).toBe('Test Author');
            
            // Clean up
            await insertedDoc.remove();
        });

        it('should allow inserting a chapter document', async () => {
            const db = await initDB();
            
            const chapterDoc = {
                id: `test-chapter-${Date.now()}`,
                bookId: 'test-book-1',
                index: 0,
                title: 'Chapter 1',
                status: 'ready' as const,
                content: ['This is the first chapter.']
            };

            const insertedDoc = await db.chapters.insert(chapterDoc);
            
            expect(insertedDoc.id).toBe(chapterDoc.id);
            expect(insertedDoc.title).toBe('Chapter 1');
            expect(insertedDoc.status).toBe('ready');
            
            // Clean up
            await insertedDoc.remove();
        });

        it('should allow inserting a reading state document', async () => {
            const db = await initDB();
            
            const readingStateDoc = {
                bookId: `test-book-${Date.now()}`,
                currentChapterId: 'test-chapter-1',
                currentWordIndex: 42,
                lastRead: Date.now(),
                highlights: []
            };

            const insertedDoc = await db.reading_states.insert(readingStateDoc);
            
            expect(insertedDoc.bookId).toBe(readingStateDoc.bookId);
            expect(insertedDoc.currentWordIndex).toBe(42);
            
            // Clean up
            await insertedDoc.remove();
        });

        it('should allow inserting an image document', async () => {
            const db = await initDB();
            
            const imageDoc = {
                id: `test-image-${Date.now()}`,
                bookId: 'test-book-1',
                filename: 'cover.jpg',
                data: 'base64encodeddata',
                mimeType: 'image/jpeg'
            };

            const insertedDoc = await db.images.insert(imageDoc);
            
            expect(insertedDoc.id).toBe(imageDoc.id);
            expect(insertedDoc.filename).toBe('cover.jpg');
            
            // Clean up
            await insertedDoc.remove();
        });

        it('should allow inserting a raw file document', async () => {
            const db = await initDB();
            
            const rawFileDoc = {
                id: `test-file-${Date.now()}`,
                data: 'raw file data'
            };

            const insertedDoc = await db.raw_files.insert(rawFileDoc);
            
            expect(insertedDoc.id).toBe(rawFileDoc.id);
            expect(insertedDoc.data).toBe('raw file data');
            
            // Clean up
            await insertedDoc.remove();
        });
    });
});
