import type JSZip from 'jszip';
import type { ChapterSlice, EpubStructurePlan, LoadedChapterSlice } from '../structure';
import { stripFileExtension } from './utils';
import type { IngestReaderPlugin, ReaderPreparedBook, ReaderResolvedChapter } from './types';

const EPUB_MIME_TYPES = ['application/epub+zip'];
const EPUB_EXTENSIONS = ['epub'];

export interface EpubReaderDependencies {
    loadZip: (input: File | Uint8Array) => Promise<JSZip>;
    buildEpubStructurePlan: (zip: JSZip) => Promise<EpubStructurePlan>;
    loadPlannedChapterSources: (
        zip: JSZip,
        slices: ChapterSlice[],
    ) => Promise<LoadedChapterSlice[]>;
}

export class EpubIngestReader implements IngestReaderPlugin {
    public readonly id = 'epub';

    public readonly displayName = 'EPUB';

    public readonly extensions = EPUB_EXTENSIONS;

    public readonly mimeTypes = EPUB_MIME_TYPES;

    private readonly dependencies: EpubReaderDependencies;

    public constructor(dependencies: EpubReaderDependencies) {
        this.dependencies = dependencies;
    }

    public acceptsFile(file: File): boolean {
        const lowerName = file.name.toLowerCase();
        const normalizedMime = file.type.split(';')[0]?.trim().toLowerCase() || '';
        return normalizedMime === 'application/epub+zip' || lowerName.endsWith('.epub');
    }

    public supportsRaw(data: Uint8Array): boolean {
        return data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
    }

    public async prepareInitial(file: File, onProgress?: (message: string) => void): Promise<ReaderPreparedBook> {
        onProgress?.('Analyzing EPUB structure...');
        const zip = await this.dependencies.loadZip(file);
        const structure = await this.dependencies.buildEpubStructurePlan(zip);

        onProgress?.('Extracting images...');
        const images: ReaderPreparedBook['images'] = [];
        const imageFiles = Object.keys(zip.files).filter((path) => /\.(jpg|jpeg|png|gif|webp)$/i.test(path));

        for (const imgPath of imageFiles) {
            const entry = zip.file(imgPath);
            if (!entry) continue;

            const imgData = await entry.async('base64');
            const filename = imgPath.split('/').pop() || imgPath;
            const ext = filename.split('.').pop()?.toLowerCase();
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;

            images.push({
                filename,
                data: imgData,
                mimeType,
            });
        }

        let coverBase64 = '';
        const coverHref = structure.coverManifestId
            ? structure.manifest[structure.coverManifestId]?.href
            : undefined;
        if (coverHref) {
            const coverFilename = coverHref.split('/').pop();
            const coverImg = images.find((img) => img.filename === coverFilename);
            if (coverImg) {
                coverBase64 = `data:${coverImg.mimeType};base64,${coverImg.data}`;
            }
        }

        const fallbackTitle = stripFileExtension(file.name);
        return {
            title: structure.title || fallbackTitle,
            author: structure.author || 'Unknown',
            coverBase64,
            images,
            chapters: structure.chapters.map((chapter) => ({
                title: chapter.title,
                source: chapter.source,
                structureOwnership: chapter.structureOwnership,
                reformationReason: chapter.reformationReason,
                boundaryEvidence: chapter.boundaryEvidence,
                authoredGroupTitle: chapter.authoredGroupTitle,
                originalTitles: chapter.originalTitles,
            })),
            structureVersion: structure.structureVersion,
            structureMode: structure.structureMode,
        };
    }

    public async loadChapters(rawData: Uint8Array): Promise<ReaderResolvedChapter[]> {
        const zip = await this.dependencies.loadZip(rawData);
        const structure = await this.dependencies.buildEpubStructurePlan(zip);

        const chapters: ReaderResolvedChapter[] = [];
        for (const chapter of structure.chapters) {
            const chapterSources = await this.dependencies.loadPlannedChapterSources(zip, chapter.slices);
            chapters.push({
                title: chapter.title,
                source: chapter.source,
                structureOwnership: chapter.structureOwnership,
                reformationReason: chapter.reformationReason,
                boundaryEvidence: chapter.boundaryEvidence,
                authoredGroupTitle: chapter.authoredGroupTitle,
                originalTitles: chapter.originalTitles,
                slices: chapterSources.map((source) => ({
                    text: source.text,
                    html: source.html,
                })),
            });
        }

        return chapters;
    }
}
