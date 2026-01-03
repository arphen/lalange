import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import PQueue from 'p-queue';
import { getPromptLogprobs } from '../ai/service';
import { initDB, type BookDocType, type ChapterDocType, type ImageDocType, type RawFileDocType } from '../sync/db';
import { removeLicenseText } from './license';
import { useSettingsStore } from '../store/settings';
import { useAIStore } from '../store/ai';
import { generateUUID } from '../../utils/uuid';
import { scheduler } from './scheduler';

// Queue for LLM processing (concurrency: 1)
const llmQueue = new PQueue({ concurrency: 1 });

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
                        const $ = cheerio.load(htmlContent);

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

                        // Apply license removal
                        rawText = removeLicenseText(rawText);
                        console.log(`[Pipeline] Chapter ${chapterIndex + 1}: Extracted ${rawText.length} chars of raw text.`);

                        // Pipeline: Clean -> Editor/Summary -> Density -> Save
                        const settings = useSettingsStore.getState();
                        const rawChunks = chunkText(rawText, settings.summaryChunkSize || 2500);
                        console.log(`[Pipeline] Chapter ${chapterIndex + 1}: Split into ${rawChunks.length} chunks for AI processing.`);
                        
                        let allWords: string[] = [];
                        let allDensities: number[] = [];
                        const subchapters: { title: string; summary: string; startWordIndex: number; endWordIndex: number }[] = [];

                        for (let i = 0; i < rawChunks.length; i++) {
                            const chunk = rawChunks[i];
                            const cleanedChunk = chunk;
                            const newWords = cleanedChunk.trim().split(/\s+/).filter(w => w.length > 0);

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
                            // Only schedule first 3 chunks of the FIRST chapter immediately.
                            // All other chapters start dormant and wake up when the user navigates there.
                            const isFirstChapter = chapterIndex === 0;
                            const initialStatus = (isFirstChapter && i < 3) ? 'pending' : 'dormant';

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
                            }, initialStatus);

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
                            }, initialStatus);
                        }
                        const activeCount = chapterIndex === 0 ? Math.min(rawChunks.length, 3) * 2 : 0;
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

export const analyzeDensityRange = async (words: string[]): Promise<number[]> => {
    const text = words.join(' ');
    const { librarianModelTier, pacingSensitivity } = useSettingsStore.getState();

    console.log(`[Pipeline] analyzeDensityRange called for ${words.length} words. Tier: ${librarianModelTier}`);

    try {
        const logprobs = await llmQueue.add(async () => {
            useAIStore.getState().setActivity('Scanning Density (Forward Pass)', librarianModelTier);
            console.log(`[Pipeline] Analyzing density for ${words.length} words using Forward Pass...`);
            try {
                return await getPromptLogprobs(text, librarianModelTier);
            } finally {
                useAIStore.getState().setActivity(null);
            }
        });

        if (!logprobs || logprobs.length === 0) {
            console.warn('[Pipeline] No logprobs returned from Forward Pass. Using default density.');
            return new Array(words.length).fill(1.0);
        }

        // === PHASE 1: Extract raw surprisal for each word ===
        const rawSurprisals: number[] = [];
        let tokenIdx = 0;

        for (const word of words) {
            let wordLogprob = 0;
            let reconstructedWord = "";

            while (tokenIdx < logprobs.length) {
                const item = logprobs[tokenIdx];
                let tokenText = "";
                let logprob = 0;

                if (typeof item === 'object' && item !== null) {
                    if (item.token) tokenText = item.token;
                    else if (item.content) tokenText = item.content || "";
                    if (item.logprob !== undefined) logprob = item.logprob;
                }

                reconstructedWord += tokenText;
                wordLogprob += logprob;
                tokenIdx++;

                const normReconstructed = reconstructedWord.replace(/\s/g, '');
                const normWord = word.replace(/\s/g, '');

                if (normReconstructed.length >= normWord.length) {
                    break;
                }
            }

            // Surprisal = -logprob (higher = more unexpected)
            rawSurprisals.push(-wordLogprob);
        }

        // Fill if mismatch
        while (rawSurprisals.length < words.length) {
            rawSurprisals.push(0);
        }

        // === PHASE 2: Calculate percentiles for relative scoring ===
        const sortedSurprisals = [...rawSurprisals].sort((a, b) => a - b);
        const getPercentile = (p: number) => {
            const idx = Math.floor((p / 100) * (sortedSurprisals.length - 1));
            return sortedSurprisals[idx];
        };

        const p10 = getPercentile(10);
        const p30 = getPercentile(30);
        const p50 = getPercentile(50);
        const p70 = getPercentile(70);
        const p90 = getPercentile(90);

        console.log(`[Pipeline] Surprisal Percentiles: P10=${p10.toFixed(2)} P30=${p30.toFixed(2)} P50=${p50.toFixed(2)} P70=${p70.toFixed(2)} P90=${p90.toFixed(2)}`);

        // === PHASE 3: Map each word to density factor using percentiles ===
        const sensitivityMult = (pacingSensitivity ?? 50) / 50;
        const densities: number[] = [];

        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            const surprisal = rawSurprisals[i];

            // Percentile-based density factor
            // This ensures variation regardless of model's baseline perplexity
            let densityFactor = 1.0;
            if (surprisal <= p10) densityFactor = 0.6;        // Bottom 10% → Fast
            else if (surprisal <= p30) densityFactor = 0.8;   // 10-30% → Brisk
            else if (surprisal <= p50) densityFactor = 1.0;   // 30-50% → Normal
            else if (surprisal <= p70) densityFactor = 1.2;   // 50-70% → Deliberate
            else if (surprisal <= p90) densityFactor = 1.5;   // 70-90% → Slow
            else densityFactor = 2.0;                          // Top 10% → Very Slow

            // Apply sensitivity multiplier (amplifies the deviation from 1.0)
            // At sensitivity 50 → no change, at 100 → double the deviation
            const deviation = densityFactor - 1.0;
            const adjustedFactor = 1.0 + (deviation * sensitivityMult);

            // Apply structural multipliers (word length)
            let structuralMultiplier = 1.0;
            if (word.length > 12) structuralMultiplier = 1.3;
            else if (word.length > 8) structuralMultiplier = 1.1;

            const finalScore = structuralMultiplier * adjustedFactor;
            const clamped = Math.max(0.5, Math.min(5.0, finalScore));

            // Debug log for tuning (sample 1%)
            if (Math.random() < 0.01) {
                console.log(`[Density] "${word}" Surp: ${surprisal.toFixed(2)} → Factor: ${clamped.toFixed(2)}`);
            }

            densities.push(clamped);
        }

        return densities;

    } catch (e) {
        console.warn('LLM failed for density analysis (Forward Pass)', e);
        return new Array(words.length).fill(1.0);
    }
};

const chunkText = (text: string, maxWords: number): string[] => {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];

    for (const word of words) {
        currentChunk.push(word);

        // Break if we exceed maxWords AND we are at a sentence boundary
        if (currentChunk.length >= maxWords && word.match(/[.!?]["']?$/)) {
            chunks.push(currentChunk.join(' '));
            currentChunk = [];
        }
    }
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }
    return chunks;
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

                const densities = await analyzeDensityRange(chunkWords);

                // Update densities
                for (let k = 0; k < densities.length; k++) {
                    if (start + k < allDensities.length) {
                        allDensities[start + k] = densities[k];
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
