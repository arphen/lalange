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
                            // Density is lightweight (tiny model) so we can do more up-front than summaries.
                            // All other chapters start dormant and wake up when the user navigates there.
                            const isActiveChapter = isFirstContentChapter;
                            const INITIAL_DENSITY_CHUNKS = 3;
                            const INITIAL_SUMMARY_CHUNKS = 3;
                            const densityInitialStatus = (isActiveChapter && i < INITIAL_DENSITY_CHUNKS) ? 'pending' : 'dormant';
                            const summaryInitialStatus = (isActiveChapter && i < INITIAL_SUMMARY_CHUNKS) ? 'pending' : 'dormant';

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

                            // 2. Summarization
                            scheduler.addTask({
                                id: `${chapterId}_summary_${i}`,
                                bookId,
                                chapterId,
                                subchapterIndex: i,
                                startWordIndex,
                                endWordIndex,
                                type: 'SUMMARY',
                                text: chunk
                            }, summaryInitialStatus);
                        }
                        const INITIAL_DENSITY_CHUNKS = 3;
                        const INITIAL_SUMMARY_CHUNKS = 3;
                        const activeDensity = isFirstContentChapter ? Math.min(rawChunks.length, INITIAL_DENSITY_CHUNKS) : 0;
                        const activeSummary = isFirstContentChapter ? Math.min(rawChunks.length, INITIAL_SUMMARY_CHUNKS) : 0;
                        const activeCount = activeDensity + activeSummary;
                        console.log(`[Pipeline] Scheduled ${rawChunks.length * 2} tasks for chapter ${chapterId} (${activeCount} active, rest dormant)`);

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
    } finally {
        activeJobs.delete(bookId);
        processingState.delete(bookId);
        console.log(`[Pipeline] Ingestion preparation complete for book: ${bookId}. Tasks have been handed off to the Scheduler.`);
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
