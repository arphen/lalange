import { initDB } from '../sync/db';
import type { TTSPosition } from '../store/tts';

export interface PersistListeningHandoffOptions {
    position: TTSPosition;
    voice: string;
    speed: number;
}

export async function persistListeningHandoff({
    position,
    voice,
    speed,
}: PersistListeningHandoffOptions): Promise<void> {
    const db = await initDB();
    const readingState = await db.reading_states.findOne(position.bookId).exec();
    const patch = {
        ttsPosition: {
            chapterId: position.chapterId,
            sentenceIndex: position.sentenceIndex,
            wordIndex: position.wordIndex,
            audioTime: position.audioTime,
            timestamp: position.timestamp,
        },
        ttsSettings: { voice, speed },
    };

    if (readingState) {
        await readingState.incrementalPatch(patch);
        return;
    }

    await db.reading_states.insert({
        bookId: position.bookId,
        currentChapterId: position.chapterId,
        currentWordIndex: position.wordIndex,
        lastRead: position.timestamp,
        highlights: [],
        ...patch,
    });
}
