import { createRxDatabase } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { fingerprintValue } from '../exchange/fingerprint';
import type { MyDatabase } from '../sync/db';
import {
    activateChapterRepairBatch,
    buildChapterRepairPlan,
    prepareChapterRepairBatch,
    type RepairBatchSelection,
} from './repairBatch';
import {
    chapterSchema,
    contentRevisionSchema,
    readingStateSchema,
    repairAnnotationSchema,
    textIssueSchema,
} from '../sync/schema';
import type { TextIssueCandidate } from './anomalyScanner';

const createDatabase = async (name: string): Promise<MyDatabase> => {
    const database = await createRxDatabase({
        name,
        storage: getRxStorageDexie(),
        multiInstance: false,
    });
    await database.addCollections({
        chapters: { schema: chapterSchema },
        reading_states: { schema: readingStateSchema },
        text_issues: { schema: textIssueSchema },
        content_revisions: { schema: contentRevisionSchema },
        repair_annotations: { schema: repairAnnotationSchema },
    });
    return database as unknown as MyDatabase;
};

const makeSelection = async (
    sourceText: string,
    id: string,
    startOffset: number,
    endOffset: number,
    replacement: string,
): Promise<RepairBatchSelection> => {
    const revisionHash = await fingerprintValue(sourceText);
    const candidate: TextIssueCandidate = {
        id,
        bookId: 'book-rxdb',
        sourceUnitId: 'chapter-rxdb',
        revisionHash,
        startOffset,
        endOffset,
        originalHash: await fingerprintValue(sourceText.slice(startOffset, endOffset)),
        detectorIds: ['numeric-alphanumeric-intrusion'],
        evidence: { value: sourceText.slice(startOffset, endOffset) },
        severity: 'medium',
        ambiguity: 'high',
    };
    return {
        candidate,
        proposal: {
            candidateId: id,
            action: 'replace',
            replacement,
            reasonCode: 'ocr-substitution',
        },
    };
};

describe('repair batch RxDB recovery', () => {
    let databaseName: string;
    let database: MyDatabase | undefined;

    beforeEach(() => {
        databaseName = `repair_batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    });

    it('reopens after the chapter write and completes the prepared revision exactly once', async () => {
        const sourceText = 'one th3 h0p';
        const sourceHash = await fingerprintValue(sourceText);
        const first = await makeSelection(sourceText, 'issue-th3', 4, 7, 'the');
        const second = await makeSelection(sourceText, 'issue-h0p', 8, 11, 'hope');
        database = await createDatabase(databaseName);
        await database.chapters.insert({
            id: 'chapter-rxdb',
            bookId: 'book-rxdb',
            index: 0,
            title: 'Recovery chapter',
            status: 'ready',
            content: sourceText.split(' '),
            densities: [10, 20, 30],
            analysisData: [
                { tokens: ['one'], surprisals: [1] },
                { tokens: ['th3'], surprisals: [2] },
                { tokens: ['h0p'], surprisals: [3] },
            ],
            subchapters: [{ title: 'Part', summary: 'old', startWordIndex: 0, endWordIndex: 3 }],
        });
        await database.content_revisions.insert({
            id: 'revision-rxdb-source',
            bookId: 'book-rxdb',
            sourceUnitId: 'chapter-rxdb',
            sourceHash,
            textHash: sourceHash,
            pipelineVersion: 'ingest-v1',
            acceptedPatchIds: [],
            createdAt: 1,
            state: 'active',
        });
        await database.text_issues.bulkInsert([first.candidate, second.candidate].map((candidate) => ({
            ...candidate,
            state: 'open' as const,
            createdAt: 1,
            updatedAt: 1,
        })));
        await database.reading_states.insert({
            bookId: 'book-rxdb',
            currentChapterId: 'chapter-rxdb',
            currentWordIndex: 2,
            lastRead: 1,
            highlights: [],
        });

        const plan = await buildChapterRepairPlan({
            sourceText,
            sourceUnitId: 'chapter-rxdb',
            sourceRevisionHash: sourceHash,
            selections: [first, second],
        });
        const prepared = await prepareChapterRepairBatch({
            plan,
            sourceRevisionId: 'revision-rxdb-source',
            pipelineFingerprint: 'repair-rxdb-v1',
            validatorFingerprint: 'validator-rxdb-v1',
            acceptanceAction: 'accept-all-safe',
            database,
        });
        if (!prepared.revision) throw new Error('Expected a durable prepared revision');

        const chapter = await database.chapters.findOne('chapter-rxdb').exec();
        if (!chapter) throw new Error('Expected a persisted chapter');
        await chapter.incrementalPatch({ content: prepared.plan.finalText.split(' ') });
        await database.close();
        database = await createDatabase(databaseName);

        const recovered = await activateChapterRepairBatch(prepared, database);
        expect(recovered.nextText).toBe('one the hope');
        expect((await database.chapters.findOne('chapter-rxdb').exec())?.content).toEqual(['one', 'the', 'hope']);
        expect((await database.content_revisions.findOne(prepared.revision.id).exec())?.state).toBe('active');
        expect((await database.content_revisions.findOne('revision-rxdb-source').exec())?.state).toBe('superseded');
        expect((await database.repair_annotations.find().exec())).toHaveLength(2);
        expect((await database.text_issues.find({ selector: { state: 'accepted' } }).exec())).toHaveLength(2);

        await activateChapterRepairBatch(prepared, database);
        expect((await database.chapters.findOne('chapter-rxdb').exec())?.content).toEqual(['one', 'the', 'hope']);
        expect((await database.content_revisions.find().exec())).toHaveLength(2);
    });

    afterEach(async () => {
        if (database) {
            await database.remove();
            database = undefined;
        }
    });
});