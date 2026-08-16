import { describe, expect, it } from 'vitest';
import { projectDisplayFrame } from './model';
import { saccadePlugin } from './saccade';

describe('projectDisplayFrame', () => {
    it('projects markup-like book text as text nodes', () => {
        const container = document.createElement('div');

        expect(projectDisplayFrame(container, saccadePlugin, ['<b>safe</b>'])).toBe(true);

        expect(container.textContent).toBe('<b>safe</b>');
        expect(container.querySelector('b')).toBeNull();
    });

    it('preserves grouped frame wrappers and token text', () => {
        const container = document.createElement('div');

        projectDisplayFrame(container, saccadePlugin, ['one', 'two']);

        expect(container.querySelector('.rsvp-frame-group')).not.toBeNull();
        expect(container.querySelectorAll('.rsvp-frame-token')).toHaveLength(2);
        expect(container.textContent).toBe('one two');
    });
});
