import type { DisplayPlugin, RenderOptions } from './types';

export const renderDisplayFrame = (
    plugin: DisplayPlugin,
    tokens: readonly string[],
    options?: RenderOptions,
): string => {
    if (tokens.length <= 1) return plugin.renderWord(tokens[0] ?? '', options);

    const renderedTokens = tokens.map((token) => (
        `<span class="rsvp-frame-token">${plugin.renderWord(token, options)}</span>`
    ));
    return `<span class="rsvp-frame-group whitespace-nowrap">${renderedTokens.join('<span class="rsvp-frame-space" aria-hidden="true"> </span>')}</span>`;
};