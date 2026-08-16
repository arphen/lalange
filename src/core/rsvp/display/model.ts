import type { DisplayPlugin, DisplayWordModel, RenderOptions } from './types';

export interface DisplayFrameModel {
    tokens: DisplayWordModel[];
}

export const createDisplayFrameModel = (
    plugin: DisplayPlugin,
    tokens: readonly string[],
    options?: RenderOptions,
): DisplayFrameModel | null => {
    if (!plugin.renderWordModel) return null;

    return {
        tokens: tokens.map((token) => plugin.renderWordModel!(token, options)),
    };
};

const appendWordModel = (container: HTMLElement, model: DisplayWordModel): void => {
    for (const run of model.runs) {
        const span = document.createElement('span');
        span.textContent = run.text;
        if (run.className) span.className = run.className;
        container.appendChild(span);
        if (run.breakAfter) container.appendChild(document.createElement('br'));
    }
};

export const projectDisplayFrame = (
    container: HTMLElement,
    plugin: DisplayPlugin,
    tokens: readonly string[],
    options?: RenderOptions,
): boolean => {
    const model = createDisplayFrameModel(plugin, tokens, options);
    if (!model) return false;

    container.replaceChildren();

    if (model.tokens.length <= 1) {
        appendWordModel(container, model.tokens[0] ?? { runs: [] });
        return true;
    }

    const group = document.createElement('span');
    group.className = 'rsvp-frame-group whitespace-nowrap';

    model.tokens.forEach((token, index) => {
        if (index > 0) {
            const space = document.createElement('span');
            space.className = 'rsvp-frame-space';
            space.setAttribute('aria-hidden', 'true');
            space.textContent = ' ';
            group.appendChild(space);
        }

        const tokenContainer = document.createElement('span');
        tokenContainer.className = 'rsvp-frame-token';
        appendWordModel(tokenContainer, token);
        group.appendChild(tokenContainer);
    });

    container.appendChild(group);
    return true;
};
