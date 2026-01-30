import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { initDB, type BookDocType, type ChapterDocType, type ImageDocType, type RawFileDocType } from '../sync/db';
import { cleanHtmlBeforeExtraction } from './license';
import { classifyChapter, cleanText } from './cleaning';
import { tokenizeForRSVP } from '../rsvp/tokenize';
import { useSettingsStore } from '../store/settings';
import { generateUUID } from '../../utils/uuid';
import { scheduler } from './scheduler';
import { analyzeDensityRange, chunkText } from './analysis';

// Job control
const activeJobs = new Set<string>();
const processingState = new Map<string, { stopped: boolean }>();

export const stopProcessing = (bookId: string) => {
    const state = processingState.get(bookId);
    if (state) {
        state.stopped = true;
        console.log(`[Pipeline] Stop signal received for book ${bookId}`);
    }
    // Also cancel any pending scheduler tasks
    scheduler.removeTasksForBook(bookId);
};

export const isProcessing = (bookId: string) => activeJobs.has(bookId);

export interface InitialIngestResult {
    book: BookDocType;
    chapters: ChapterDocType[];
    images: ImageDocType[];
    rawFile: RawFileDocType;
}

export const initialIngest = async (file: File, onProgress?: (msg: string) => void): Promise<InitialIngestResult> => {
    console.log(`[Pipeline] Starting ingestion for file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    const bookId = generateUUID();
    const zip = await JSZip.loadAsync(file);

    // 1. (Skipped) Health Check - We don't block ingestion on AI readiness anymore.
    // The AI is only needed for background processing (summaries/density).
    
    // 2. Find OPF to get metadata and spine
    const opfFile = Object.keys(zip.files).find(path => path.endsWith('.opf'));
    if (!opfFile) throw new Error('Invalid EPUB: No OPF file found');
    console.log(`[Pipeline] Found OPF file: ${opfFile}`);

    const opfContent = await zip.file(opfFile)!.async('string');
    const $opf = cheerio.load(opfContent, { xmlMode: true });

    // Metadata
    const title = $opf('dc\\:title').text() || file.name.replace('.epub', '');
    const author = $opf('dc\\:creator').text() || 'Unknown';
    console.log(`[Pipeline] Metadata parsed: Title="${title}", Author="${author}"`);

    // Spine
    const spineIds: string[] = [];
    $opf('itemref').each((_, el) => {
        spineIds.push($opf(el).attr('idref')!);
    });
    console.log(`[Pipeline] Spine contains ${spineIds.length} items.`);

    // Manifest (ID -> Href)
    const manifest: Record<string, string> = {};
    $opf('item').each((_, el) => {
        const id = $opf(el).attr('id')!;
        const href = $opf(el).attr('href')!;
        manifest[id] = href;
    });

    // 3. Extract Images
    onProgress?.('Extracting images...');
    const images: ImageDocType[] = [];
    const imageFiles = Object.keys(zip.files).filter(path => /\.(jpg|jpeg|png|gif|webp)$/i.test(path));
    console.log(`[Pipeline] Found ${imageFiles.length} images in archive.`);

    for (const imgPath of imageFiles) {
        const imgData = await zip.file(imgPath)!.async('base64');
        const filename = imgPath.split('/').pop()!;
        const ext = filename.split('.').pop()?.toLowerCase();
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

        images.push({
            id: `${bookId}_img_${filename}`,
            bookId,
            filename,
            data: imgData,
            mimeType
        });
    }

    // Cover
    let coverBase64 = '';
    const coverMeta = $opf('meta[name="cover"]').attr('content');
    if (coverMeta && manifest[coverMeta]) {
        const coverHref = manifest[coverMeta];
        const coverFilename = coverHref.split('/').pop();
        const coverImg = images.find(img => img.filename === coverFilename);
        if (coverImg) {
            coverBase64 = `data:${coverImg.mimeType};base64,${coverImg.data}`;
        }
    }

    // 4. Create Placeholder Chapters
    const chapters: ChapterDocType[] = [];
    let chapterIndex = 0;

    for (const idref of spineIds) {
        const href = manifest[idref];
        if (!href) continue;

        chapters.push({
            id: `${bookId}_${chapterIndex}`,
            bookId,
            index: chapterIndex,
            title: `Chapter ${chapterIndex + 1}`,
            status: 'pending',
            content: []
        });
        chapterIndex++;
    }

    // 5. Prepare Raw File
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
        new Uint8Array(arrayBuffer)
            .reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    return {
        book: {
            id: bookId,
            title,
            author,
            cover: coverBase64,
            totalWords: 0,
            chapterIds: chapters.map(c => c.id)
        },
        chapters,
        images,
        rawFile: {
            id: bookId,
            data: base64
        }
    };
};

export const processChaptersInBackground = async (bookId: string) => {
    if (activeJobs.has(bookId)) {
        console.log(`[Pipeline] Job already running for book ${bookId}`);
        return;
    }
    activeJobs.add(bookId);
    processingState.set(bookId, { stopped: false });

    console.log(`[Pipeline] Starting background processing for book: ${bookId}`);
    const db = await initDB();

    try {
        const rawFileDoc = await db.raw_files.findOne(bookId).exec();
        if (!rawFileDoc) {
            console.error('Raw file not found for book', bookId);
            return;
        }

        const rawData = atob(rawFileDoc.data);
        const uint8Array = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i++) {
            uint8Array[i] = rawData.charCodeAt(i);
        }

        const zip = await JSZip.loadAsync(uint8Array);

        // Re-parse OPF to get spine/manifest
        const opfFile = Object.keys(zip.files).find(path => path.endsWith('.opf'));
        if (!opfFile) return;

        const opfContent = await zip.file(opfFile)!.async('string');
        const $opf = cheerio.load(opfContent, { xmlMode: true });

        const spineIds: string[] = [];
        $opf('itemref').each((_, el) => {
            spineIds.push($opf(el).attr('idref')!);
        });

        const manifest: Record<string, string> = {};
        $opf('item').each((_, el) => {
            const id = $opf(el).attr('id')!;
            const href = $opf(el).attr('href')!;
            manifest[id] = href;
        });

        const opfDir = opfFile.includes('/') ? opfFile.substring(0, opfFile.lastIndexOf('/') + 1) : '';

        let firstContentChapterFound = false;
        let chapterIndex = 0;
        for (const idref of spineIds) {
            const href = manifest[idref];
            if (!href) continue;

            const chapterId = `${bookId}_${chapterIndex}`;
            const chapterDoc = await db.chapters.findOne(chapterId).exec();

            // Check for stop signal
            if (processingState.get(bookId)?.stopped) {
                console.log(`[Pipeline] Stopping processing loop for book ${bookId}`);
                break;
            }

            // Resume if pending, processing (crashed), or error
            if (chapterDoc && (chapterDoc.status === 'pending' || chapterDoc.status === 'processing' || chapterDoc.status === 'error')) {
                console.log(`[Pipeline] Processing chapter ${chapterIndex + 1}/${spineIds.length}: ${chapterId}`);
                // Capture the updated document instance to avoid conflict
                const currentDoc = await chapterDoc.patch({ status: 'processing', progress: 0 });

                try {
                    const fullPath = opfDir + href;
                    let fileInZip = zip.file(fullPath);
                    if (!fileInZip) {
                        const filename = href.split('/').pop();
                        const foundPath = Object.keys(zip.files).find(p => p.endsWith(filename!));
                        if (foundPath) fileInZip = zip.file(foundPath);
                    }

                    if (fileInZip) {
                        const htmlContent = await fileInZip.async('string');
                        
                        // Step 1: Clean HTML at DOM level (remove boilerplate elements, page numbers)
                        const cleanedHtml = cleanHtmlBeforeExtraction(htmlContent);
                        const $ = cheerio.load(cleanedHtml);

                        // Extract Title if possible (h1)
                        const extractedTitle = $('h1').first().text().trim();
                        if (extractedTitle) {
                            console.log(`[Pipeline] Extracted title: "${extractedTitle}"`);
                        }

                        // Remove images to avoid artifacts
                        $('img').remove();

                        let rawText = '';
                        $('p, h1, h2, h3, h4, h5, h6, div, li, blockquote').each((_, el) => {
                            rawText += $(el).text().trim() + '\n\n';
                        });
                        if (!rawText.trim()) rawText = $('body').text();

                        // Step 2: Classify chapter (license, TOC, cover, content, etc.)
                        const classification = classifyChapter(
                            rawText,
                            htmlContent,
                            extractedTitle,
                            chapterIndex
                        );
                        console.log(`[Pipeline] Chapter ${chapterIndex + 1} classified as: ${classification.type} (confidence: ${classification.confidence.toFixed(2)})`);

                        // Step 3: Handle non-content chapters
                        if (!classification.shouldIncludeInReading) {
                            console.log(`[Pipeline] Skipping chapter ${chapterIndex + 1} (${classification.type}): ${classification.reason}`);
                            
                            // Mark chapter as skipped but store metadata
                            const latestDoc = await db.chapters.findOne(currentDoc.id).exec();
                            if (latestDoc) {
                                await latestDoc.incrementalPatch({
                                    status: 'ready',
                                    content: [], // Empty content = skipped
                                    title: extractedTitle || `${classification.type.charAt(0).toUpperCase() + classification.type.slice(1)}`,
                                    progress: 100,
                                    // Store classification metadata for potential UI display
                                    metadata: {
                                        classificationType: classification.type,
                                        classificationReason: classification.reason,
                                        licenseInfo: classification.licenseInfo,
                                        tocEntries: classification.tocEntries,
                                    }
                                });
                            }
                            chapterIndex++;
                            continue;
                        }

                        // Step 4: Apply text-level license removal and cleaning
                        const cleaningResult = cleanText(rawText, {
                            removeLicense: true,
                            removePageNumbers: true,
                            normalizeWhitespace: true,
                        });
                        rawText = cleaningResult.cleanedText;
                        
                        if (cleaningResult.metadata.pageNumbersRemoved > 0) {
                            console.log(`[Pipeline] Removed ${cleaningResult.metadata.pageNumbersRemoved} page number artifacts`);
                        }
                        if (cleaningResult.metadata.detectedLicense) {
                            console.log(`[Pipeline] Detected and removed ${cleaningResult.metadata.detectedLicense} license content`);
                        }
                        
                        console.log(`[Pipeline] Chapter ${chapterIndex + 1}: Extracted ${rawText.length} chars of cleaned text.`);

                        // Pipeline: Clean -> Editor/Summary -> Density -> Save
                        const settings = useSettingsStore.getState();
                        const rawChunks = chunkText(rawText, settings.summaryChunkSize || 2500);
                        console.log(`[Pipeline] Chapter ${chapterIndex + 1}: Split into ${rawChunks.length} chunks for AI processing.`);
                        
                        const hasContent = rawChunks.some(c => c.trim().length > 0);
                        const isFirstContentChapter = hasContent && !firstContentChapterFound;
                        if (isFirstContentChapter) {
                            firstContentChapterFound = true;
                        }

                        let allWords: string[] = [];
                        let allDensities: number[] = [];
                        const subchapters: { title: string; summary: string; startWordIndex: number; endWordIndex: number }[] = [];

                        for (let i = 0; i < rawChunks.length; i++) {
                            const chunk = rawChunks[i];
                            const cleanedChunk = chunk;
                            
                            // Tokenize for RSVP: splits on whitespace AND extracts
                            // embedded dashes (em-dash, en-dash) as standalone tokens.
                            // This ensures dashes get their own display moment in RSVP.
                            const tokenResult = tokenizeForRSVP(cleanedChunk);
                            const newWords = tokenResult.tokens;
                            
                            if (tokenResult.metadata.dashesExtracted > 0) {
                                console.log(`[Pipeline] Chapter ${chapterIndex + 1}, chunk ${i + 1}: Extracted ${tokenResult.metadata.dashesExtracted} dash tokens for RSVP`);
                            }

                            if (newWords.length === 0) continue;

                            const startWordIndex = allWords.length;
                            const endWordIndex = startWordIndex + newWords.length;

                            // --- PRE-FILL: Immediate UI Update ---
                            allWords = [...allWords, ...newWords];
                            // Use 0 as "Pending Analysis" marker
                            const chunkDefaultDensities = new Array(newWords.length).fill(0);
                            allDensities = [...allDensities, ...chunkDefaultDensities];

                            // Create placeholder subchapter
                            subchapters.push({
                                title: `Part ${i + 1}`,
                                summary: "", // Empty summary indicates pending
                                startWordIndex,
                                endWordIndex
                            });

                            // --- SCHEDULE TASKS ---
                            // Only schedule an initial window for the FIRST chapter.
                            // Density is lightweight (tiny model) so we can do more up-front.
                            // All other chapters start dormant and wake up when the user navigates there.
                            // Use time-based lookahead: enough words for 3 minutes at user's WPM
                            const isActiveChapter = isFirstContentChapter;
                            const wpm = settings.wpm || 300;
                            const INITIAL_LOOKAHEAD_MINUTES = 3;
                            const INITIAL_LOOKAHEAD_WORDS = wpm * INITIAL_LOOKAHEAD_MINUTES;
                            const MIN_INITIAL_CHUNKS = 6; // Minimum chunks for very fast readers
                            
                            // Schedule as pending if: within word lookahead OR within min chunk count
                            const isWithinWordLookahead = startWordIndex < INITIAL_LOOKAHEAD_WORDS;
                            const isWithinChunkCount = i < MIN_INITIAL_CHUNKS;
                            const densityInitialStatus = (isActiveChapter && (isWithinWordLookahead || isWithinChunkCount)) ? 'pending' : 'dormant';

                            // 1. Density Estimation
                            scheduler.addTask({
                                id: `${chapterId}_density_${i}`,
                                bookId,
                                chapterId,
                                subchapterIndex: i,
                                startWordIndex,
                                endWordIndex,
                                type: 'DENSITY',
                                text: chunk
                            }, densityInitialStatus);

                            // NOTE: Per-chunk SUMMARY tasks are deprecated in favor of global summaries
                            // We no longer schedule individual chunk summaries here.
                            // Global summaries are scheduled at the end of book processing.
                        }
                        // Calculate active density count efficiently (O(n) instead of O(n²))
                        const wpm = settings.wpm || 300;
                        let cumulativeWords = 0;
                        let activeDensity = 0;
                        for (let idx = 0; idx < rawChunks.length; idx++) {
                            const isActive = isFirstContentChapter && (cumulativeWords < wpm * 3 || idx < 6);
                            if (isActive) activeDensity++;
                            const wordsInChunk = rawChunks[idx].trim().length > 0 ? rawChunks[idx].trim().split(/\s+/).length : 0;
                            cumulativeWords += wordsInChunk;
                        }
                        console.log(`[Pipeline] Scheduled ${rawChunks.length} density tasks for chapter ${chapterId} (${activeDensity} active, rest dormant)`);

                        // Final update for this chapter (Content + Placeholders)
                        const finalDoc = await db.chapters.findOne(currentDoc.id).exec();
                        if (finalDoc) {
                            await finalDoc.incrementalPatch({
                                status: 'ready', // Ready for reading (even if pending analysis)
                                content: [...allWords],
                                densities: [...allDensities],
                                subchapters,
                                title: extractedTitle || finalDoc.title,
                                progress: 100
                            });
                        }

                        // Update book total words
                        const bookDoc = await db.books.findOne(bookId).exec();
                        if (bookDoc) {
                            await bookDoc.incrementalPatch({
                                totalWords: (bookDoc.totalWords || 0) + allWords.length
                            });
                        }
                    } else {
                        const latestDoc = await db.chapters.findOne(currentDoc.id).exec();
                        if (latestDoc) await latestDoc.incrementalPatch({ status: 'error' });
                    }
                } catch (e) {
                    console.error(`Failed to process chapter ${chapterId}`, e);
                    const latestDoc = await db.chapters.findOne(currentDoc.id).exec();
                    if (latestDoc) await latestDoc.incrementalPatch({ status: 'error' });
                }
            }
            chapterIndex++;
        }
        
        // Schedule global summaries for the entire book
        await scheduleGlobalSummaries(bookId);
        
    } finally {
        activeJobs.delete(bookId);
        processingState.delete(bookId);
        console.log(`[Pipeline] Ingestion preparation complete for book: ${bookId}. Tasks have been handed off to the Scheduler.`);
    }
};

/**
 * Schedule global summaries for a book - one summary every summaryChunkSize words
 * across the entire book (not per-chapter).
 */
export const scheduleGlobalSummaries = async (bookId: string, startFromGlobalIndex: number = 0) => {
    const db = await initDB();
    const book = await db.books.findOne(bookId).exec();
    if (!book) return;
    
    const settings = useSettingsStore.getState();
    const summaryInterval = settings.summaryChunkSize || 2500;
    const totalWords = book.totalWords || 0;
    
    if (totalWords === 0) {
        console.log(`[Pipeline] No words in book ${bookId}, skipping global summaries`);
        return;
    }
    
    // Calculate how many summaries we need
    const numSummaries = Math.ceil(totalWords / summaryInterval);
    console.log(`[Pipeline] Scheduling ${numSummaries} global summaries for book ${bookId} (${totalWords} words, interval: ${summaryInterval})`);
    
    // Build a map of global word index -> chapter ID
    let globalWordsSeen = 0;
    const chapterRanges: { chapterId: string; startGlobal: number; endGlobal: number }[] = [];
    
    for (const chapterId of book.chapterIds) {
        const chapter = await db.chapters.findOne(chapterId).exec();
        if (!chapter || !chapter.content || chapter.content.length === 0) continue;
        
        chapterRanges.push({
            chapterId,
            startGlobal: globalWordsSeen,
            endGlobal: globalWordsSeen + chapter.content.length
        });
        globalWordsSeen += chapter.content.length;
    }
    
    // Check which summaries already exist
    const existingSummaries = book.globalSummaries || [];
    const existingIndices = new Set(existingSummaries.map(s => Math.floor(s.startWordIndex / summaryInterval)));
    
    // Schedule summaries
    const INITIAL_SUMMARIES = 2; // Start with first 2 pending, rest dormant
    
    for (let i = 0; i < numSummaries; i++) {
        const globalStart = i * summaryInterval;
        const globalEnd = Math.min((i + 1) * summaryInterval, totalWords);
        
        // Skip if already exists
        if (existingIndices.has(i)) {
            console.log(`[Pipeline] Global summary ${i} already exists, skipping`);
            continue;
        }
        
        // Skip if before startFromGlobalIndex
        if (globalEnd <= startFromGlobalIndex) {
            continue;
        }
        
        // Find which chapters this summary spans
        // Use consistent inequality: start <= index < end (half-open interval)
        const startChapter = chapterRanges.find(c => c.startGlobal <= globalStart && globalStart < c.endGlobal);
        const endChapter = chapterRanges.find(c => c.startGlobal <= globalEnd - 1 && globalEnd - 1 < c.endGlobal);
        
        if (!startChapter || !endChapter) {
            console.warn(`[Pipeline] Could not find chapters for global summary ${i}`);
            continue;
        }
        
        const initialStatus = i < INITIAL_SUMMARIES ? 'pending' : 'dormant';
        
        scheduler.addGlobalSummaryTask({
            id: `${bookId}_gsummary_${i}`,
            bookId,
            summaryIndex: i,
            globalStartWordIndex: globalStart,
            globalEndWordIndex: globalEnd,
            startChapterId: startChapter.chapterId,
            endChapterId: endChapter.chapterId,
        }, initialStatus);
    }
};

/**
 * Resume incomplete density/summary analysis for a book.
 * This is called when reopening a book to re-schedule tasks that were lost
 * when the scheduler's in-memory state was cleared (page reload, etc).
 * 
 * Detection:
 * - Density incomplete: densities[i] === 0 for any word in the subchapter range
 * - Global summary incomplete: not in book.globalSummaries for that interval
 * 
 * Optimization:
 * - Chunks BEHIND the cursor are skipped entirely (user already read them)
 * - Only current + future chunks get scheduled
 */
export const resumeIncompleteAnalysis = async (bookId: string, currentChapterId?: string, currentWordIndex: number = 0) => {
    const db = await initDB();
    const book = await db.books.findOne(bookId).exec();
    if (!book) {
        console.log(`[Pipeline] Book ${bookId} not found for resume`);
        return;
    }

    // Calculate global word index from current chapter position
    let globalWordIndex = 0;
    for (const chapterId of book.chapterIds) {
        if (chapterId === currentChapterId) {
            globalWordIndex += currentWordIndex;
            break;
        }
        const chapter = await db.chapters.findOne(chapterId).exec();
        if (chapter && chapter.content) {
            globalWordIndex += chapter.content.length;
        }
    }

    // Update scheduler cursor if provided
    if (currentChapterId) {
        scheduler.setCursor(bookId, currentChapterId, currentWordIndex, globalWordIndex);
    }

    let totalScheduled = 0;
    let skippedPast = 0;
    let activeScheduled = 0;
    const LOOKAHEAD_CHUNKS = 3;

    // Track if we've passed the current chapter in the book
    let passedCurrentChapter = !currentChapterId; // If no current chapter, process all

    for (const chapterId of book.chapterIds) {
        const chapter = await db.chapters.findOne(chapterId).exec();
        if (!chapter || !chapter.subchapters || chapter.subchapters.length === 0) continue;
        if (chapter.content.length === 0) continue; // Skip empty/skipped chapters

        const densities = chapter.densities || [];
        const isCurrentChapter = chapterId === currentChapterId;
        
        // Skip chapters we've completely passed
        if (!passedCurrentChapter && !isCurrentChapter) {
            skippedPast += chapter.subchapters.length * 2; // Skip both density and summary tasks
            continue;
        }
        if (isCurrentChapter) {
            passedCurrentChapter = true;
        }

        // Find which subchapter the cursor is in
        const cursorSubchapterIndex = isCurrentChapter 
            ? chapter.subchapters.findIndex(s => currentWordIndex >= s.startWordIndex && currentWordIndex < s.endWordIndex)
            : -1;

        for (let i = 0; i < chapter.subchapters.length; i++) {
            const sub = chapter.subchapters[i];
            
            // Skip chunks BEHIND the cursor in the current chapter
            // User already read these - no point computing density
            if (isCurrentChapter && cursorSubchapterIndex >= 0 && i < cursorSubchapterIndex) {
                skippedPast += 2; // Skip both density and summary
                continue;
            }
            
            // Check if density is incomplete for this subchapter
            // Density is 0 when pending, > 0 when processed
            const subDensities = densities.slice(sub.startWordIndex, sub.endWordIndex);
            const hasPendingDensity = subDensities.length === 0 || subDensities.some(d => d === 0);
            
            // Check if summary is incomplete
            const hasPendingSummary = !sub.summary || sub.summary.trim() === '';

            if (!hasPendingDensity && !hasPendingSummary) continue; // Already complete

            // Determine status: active for current chunk + lookahead, dormant otherwise
            const distanceFromCursor = isCurrentChapter ? (i - Math.max(0, cursorSubchapterIndex)) : Infinity;
            const isNearCursor = distanceFromCursor <= LOOKAHEAD_CHUNKS;
            const initialStatus = isNearCursor ? 'pending' : 'dormant';
            if (isNearCursor) activeScheduled++;

            // We need the original text chunk to schedule tasks.
            // Since we don't store it, we reconstruct from content words.
            const chunkWords = chapter.content.slice(sub.startWordIndex, sub.endWordIndex);
            const chunkText = chunkWords.join(' ');

            if (hasPendingDensity) {
                scheduler.addTask({
                    id: `${chapterId}_density_${i}`,
                    bookId,
                    chapterId,
                    subchapterIndex: i,
                    startWordIndex: sub.startWordIndex,
                    endWordIndex: sub.endWordIndex,
                    type: 'DENSITY',
                    text: chunkText
                }, initialStatus);
                totalScheduled++;
            }

            // NOTE: Per-chunk summaries are deprecated - we use global summaries now
            // Legacy code kept for backwards compatibility with old books
            // that might still have per-chunk summary tasks
        }
    }

    // Re-schedule global summaries from current position
    await scheduleGlobalSummaries(bookId, globalWordIndex);

    if (totalScheduled > 0 || skippedPast > 0) {
        console.log(`[Pipeline] Resumed ${totalScheduled} incomplete density tasks for book ${bookId} (${activeScheduled} active, ${totalScheduled - activeScheduled} dormant, ${skippedPast} skipped past cursor)`);
    } else {
        console.log(`[Pipeline] No incomplete tasks found for book ${bookId}`);
    }
};

export const estimateBookDensity = async (bookId: string) => {
    if (activeJobs.has(bookId)) {
        console.log(`[Pipeline] Job already running for book ${bookId}`);
        return;
    }
    activeJobs.add(bookId);
    processingState.set(bookId, { stopped: false });

    console.log(`[Pipeline] Starting density estimation for book: ${bookId}`);
    const db = await initDB();

    try {
        const book = await db.books.findOne(bookId).exec();
        if (!book) return;

        for (const chapterId of book.chapterIds) {
            if (processingState.get(bookId)?.stopped) break;

            const chapterDoc = await db.chapters.findOne(chapterId).exec();
            if (!chapterDoc) continue;

            // Only process if content exists
            if (chapterDoc.content.length === 0) continue;

            console.log(`[Pipeline] Estimating density for chapter: ${chapterDoc.title}`);
            await chapterDoc.incrementalPatch({ status: 'processing' });

            const allWords = chapterDoc.content;
            const allDensities = [...(chapterDoc.densities || [])]; // Copy existing

            let localProcessedIndex = 0;
            const DENSITY_CHUNK_SIZE = 200;

            while (localProcessedIndex < allWords.length) {
                if (processingState.get(bookId)?.stopped) break;

                const start = localProcessedIndex;
                let end = Math.min(start + DENSITY_CHUNK_SIZE, allWords.length);

                // Align sentence boundary
                let lookAhead = 0;
                while (end + lookAhead < allWords.length && lookAhead < 50) {
                    const w = allWords[end + lookAhead - 1];
                    if (w.match(/[.!?]["']?$/)) {
                        end += lookAhead;
                        break;
                    }
                    lookAhead++;
                }

                const chunkWords = allWords.slice(start, end);

                const { densities } = await analyzeDensityRange(chunkWords);

                // Update densities
                for (let k = 0; k < densities.length; k++) {
                    if (start + k < allDensities.length) {
                        allDensities[start + k] = densities[k];
                        // Note: estimateBookDensity doesn't update analysisData currently in this loop logic
                        // but this function is deprecated in favor of scheduler. 
                        // If we wanted to, we would need to read/write analysisData here too.
                        // For now leaving as is since main path uses scheduler.
                    }
                }

                // Save
                const freshDoc = await db.chapters.findOne(chapterId).exec();
                if (freshDoc) {
                    await freshDoc.incrementalModify((docData) => ({
                        ...docData,
                        densities: [...allDensities]
                    }));
                }

                localProcessedIndex = end;
            }
            await chapterDoc.incrementalPatch({ status: 'ready' });
        }
    } finally {
        activeJobs.delete(bookId);
        processingState.delete(bookId);
        console.log(`[Pipeline] Density estimation finished/stopped for book: ${bookId}`);
    }
};

export interface DensityProgress {
    processedWords: number;
    totalWords: number;
    currentChapter: string;
}

/**
 * Estimate density for an entire book with progress callback.
 * Used by SyncModal to prepare book before showing QR code.
 */
export const estimateBookDensityWithProgress = async (
    bookId: string,
    onProgress?: (progress: DensityProgress) => void
) => {
    if (activeJobs.has(bookId)) {
        console.log(`[Pipeline] Job already running for book ${bookId}`);
        return;
    }
    activeJobs.add(bookId);
    processingState.set(bookId, { stopped: false });

    console.log(`[Pipeline] Starting density estimation with progress for book: ${bookId}`);
    const db = await initDB();

    try {
        const book = await db.books.findOne(bookId).exec();
        if (!book) return;

        // Calculate total words across all chapters
        const chapters: { id: string; title: string; wordCount: number }[] = [];
        let totalWords = 0;

        for (const chapterId of book.chapterIds) {
            const chapterDoc = await db.chapters.findOne(chapterId).exec();
            if (!chapterDoc || chapterDoc.content.length === 0) continue;
            chapters.push({
                id: chapterId,
                title: chapterDoc.title,
                wordCount: chapterDoc.content.length
            });
            totalWords += chapterDoc.content.length;
        }

        let globalProcessedWords = 0;

        for (const chapterInfo of chapters) {
            if (processingState.get(bookId)?.stopped) break;

            const chapterDoc = await db.chapters.findOne(chapterInfo.id).exec();
            if (!chapterDoc) continue;

            // Check if chapter already has complete density
            const existingDensities = chapterDoc.densities || [];
            const existingProcessed = existingDensities.filter(d => d > 0).length;
            if (existingProcessed >= chapterInfo.wordCount * 0.95) {
                // Already processed, skip
                globalProcessedWords += chapterInfo.wordCount;
                onProgress?.({
                    processedWords: globalProcessedWords,
                    totalWords,
                    currentChapter: chapterInfo.title
                });
                continue;
            }

            console.log(`[Pipeline] Estimating density for chapter: ${chapterInfo.title}`);
            await chapterDoc.incrementalPatch({ status: 'processing' });

            const allWords = chapterDoc.content;
            const allDensities = [...(chapterDoc.densities || new Array(allWords.length).fill(0))];
            
            // Ensure densities array is right size
            while (allDensities.length < allWords.length) {
                allDensities.push(0);
            }

            let localProcessedIndex = 0;
            const DENSITY_CHUNK_SIZE = 200;

            // Find where we left off (first 0 density)
            const startFrom = allDensities.findIndex(d => d === 0);
            if (startFrom > 0) {
                localProcessedIndex = startFrom;
                globalProcessedWords += startFrom;
            }

            while (localProcessedIndex < allWords.length) {
                if (processingState.get(bookId)?.stopped) break;

                const start = localProcessedIndex;
                let end = Math.min(start + DENSITY_CHUNK_SIZE, allWords.length);

                // Align sentence boundary
                let lookAhead = 0;
                while (end + lookAhead < allWords.length && lookAhead < 50) {
                    const w = allWords[end + lookAhead - 1];
                    if (w.match(/[.!?]["']?$/)) {
                        end += lookAhead;
                        break;
                    }
                    lookAhead++;
                }

                const chunkWords = allWords.slice(start, end);
                const { densities } = await analyzeDensityRange(chunkWords);

                // Update densities
                for (let k = 0; k < densities.length; k++) {
                    if (start + k < allDensities.length) {
                        allDensities[start + k] = densities[k];
                    }
                }

                // Save periodically
                const freshDoc = await db.chapters.findOne(chapterInfo.id).exec();
                if (freshDoc) {
                    await freshDoc.incrementalModify((docData) => ({
                        ...docData,
                        densities: [...allDensities]
                    }));
                }

                const wordsProcessed = end - start;
                globalProcessedWords += wordsProcessed;
                localProcessedIndex = end;

                onProgress?.({
                    processedWords: globalProcessedWords,
                    totalWords,
                    currentChapter: chapterInfo.title
                });
            }

            await chapterDoc.incrementalPatch({ status: 'ready' });
        }

        // Final progress update
        onProgress?.({
            processedWords: totalWords,
            totalWords,
            currentChapter: ''
        });

    } finally {
        activeJobs.delete(bookId);
        processingState.delete(bookId);
        console.log(`[Pipeline] Density estimation with progress finished/stopped for book: ${bookId}`);
    }
};
