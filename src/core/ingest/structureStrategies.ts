import { localAIBroker } from '../ai/broker';
import type { ModelTier } from '../ai/modelManifest';

export interface StructureSourceUnit {
    id: string;
    ordinal: number;
    title?: string;
    text: string;
}

export interface StructureNavigationEntry {
    id: string;
    title: string;
    sourceUnitId: string;
}

export interface StructureHeadingCandidate {
    id: string;
    sourceUnitId: string;
    title: string;
    level?: number;
    startOffset: number;
}

export interface StructureSourceDocument {
    bookId: string;
    sourceHash: string;
    units: StructureSourceUnit[];
    navigationEntries?: StructureNavigationEntry[];
    headings?: StructureHeadingCandidate[];
}

export interface StructureBoundary {
    sourceAnchorId: string;
    titleSourceAnchorId?: string;
    evidence: string[];
    confidence: number;
}

export interface StructureProposal {
    pluginId: string;
    pluginVersion: string;
    boundaries: StructureBoundary[];
    issues: string[];
}

export interface StructureDiscoveryPlugin {
    id: string;
    displayName: string;
    version: string;
    kind: 'deterministic' | 'ai-assisted';
    supports(input: StructureSourceDocument): boolean;
    discover(input: StructureSourceDocument, options: { signal: AbortSignal }): Promise<StructureProposal>;
}

const deterministicProposal = (
    pluginId: string,
    pluginVersion: string,
    boundaries: StructureBoundary[],
): StructureProposal => ({
    pluginId,
    pluginVersion,
    boundaries,
    issues: [],
});

export const publisherNavigationStrategy: StructureDiscoveryPlugin = {
    id: 'publisher-navigation',
    displayName: 'Publisher navigation',
    version: '1',
    kind: 'deterministic',
    supports: (input) => (input.navigationEntries?.length ?? 0) > 0,
    discover: async (input) => deterministicProposal(
        'publisher-navigation',
        '1',
        (input.navigationEntries ?? []).map((entry) => ({
            sourceAnchorId: entry.sourceUnitId,
            titleSourceAnchorId: entry.id,
            evidence: ['publisher-navigation'],
            confidence: 1,
        })),
    ),
};

export const documentHeadingsStrategy: StructureDiscoveryPlugin = {
    id: 'document-headings',
    displayName: 'Document headings',
    version: '1',
    kind: 'deterministic',
    supports: (input) => (input.headings?.length ?? 0) > 0,
    discover: async (input) => deterministicProposal(
        'document-headings',
        '1',
        (input.headings ?? []).map((heading) => ({
            sourceAnchorId: heading.sourceUnitId,
            titleSourceAnchorId: heading.id,
            evidence: ['document-heading', ...(heading.level ? [`heading-level:${heading.level}`] : [])],
            confidence: heading.level === undefined ? 0.8 : 0.9,
        })),
    ),
};

export const sourceUnitsStrategy: StructureDiscoveryPlugin = {
    id: 'source-units',
    displayName: 'Source units',
    version: '1',
    kind: 'deterministic',
    supports: (input) => input.units.length > 0,
    discover: async (input) => deterministicProposal(
        'source-units',
        '1',
        [...input.units]
            .sort((left, right) => left.ordinal - right.ordinal)
            .map((unit) => ({
                sourceAnchorId: unit.id,
                evidence: ['source-unit'],
                confidence: 0.5,
            })),
    ),
};

const parseAISelection = (response: string): string[] => {
    const parsed: unknown = JSON.parse(response);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Structure response must be a JSON object');
    }
    const boundaries = (parsed as { boundarySourceAnchorIds?: unknown }).boundarySourceAnchorIds;
    if (!Array.isArray(boundaries) || boundaries.some((id) => typeof id !== 'string')) {
        throw new Error('Structure response must contain boundarySourceAnchorIds');
    }
    return boundaries;
};

