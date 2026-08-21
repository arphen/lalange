export interface PdfBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export type PdfTextDirection = 'ltr' | 'rtl' | 'ttb';

export interface PdfLayoutWord {
    id: string;
    pageNumber: number;
    text: string;
    box: PdfBox;
    baseline: number;
    confidence?: number;
    fontName?: string;
    fontSize?: number;
    direction: PdfTextDirection;
    source: 'embedded' | 'ocr';
    sourceBlockId?: string;
    sourceLineId?: string;
}

export interface PdfLayoutLine {
    id: string;
    pageNumber: number;
    words: PdfLayoutWord[];
    box: PdfBox;
    baseline: number;
    medianWordHeight: number;
    text: string;
    columnIndex?: number;
}

export interface PdfLayoutBlock {
    id: string;
    pageNumber: number;
    lines: PdfLayoutLine[];
    box: PdfBox;
    columnIndex?: number;
    text: string;
}

export type PdfRegionRole =
    | 'body'
    | 'footnote'
    | 'endnote'
    | 'marginal-note'
    | 'caption'
    | 'heading'
    | 'running-furniture'
    | 'figure'
    | 'unknown';

export interface PdfLayoutRegion {
    id: string;
    pageNumber: number;
    role: PdfRegionRole;
    lines: PdfLayoutLine[];
    box: PdfBox;
    columnIndex?: number;
    confidence: number;
    evidence: string[];
    text: string;
}

export interface PdfLayoutPage {
    pageNumber: number;
    lines: PdfLayoutLine[];
    blocks: PdfLayoutBlock[];
    regions: PdfLayoutRegion[];
    bodyOrder: string[];
}

export interface PdfLayoutResult {
    pages: PdfLayoutPage[];
    lines: PdfLayoutLine[];
    blocks: PdfLayoutBlock[];
    regions: PdfLayoutRegion[];
    bodyOrder: string[];
}

export const PDF_LAYOUT_TOLERANCES = {
    lineBaselineFactor: 0.65,
    lineGapFactor: 4,
    lineOverlapRatio: 0.3,
    blockGapFactor: 1.75,
    blockOverlapRatio: 0.25,
    minimumColumnGutter: 0.08,
    minimumColumnLines: 2,
    fullWidthLineRatio: 0.7,
} as const;

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));

const median = (values: number[]): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
};

const boxWidth = (box: PdfBox): number => Math.max(0, box.x1 - box.x0);
const boxHeight = (box: PdfBox): number => Math.max(0, box.y1 - box.y0);

const unionBoxes = (boxes: PdfBox[]): PdfBox => ({
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
});

const verticalOverlapRatio = (left: PdfBox, right: PdfBox): number => {
    const overlap = Math.max(0, Math.min(left.y1, right.y1) - Math.max(left.y0, right.y0));
    return overlap / Math.max(1e-9, Math.min(boxHeight(left), boxHeight(right)));
};

const horizontalGap = (line: PdfLayoutLine, word: PdfLayoutWord): number => {
    if (word.box.x0 >= line.box.x1) return word.box.x0 - line.box.x1;
    if (line.box.x0 >= word.box.x1) return line.box.x0 - word.box.x1;
    return 0;
};

const lineWordSort = (left: PdfLayoutWord, right: PdfLayoutWord): number => {
    if (left.direction === 'rtl') return right.box.x1 - left.box.x1 || left.id.localeCompare(right.id);
    if (left.direction === 'ttb') return left.box.y0 - right.box.y0 || left.id.localeCompare(right.id);
    return left.box.x0 - right.box.x0 || left.id.localeCompare(right.id);
};

