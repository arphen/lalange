import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    StructureDiscoveryRegistry,
    createAISelectedStructureStrategy,
    defaultStructureDiscoveryRegistry,
    documentHeadingsStrategy,
    publisherNavigationStrategy,
    sourceUnitsStrategy,
    validateStructureProposal,
} from './structureStrategies';

const { brokerExecute } = vi.hoisted(() => ({ brokerExecute: vi.fn() }));
vi.mock('../ai/broker', () => ({
    localAIBroker: {
        execute: brokerExecute,
    },
}));

const input = {
    bookId: 'book-1',
    sourceHash: 'source-1',
    units: [
        { id: 'unit-1', ordinal: 0, title: 'One', text: 'First' },
        { id: 'unit-2', ordinal: 1, title: 'Two', text: 'Second' },
    ],
    navigationEntries: [
        { id: 'nav-1', title: 'One', sourceUnitId: 'unit-1' },
        { id: 'nav-2', title: 'Two', sourceUnitId: 'unit-2' },
    ],
    headings: [
        { id: 'heading-1', sourceUnitId: 'unit-1', title: 'One', level: 1, startOffset: 0 },
        { id: 'heading-2', sourceUnitId: 'unit-2', title: 'Two', level: 1, startOffset: 0 },
    ],
};

describe('structure discovery strategies', () => {
    beforeEach(() => vi.clearAllMocks());

    it('keeps deterministic auto selection independent from format readers', () => {
        const registry = new StructureDiscoveryRegistry([
            publisherNavigationStrategy,
            documentHeadingsStrategy,
            sourceUnitsStrategy,
        ]);
        expect(registry.resolve(input).id).toBe('publisher-navigation');
        expect(registry.getById('document-headings')?.kind).toBe('deterministic');
        expect(defaultStructureDiscoveryRegistry.getById('ai-assisted-candidates')?.kind).toBe('ai-assisted');
    });

    it('emits only source-anchored deterministic boundaries', async () => {
        const result = await documentHeadingsStrategy.discover(input, { signal: new AbortController().signal });
        expect(result.boundaries).toEqual([
            expect.objectContaining({ sourceAnchorId: 'unit-1', titleSourceAnchorId: 'heading-1' }),
            expect.objectContaining({ sourceAnchorId: 'unit-2', titleSourceAnchorId: 'heading-2' }),
        ]);
        expect((await sourceUnitsStrategy.discover(input, { signal: new AbortController().signal })).boundaries).toHaveLength(2);
    });

    it('rejects duplicate or non-monotonic boundaries', () => {
        const result = validateStructureProposal(input, {
            pluginId: 'test',
            pluginVersion: '1',
            boundaries: [
                { sourceAnchorId: 'unit-2', evidence: ['test'], confidence: 0.5 },
                { sourceAnchorId: 'unit-1', evidence: ['test'], confidence: 0.5 },
            ],
            issues: [],
        });
        expect(result.boundaries).toHaveLength(1);
        expect(result.issues).toContain('proposal contains unknown, duplicate, or non-monotonic boundaries');
    });

    it('lets the AI strategy select only existing heading candidates', async () => {
        brokerExecute.mockImplementation(async (_options: unknown, task: (engine: unknown) => Promise<unknown>) => task({
            chat: {
                completions: {
                    create: vi.fn().mockResolvedValue({
                        choices: [{ message: { content: '{"boundarySourceAnchorIds":["heading-2"]}' } }],
                    }),
                },
            },
        }));
        const strategy = createAISelectedStructureStrategy('qwen');
        const result = await strategy.discover(input, { signal: new AbortController().signal });

        expect(result.boundaries).toEqual([
            expect.objectContaining({ sourceAnchorId: 'unit-2', titleSourceAnchorId: 'heading-2' }),
        ]);
        expect(result.boundaries[0]?.sourceAnchorId).toBe('unit-2');
    });

    it('fails explicitly when a requested strategy is unavailable', () => {
        const registry = new StructureDiscoveryRegistry([sourceUnitsStrategy]);

        expect(() => registry.resolve(input, 'document-headings')).toThrow(
            'Structure strategy is unavailable: document-headings',
        );
    });
});
