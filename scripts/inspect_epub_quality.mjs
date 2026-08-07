import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createServer } from 'vite';

const inputPath = process.argv[2];
if (!inputPath) {
    console.error('Usage: node scripts/inspect_epub_quality.mjs <book.epub> [--reference=keep|compact|suppress] [--structure]');
    process.exitCode = 1;
} else {
    const referenceArgument = process.argv.find((argument) => argument.startsWith('--reference='));
    const referenceHandling = referenceArgument?.split('=')[1] || 'suppress';
    const inspectStructure = process.argv.includes('--structure');
    if (!['keep', 'compact', 'suppress'].includes(referenceHandling)) {
        throw new Error(`Unsupported reference mode: ${referenceHandling}`);
    }

    const server = await createServer({
        root: process.cwd(),
        appType: 'custom',
        logLevel: 'error',
        server: { middlewareMode: true },
    });

    try {
        const { buildEpubStructurePlan } = await server.ssrLoadModule('/src/core/ingest/structure.ts');
        const archive = await fs.readFile(path.resolve(inputPath));
        const zip = await JSZip.loadAsync(archive);
        const plan = await buildEpubStructurePlan(zip, { referenceHandling });
        if (inspectStructure) {
            console.log(JSON.stringify({ structure: plan.structureDiagnostics }));
        }
        const records = plan.contentQualityAudit.map((record) => ({
            ...record,
            zone: record.zone || 'body',
        }));
        const issueCounts = {};
        for (const record of records) {
            for (const issue of record.issues) {
                issueCounts[issue.type] = (issueCounts[issue.type] || 0) + issue.count;
            }
        }

        for (const record of records) {
            console.log(JSON.stringify(record));
        }
        console.log(JSON.stringify({
            aggregate: {
                referenceHandling,
                sourceUnits: records.length,
                decisions: records.reduce((counts, record) => {
                    counts[record.decision] = (counts[record.decision] || 0) + 1;
                    return counts;
                }, {}),
                issueCounts,
                removedCharacters: records.reduce((total, record) => total + record.removedCharacters, 0),
                rejectedUnits: plan.qualityRejections.length,
                policySkippedUnits: plan.skippedChapters.length,
            },
        }));
    } finally {
        await server.close();
    }
}
