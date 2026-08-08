import { describe, expect, it, vi } from 'vitest';
import { renderDisplayFrame } from './frame';
import type { DisplayPlugin } from './types';

const plugin: DisplayPlugin = {
    id: 'test',
    name: 'Test',
    description: 'Test plugin',
    renderWord: vi.fn((word) => `<b>${word}</b>`),
    renderContextWord: () => '',
    splitWord: (word) => ({ bold: word, light: '' }),
    getContainerClass: () => '',
};

describe('renderDisplayFrame', () => {
    it('preserves single-token plugin output', () => {
        expect(renderDisplayFrame(plugin, ['in'])).toBe('<b>in</b>');
    });

    it('keeps each grouped token separately styled with a stable visible space', () => {
        expect(renderDisplayFrame(plugin, ['in', 'the'])).toBe(
            '<span class="rsvp-frame-group whitespace-nowrap"><span class="rsvp-frame-token"><b>in</b></span><span class="rsvp-frame-space" aria-hidden="true"> </span><span class="rsvp-frame-token"><b>the</b></span></span>',
        );
    });
});