export const validateStructureProposal = (
    input: StructureSourceDocument,
    proposal: StructureProposal,
): StructureProposal => {
    const validUnitIds = new Set(input.units.map((unit) => unit.id));
    const seen = new Set<string>();
    let previousOrdinal = -1;
    const boundaries = proposal.boundaries.filter((boundary) => {
        const unit = input.units.find((candidate) => candidate.id === boundary.sourceAnchorId);
        const anchorKey = `${boundary.sourceAnchorId}|${boundary.titleSourceAnchorId || ''}`;
        const sharesSourceUnit = unit?.ordinal === previousOrdinal;
        if (
            !unit
            || seen.has(anchorKey)
            || unit.ordinal < previousOrdinal
            || (sharesSourceUnit && !boundary.titleSourceAnchorId)
        ) return false;
        seen.add(anchorKey);
        previousOrdinal = unit.ordinal;
        return true;
    });
    const issues = [...proposal.issues];
    if (boundaries.length !== proposal.boundaries.length) issues.push('proposal contains unknown, duplicate, or non-monotonic boundaries');
    if (boundaries.some((boundary) => !validUnitIds.has(boundary.sourceAnchorId))) issues.push('proposal contains an unanchored boundary');
    return { ...proposal, boundaries, issues };
};

export const createAISelectedStructureStrategy = (modelTier: ModelTier): StructureDiscoveryPlugin => ({
    id: 'ai-assisted-candidates',
    displayName: 'AI-assisted candidates',
    version: '1',
    kind: 'ai-assisted',
    supports: (input) => input.units.length > 0 && (input.headings?.length ?? 0) > 0,
    discover: async (input, { signal }) => {
        const candidates = (input.headings ?? []).map((heading) => ({
            id: heading.id,
            sourceUnitId: heading.sourceUnitId,
            title: heading.title,
            level: heading.level,
        }));
        const result = await localAIBroker.execute(
            {
                feature: 'structure',
                modelTier,
                signal,
                priority: 80,
                dedupeKey: `structure:${input.bookId}:${input.sourceHash}:${modelTier}`,
            },
            async (engine) => await engine.chat.completions.create({
                messages: [
                    {
                        role: 'system',
                        content: 'Select existing structure candidates. Return strict JSON: {"boundarySourceAnchorIds":["..."]}. Invent no IDs.',
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({ candidates }),
                    },
                ],
                temperature: 0,
                max_tokens: 256,
            }),
        );
        const response = result.choices[0]?.message.content;
        if (!response) throw new Error('Structure model returned an empty response');
        const selectedIds = new Set(parseAISelection(response));
        const proposal = deterministicProposal(
            'ai-assisted-candidates',
            '1',
            candidates
                .filter((candidate) => selectedIds.has(candidate.id))
                .map((candidate) => ({
                    sourceAnchorId: candidate.sourceUnitId,
                    titleSourceAnchorId: candidate.id,
                    evidence: ['ai-selected-existing-heading'],
                    confidence: 0.5,
                })),
        );
        return validateStructureProposal(input, proposal);
    },
});

export class StructureDiscoveryRegistry {
    private readonly plugins: StructureDiscoveryPlugin[];

    constructor(plugins: StructureDiscoveryPlugin[]) {
        if (plugins.length === 0) throw new Error('StructureDiscoveryRegistry requires at least one plugin.');
        this.plugins = [...plugins];
    }

    getAll(): StructureDiscoveryPlugin[] {
        return [...this.plugins];
    }

    getById(id: string): StructureDiscoveryPlugin | undefined {
        return this.plugins.find((plugin) => plugin.id === id);
    }

    resolve(input: StructureSourceDocument, requestedId = 'auto-deterministic'): StructureDiscoveryPlugin {
        if (requestedId !== 'auto-deterministic') {
            const requested = this.getById(requestedId);
            if (!requested || !requested.supports(input)) throw new Error(`Structure strategy is unavailable: ${requestedId}`);
            return requested;
        }
        return this.plugins.find((plugin) => plugin.kind === 'deterministic' && plugin.supports(input))
            ?? sourceUnitsStrategy;
    }
}

export const defaultStructureDiscoveryRegistry = new StructureDiscoveryRegistry([
    publisherNavigationStrategy,
    documentHeadingsStrategy,
    sourceUnitsStrategy,
    createAISelectedStructureStrategy('qwen'),
]);