const joinLineText = (words: PdfLayoutWord[]): string => {
    let text = '';
    for (const word of words) {
        const value = word.text.replace(/\s+/g, ' ').trim();
        if (!value) continue;
        const needsSpace = text.length > 0
            && !/\s$/.test(text)
            && !/^[,.;:!?%)\]}]/.test(value)
            && !/[([{\-‐‑­/]$/.test(text);
        text += `${needsSpace ? ' ' : ''}${value}`;
    }
    return text;
};

export const normalizePdfBox = (box: PdfBox, pageWidth: number, pageHeight: number): PdfBox => {
    if (!(pageWidth > 0) || !(pageHeight > 0)) throw new Error('PDF page dimensions must be positive.');
    const x0 = Math.min(box.x0, box.x1) / pageWidth;
    const y0 = Math.min(box.y0, box.y1) / pageHeight;
    const x1 = Math.max(box.x0, box.x1) / pageWidth;
    const y1 = Math.max(box.y0, box.y1) / pageHeight;
    return {
        x0: clampUnit(x0),
        y0: clampUnit(y0),
        x1: clampUnit(x1),
        y1: clampUnit(y1),
    };
};

export const normalizePdfLayoutWord = (
    word: PdfLayoutWord,
    pageWidth: number,
    pageHeight: number,
): PdfLayoutWord => ({
    ...word,
    box: normalizePdfBox(word.box, pageWidth, pageHeight),
    baseline: clampUnit(word.baseline / pageHeight),
});

const buildLine = (pageNumber: number, words: PdfLayoutWord[], index: number): PdfLayoutLine => {
    const orderedWords = [...words].sort(lineWordSort);
    return {
        id: `p${pageNumber}-l${index}`,
        pageNumber,
        words: orderedWords,
        box: unionBoxes(orderedWords.map((word) => word.box)),
        baseline: median(orderedWords.map((word) => word.baseline)),
        medianWordHeight: median(orderedWords.map((word) => boxHeight(word.box))),
        text: joinLineText(orderedWords),
    };
};

const canJoinLine = (line: PdfLayoutLine, word: PdfLayoutWord, pageMedianHeight: number): boolean => {
    if (word.direction !== line.words[0]?.direction) return false;
    const baselineDistance = Math.abs(line.baseline - word.baseline);
    const baselineLimit = Math.max(pageMedianHeight * PDF_LAYOUT_TOLERANCES.lineBaselineFactor, 0.002);
    const gapLimit = Math.max(pageMedianHeight * PDF_LAYOUT_TOLERANCES.lineGapFactor, 0.025);
    return baselineDistance <= baselineLimit
        && verticalOverlapRatio(line.box, word.box) >= PDF_LAYOUT_TOLERANCES.lineOverlapRatio
        && horizontalGap(line, word) <= gapLimit;
};

export const clusterPdfLines = (words: PdfLayoutWord[]): PdfLayoutLine[] => {
    const linesByPage = new Map<number, PdfLayoutLine[]>();
    const pageNumbers = [...new Set(words.map((word) => word.pageNumber))].sort((left, right) => left - right);

    for (const pageNumber of pageNumbers) {
        const pageWords = words
            .filter((word) => word.pageNumber === pageNumber && word.text.trim())
            .sort((left, right) => left.baseline - right.baseline || left.box.x0 - right.box.x0 || left.id.localeCompare(right.id));
        const pageMedianHeight = median(pageWords.map((word) => boxHeight(word.box)));
        const lines: PdfLayoutLine[] = [];

        for (const word of pageWords) {
            const candidate = lines
                .filter((line) => canJoinLine(line, word, pageMedianHeight))
                .sort((left, right) => Math.abs(left.baseline - word.baseline) - Math.abs(right.baseline - word.baseline))[0];
            if (candidate) {
                candidate.words.push(word);
                candidate.words.sort(lineWordSort);
                candidate.box = unionBoxes(candidate.words.map((item) => item.box));
                candidate.baseline = median(candidate.words.map((item) => item.baseline));
                candidate.medianWordHeight = median(candidate.words.map((item) => boxHeight(item.box)));
                candidate.text = joinLineText(candidate.words);
            } else {
                lines.push(buildLine(pageNumber, [word], lines.length));
            }
        }

        const orderedLines = lines
            .sort((left, right) => left.baseline - right.baseline || left.box.x0 - right.box.x0 || left.id.localeCompare(right.id))
            .map((line, index) => ({ ...line, id: `p${pageNumber}-l${index}` }));
        linesByPage.set(pageNumber, orderedLines);
    }

    return pageNumbers.flatMap((pageNumber) => linesByPage.get(pageNumber) || []);
};

interface PdfGutter {
    left: number;
    right: number;
}

const findColumnGutter = (lines: PdfLayoutLine[]): PdfGutter | undefined => {
    const candidates = lines.filter((line) => boxWidth(line.box) < PDF_LAYOUT_TOLERANCES.fullWidthLineRatio);
    let best: { gap: number; left: number; right: number } | undefined;

    for (const leftLine of candidates) {
        for (const rightLine of candidates) {
            if (leftLine.box.x1 >= rightLine.box.x0) continue;
            const gap = rightLine.box.x0 - leftLine.box.x1;
            if (gap < PDF_LAYOUT_TOLERANCES.minimumColumnGutter) continue;
            const split = (leftLine.box.x1 + rightLine.box.x0) / 2;
            const leftSupport = candidates.filter((line) => line.box.x1 <= split).length;
            const rightSupport = candidates.filter((line) => line.box.x0 >= split).length;
            if (leftSupport < PDF_LAYOUT_TOLERANCES.minimumColumnLines
                || rightSupport < PDF_LAYOUT_TOLERANCES.minimumColumnLines) continue;
            if (!best || gap > best.gap) best = { gap, left: leftLine.box.x1, right: rightLine.box.x0 };
        }
    }

    return best ? { left: best.left, right: best.right } : undefined;
};

const assignLineColumns = (lines: PdfLayoutLine[]): void => {
    const gutter = findColumnGutter(lines);
    for (const line of lines) {
        if (!gutter) {
            line.columnIndex = 0;
        } else if (line.box.x1 <= gutter.left) {
            line.columnIndex = 0;
        } else if (line.box.x0 >= gutter.right) {
            line.columnIndex = 1;
        }
    }
};

const canJoinBlock = (block: PdfLayoutBlock, line: PdfLayoutLine): boolean => {
    if (block.columnIndex !== line.columnIndex) return false;
    const lastLine = block.lines[block.lines.length - 1];
    const verticalGap = line.box.y0 - lastLine.box.y1;
    const gapLimit = Math.max(
        Math.max(lastLine.medianWordHeight, line.medianWordHeight) * PDF_LAYOUT_TOLERANCES.blockGapFactor,
        0.01,
    );
    const horizontalOverlap = Math.max(0, Math.min(block.box.x1, line.box.x1) - Math.max(block.box.x0, line.box.x0));
    const overlapRatio = horizontalOverlap / Math.max(1e-9, Math.min(boxWidth(block.box), boxWidth(line.box)));
    const leftEdgeDistance = Math.abs(block.box.x0 - line.box.x0);
    return verticalGap >= -0.002
        && verticalGap <= gapLimit
        && (overlapRatio >= PDF_LAYOUT_TOLERANCES.blockOverlapRatio || leftEdgeDistance <= 0.04);
};

const buildBlock = (pageNumber: number, lines: PdfLayoutLine[], index: number): PdfLayoutBlock => ({
    id: `p${pageNumber}-b${index}`,
    pageNumber,
    lines,
    box: unionBoxes(lines.map((line) => line.box)),
    columnIndex: lines[0].columnIndex,
    text: lines.map((line) => line.text).join('\n'),
});

export const segmentPdfBlocks = (lines: PdfLayoutLine[]): PdfLayoutBlock[] => {
    const blocksByPage = new Map<number, PdfLayoutBlock[]>();
    const pageNumbers = [...new Set(lines.map((line) => line.pageNumber))].sort((left, right) => left - right);

    for (const pageNumber of pageNumbers) {
        const pageLines = lines
            .filter((line) => line.pageNumber === pageNumber)
            .sort((left, right) => left.baseline - right.baseline || left.box.x0 - right.box.x0 || left.id.localeCompare(right.id));
        assignLineColumns(pageLines);
        const blocks: PdfLayoutBlock[] = [];

        for (const line of pageLines) {
            const candidate = blocks
                .filter((block) => canJoinBlock(block, line))
                .sort((left, right) => right.lines.length - left.lines.length)[0];
            if (candidate) {
                candidate.lines.push(line);
                candidate.box = unionBoxes(candidate.lines.map((item) => item.box));
                candidate.text = candidate.lines.map((item) => item.text).join('\n');
            } else {
                blocks.push(buildBlock(pageNumber, [line], blocks.length));
            }
        }

        const orderedBlocks = blocks
            .sort((left, right) => left.box.y0 - right.box.y0 || (left.columnIndex ?? -1) - (right.columnIndex ?? -1) || left.id.localeCompare(right.id))
            .map((block, index) => ({ ...block, id: `p${pageNumber}-b${index}` }));
        blocksByPage.set(pageNumber, orderedBlocks);
    }

    return pageNumbers.flatMap((pageNumber) => blocksByPage.get(pageNumber) || []);
};

const orderPageBlocks = (blocks: PdfLayoutBlock[]): PdfLayoutBlock[] => {
    const columns = [...new Set(blocks.map((block) => block.columnIndex).filter((column): column is number => column !== undefined))]
        .sort((left, right) => left - right);
    const columnBlocks = columns.flatMap((column) => blocks
        .filter((block) => block.columnIndex === column)
        .sort((left, right) => left.box.y0 - right.box.y0 || left.id.localeCompare(right.id)));
    const fullWidthBlocks = blocks
        .filter((block) => block.columnIndex === undefined)
        .sort((left, right) => left.box.y0 - right.box.y0 || left.id.localeCompare(right.id));
    if (columns.length === 0) return fullWidthBlocks;
    if (fullWidthBlocks.length === 0) return columnBlocks;

    const firstColumnTop = Math.min(...columnBlocks.map((block) => block.box.y0));
    const lastColumnBottom = Math.max(...columnBlocks.map((block) => block.box.y1));
    const leading = fullWidthBlocks.filter((block) => block.box.y1 <= firstColumnTop);
    const trailing = fullWidthBlocks.filter((block) => block.box.y0 >= lastColumnBottom);
    const middle = fullWidthBlocks.filter((block) => !leading.includes(block) && !trailing.includes(block));
    return [...leading, ...columnBlocks, ...middle, ...trailing];
};

export const resolvePdfLayout = (words: PdfLayoutWord[]): PdfLayoutResult => {
    const lines = clusterPdfLines(words);
    const blocks = segmentPdfBlocks(lines);
    const pageNumbers = [...new Set(words.map((word) => word.pageNumber))].sort((left, right) => left - right);
    const pages = pageNumbers.map((pageNumber) => {
        const pageLines = lines.filter((line) => line.pageNumber === pageNumber);
        const pageBlocks = orderPageBlocks(blocks.filter((block) => block.pageNumber === pageNumber));
        const regions = pageBlocks.map<PdfLayoutRegion>((block) => ({
            id: block.id.replace('-b', '-r'),
            pageNumber,
            role: 'body',
            lines: block.lines,
            box: block.box,
            columnIndex: block.columnIndex,
            confidence: 1,
            evidence: ['initial-layout-pass'],
            text: block.text,
        }));
        return {
            pageNumber,
            lines: pageLines,
            blocks: pageBlocks,
            regions,
            bodyOrder: pageBlocks.map((block) => block.id),
        };
    });
    const orderedBlocks = pages.flatMap((page) => page.blocks);
    const orderedRegions = pages.flatMap((page) => page.regions);
    return {
        pages,
        lines,
        blocks: orderedBlocks,
        regions: orderedRegions,
        bodyOrder: orderedBlocks.map((block) => block.id),
    };
};