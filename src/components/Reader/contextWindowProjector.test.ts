import { describe, expect, it } from 'vitest';
import { ContextWindowProjector } from './contextWindowProjector';

describe('ContextWindowProjector', () => {
    it('shifts the window by reusing existing word nodes', () => {
        const projector = new ContextWindowProjector();
        const container = document.createElement('div');
        const words = ['One.', 'two', 'three', 'four'];

        const initial = projector.project(container, words, 0, 3, { getColorClass: () => 'text-gray-400' });
        const stableWord = container.querySelector('[data-index="1"]');

        const shifted = projector.project(container, words, 1, 4, { getColorClass: () => 'text-sky-500' });
        const shiftedWord = container.querySelector('[data-index="1"]');

        expect(initial.rebuilt).toBe(true);
        expect(shifted.rebuilt).toBe(false);
        expect(shifted.createdNodes).toBe(5);
        expect(shifted.reusedWords).toBe(2);
        expect(shiftedWord).toBe(stableWord);
        expect(container.querySelector('[data-index="0"]')).toBeNull();
        expect(container.querySelector('[data-index="3"]')).toHaveTextContent('four');
        expect(container.querySelector('[data-index="1"]')).toHaveClass('text-sky-500');
        expect(container.querySelector('.w-full.h-2')).toBeNull();
    });

    it('rebuilds after external DOM replacement and keeps text inert', () => {
        const projector = new ContextWindowProjector();
        const container = document.createElement('div');
        const words = ['<strong>literal</strong>'];

        projector.project(container, words, 0, 1, { getColorClass: () => 'text-gray-400' });
        container.innerHTML = '<span>stale river</span>';

        const result = projector.project(container, words, 0, 1, { getColorClass: () => 'text-gray-400' });

        expect(result.rebuilt).toBe(true);
        expect(container).toHaveTextContent('<strong>literal</strong>');
        expect(container.querySelector('strong')).toBeNull();
        expect(container).not.toHaveTextContent('stale river');
    });

    it('rebuilds when the display model key changes', () => {
        const projector = new ContextWindowProjector();
        const container = document.createElement('div');
        const words = ['model'];

        projector.project(container, words, 0, 1, {
            getColorClass: () => 'text-gray-400',
            createWordModel: () => ({ runs: [{ text: 'model', className: 'font-bold' }] }),
            modelKey: 'plugin-a',
        });

        const result = projector.project(container, words, 0, 1, {
            getColorClass: () => 'text-gray-400',
            createWordModel: () => ({ runs: [{ text: 'model', className: 'font-light' }] }),
            modelKey: 'plugin-b',
        });

        expect(result.rebuilt).toBe(true);
        expect(container.querySelector('.font-light')).not.toBeNull();
        expect(container.querySelector('.font-bold')).toBeNull();
    });
});
