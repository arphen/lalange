/**
 * Gets the display name for a subchapter:
 * - Always uses first 5 words of chunk content with ellipsis when content is available
 * - Falls back to title only if content is not yet loaded
 */
export const getSubchapterDisplayName = (
    sub: { title: string; startWordIndex: number; endWordIndex: number },
    chapterContent: string[] | undefined
): string => {
    // Always show first words if content is available for this subchapter
    if (chapterContent && chapterContent.length > sub.startWordIndex) {
        const chunkWords = chapterContent.slice(sub.startWordIndex, Math.min(sub.startWordIndex + 5, sub.endWordIndex));
        if (chunkWords.length > 0) {
            return chunkWords.join(' ') + '...';
        }
    }
    return sub.title;
};

/**
 * Calculate summary progress for a subchapter
 * Returns: 0 = not started, 0.5 = in progress (density done, no summary), 1 = complete
 */
export const getSummaryProgress = (densityProgress: number, hasSummary: boolean): number => {
    if (hasSummary) return 1;
    if (densityProgress >= 1) return 0.5; // Density done, summary in progress
    return 0;
};
