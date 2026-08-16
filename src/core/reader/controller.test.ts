import { describe, expect, it, vi } from 'vitest';
import { createReaderSessionControllerForBook } from './controller';

describe('Reader session controller', () => {
    it('publishes semantic changes and stops publishing after disposal', () => {
        const controller = createReaderSessionControllerForBook('book-1', 'chapter-1');
        const listener = vi.fn();
        const unsubscribe = controller.subscribe(listener);

        controller.dispatch({ type: 'play', transport: 'rsvp' });
        controller.dispatch({ type: 'play', transport: 'rsvp' });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(controller.getSnapshot()).toMatchObject({ transport: 'rsvp', playing: true });

        unsubscribe();
        controller.dispatch({ type: 'pause' });
        expect(listener).toHaveBeenCalledTimes(1);

        controller.dispose();
        controller.dispatch({ type: 'play', transport: 'tts' });
        expect(controller.getSnapshot()).toMatchObject({ transport: 'rsvp', playing: false });
    });

    it('allows a late subscriber to unsubscribe independently', () => {
        const controller = createReaderSessionControllerForBook('book-1', 'chapter-1');
        const firstListener = vi.fn();
        const secondListener = vi.fn();
        controller.subscribe(firstListener);
        const unsubscribeSecond = controller.subscribe(secondListener);

        unsubscribeSecond();
        controller.dispatch({ type: 'seek', chapterId: 'chapter-2', wordIndex: 4 });

        expect(firstListener).toHaveBeenCalledTimes(1);
        expect(secondListener).not.toHaveBeenCalled();
    });

    it('cancels session sequences when disposed', async () => {
        const controller = createReaderSessionControllerForBook('book-1', 'chapter-1');
        const pending = controller.createSequence().delay(100);

        controller.dispose();

        await expect(pending).resolves.toBe(false);
    });
});