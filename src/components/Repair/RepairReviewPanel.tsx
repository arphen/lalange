import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Sparkles, X } from 'lucide-react';
import { initDB, type ChapterDocType, type TextIssueDocType } from '../../core/sync/db';
import { MODEL_INFO } from '../../core/ai/modelManifest';
import { useSettingsStore } from '../../core/store/settings';
import {
    acceptRepairProposal,
    activateRepairRevision,
    createRepairContext,
    keepRepairOriginal,
    requestRepairProposal,
} from '../../core/ingest/repair';

interface RepairReviewPanelProps {
    bookId: string;
    bookTitle: string;
    onClose: () => void;
}

const REPAIR_PIPELINE_FINGERPRINT = 'bounded-repair-v1';
const REPAIR_VALIDATOR_FINGERPRINT = 'deterministic-repair-validator-v1';

export const RepairReviewPanel: React.FC<RepairReviewPanelProps> = ({ bookId, bookTitle, onClose }) => {
    const repairSettings = useSettingsStore((state) => ({
        repairModelId: state.repairModelId,
        repairEnabled: state.textRepairMode !== 'off',
    }));
    const [issues, setIssues] = useState<TextIssueDocType[]>([]);
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
    const [busyAction, setBusyAction] = useState<'propose' | 'accept' | 'keep' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    useEffect(() => {
        let issueSubscription: { unsubscribe: () => void } | undefined;
        let chapterSubscription: { unsubscribe: () => void } | undefined;
        let cancelled = false;

        const subscribe = async () => {
            const db = await initDB();
            if (cancelled) return;
            issueSubscription = db.text_issues.find({ selector: { bookId } }).$.subscribe((documents) => {
                const nextIssues = documents
                    .map((document) => document.toJSON() as TextIssueDocType)
                    .filter((issue) => issue.state !== 'kept-original' && issue.state !== 'rejected');
                setIssues(nextIssues);
                setSelectedIssueId((current) => (
                    current && nextIssues.some((issue) => issue.id === current)
                        ? current
                        : nextIssues[0]?.id || null
                ));
            });
            chapterSubscription = db.chapters.find({ selector: { bookId }, sort: [{ index: 'asc' }] }).$.subscribe((documents) => {
                setChapters(documents.map((document) => document.toJSON() as ChapterDocType));
            });
        };

        subscribe().catch((loadError: unknown) => {
            if (!cancelled) setError((loadError as Error).message || 'Unable to load repair issues.');
        });
        return () => {
            cancelled = true;
            issueSubscription?.unsubscribe();
            chapterSubscription?.unsubscribe();
        };
    }, [bookId]);

    const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) || null;
    const selectedChapter = selectedIssue
        ? chapters.find((chapter) => chapter.id === selectedIssue.sourceUnitId)
        : undefined;
    const sourceText = selectedChapter?.content.join(' ') || '';
    const context = selectedIssue && sourceText ? createRepairContext(sourceText, selectedIssue) : null;
    const getActiveRevision = async () => {
        if (!selectedIssue) throw new Error('Select an issue first');
        const db = await initDB();
        const revisions = await db.content_revisions.find({
            selector: { bookId, sourceUnitId: selectedIssue.sourceUnitId, state: 'active' },
            sort: [{ createdAt: 'desc' }],
            limit: 1,
        }).exec();
        if (!revisions[0]) throw new Error('This chapter has no active revision. Scan it again first.');
        return revisions[0];
    };

    const handleRequestProposal = async () => {
        if (!selectedIssue || !sourceText || !repairSettings.repairEnabled) return;
        setBusyAction('propose');
        setError(null);
        setMessage('');
        try {
            const proposal = await requestRepairProposal(selectedIssue, sourceText, repairSettings.repairModelId);
            await (await initDB()).text_issues.findOne(selectedIssue.id).exec()
                .then((issue) => issue?.incrementalPatch({ proposal, state: 'open', updatedAt: Date.now() }));
            setMessage('Bounded proposal ready for review.');
        } catch (proposalError: unknown) {
            setError((proposalError as Error).message || 'The repair model could not produce a proposal.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleKeepOriginal = async () => {
        if (!selectedIssue || !sourceText) return;
        setBusyAction('keep');
        setError(null);
        setMessage('');
        try {
            const revision = await getActiveRevision();
            await keepRepairOriginal({
                candidate: selectedIssue,
                sourceText,
                revisionId: revision.id,
                pipelineFingerprint: REPAIR_PIPELINE_FINGERPRINT,
                validatorFingerprint: REPAIR_VALIDATOR_FINGERPRINT,
            });
            setMessage('Original text kept and decision recorded.');
        } catch (keepError: unknown) {
            setError((keepError as Error).message || 'The original text could not be recorded.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleAccept = async () => {
        if (!selectedIssue || !selectedIssue.proposal || !sourceText) return;
        setBusyAction('accept');
        setError(null);
        setMessage('');
        try {
            const revision = await getActiveRevision();
            const prepared = await acceptRepairProposal({
                candidate: selectedIssue,
                proposal: selectedIssue.proposal,
                sourceText,
                sourceRevisionId: revision.id,
                currentRevisionId: revision.id,
                pipelineFingerprint: REPAIR_PIPELINE_FINGERPRINT,
                validatorFingerprint: REPAIR_VALIDATOR_FINGERPRINT,
                modelFingerprint: MODEL_INFO[repairSettings.repairModelId].id,
            });
            await activateRepairRevision({
                candidate: selectedIssue,
                nextText: prepared.nextText,
                revision: prepared.revision,
                annotation: prepared.annotation,
            });
            setMessage('Repair accepted and chapter anchors remapped.');
        } catch (acceptError: unknown) {
            setError((acceptError as Error).message || 'The repair could not be activated.');
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm md:items-center md:p-8">
            <section
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden border border-white/10 bg-basalt text-white shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="repair-review-title"
            >
                <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-7">
                    <div>
                        <p className="archive-kicker">TEXT INTEGRITY REVIEW</p>
                        <h2 id="repair-review-title" className="mt-1 font-mono text-lg font-bold uppercase tracking-wider">{bookTitle}</h2>
                        <p className="mt-1 font-mono text-xs text-gray-400">{issues.length} unresolved or reviewable issue{issues.length === 1 ? '' : 's'}</p>
                    </div>
                    <button type="button" onClick={onClose} className="archive-card-action" aria-label="Close text integrity review" title="Close review">
                        <X className="h-5 w-5" />
                    </button>
                </header>

                <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.7fr)]">
                    <div className="min-h-0 overflow-y-auto border-b border-white/10 md:border-b-0 md:border-r">
                        {issues.length === 0 ? (
                            <div className="flex h-full min-h-48 items-center justify-center px-6 text-center font-mono text-xs uppercase text-gray-500">
                                No unresolved text issues.
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {issues.map((issue) => (
                                    <button
                                        key={issue.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedIssueId(issue.id);
                                            setError(null);
                                            setMessage('');
                                        }}
                                        className={`block w-full px-5 py-4 text-left transition-colors ${issue.id === selectedIssueId ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                    >
                                        <span className="flex items-center justify-between gap-3">
                                            <span className="truncate font-mono text-xs text-gray-200">{issue.detectorIds.join(', ')}</span>
                                            <span className={`shrink-0 font-mono text-[10px] uppercase ${issue.severity === 'high' ? 'text-magma-vent' : 'text-dune-gold'}`}>
                                                {issue.severity}
                                            </span>
                                        </span>
                                        <span className="mt-2 block truncate font-mono text-xs text-gray-500">{issue.state === 'accepted' ? 'proposal ready' : issue.state}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="min-h-0 overflow-y-auto px-5 py-5 md:px-7">
                        {selectedIssue && context ? (
                            <>
                                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
                                    <span>Chapter {selectedChapter?.index !== undefined ? selectedChapter.index + 1 : '?'}</span>
                                    <span aria-hidden="true">/</span>
                                    <span>Offsets {selectedIssue.startOffset}-{selectedIssue.endOffset}</span>
                                    <span aria-hidden="true">/</span>
                                    <span>{selectedIssue.ambiguity} ambiguity</span>
                                </div>
                                <div className="mt-5 border-l-2 border-magma-vent bg-black/20 px-4 py-4 font-mono text-sm leading-7 text-gray-200">
                                    <p className="whitespace-pre-wrap">{context.context.slice(0, selectedIssue.startOffset - context.contextStartOffset)}</p>
                                    <mark className="bg-dune-gold/30 px-1 text-white">{context.candidateText}</mark>
                                    <p className="inline whitespace-pre-wrap">{context.context.slice(selectedIssue.endOffset - context.contextStartOffset)}</p>
                                </div>
                                <div className="mt-5 rounded border border-white/10 bg-black/20 p-4">
                                    <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-gray-400">
                                        <AlertTriangle className="h-4 w-4 text-dune-gold" aria-hidden />
                                        Detector evidence
                                    </div>
                                    <p className="mt-2 font-mono text-xs leading-6 text-gray-500">{JSON.stringify(selectedIssue.evidence)}</p>
                                </div>
                                {selectedIssue.proposal && (
                                    <div className="mt-5 rounded border border-canarian-pine/40 bg-canarian-pine/10 p-4">
                                        <p className="font-mono text-xs uppercase tracking-wider text-canarian-pine">Proposal: {selectedIssue.proposal.action}</p>
                                        <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-gray-200">{selectedIssue.proposal.replacement || 'Keep or remove the suspicious span.'}</p>
                                        <p className="mt-2 font-mono text-[10px] uppercase text-gray-500">Reason: {selectedIssue.proposal.reasonCode}</p>
                                    </div>
                                )}
                                {error && <p className="mt-5 font-mono text-xs text-magma-vent" role="alert">{error}</p>}
                                {message && <p className="mt-5 font-mono text-xs text-canarian-pine" aria-live="polite">{message}</p>}
                                <div className="mt-6 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handleRequestProposal}
                                        disabled={busyAction !== null || selectedIssue.state === 'stale' || !repairSettings.repairEnabled}
                                        className="archive-action-btn"
                                    >
                                        <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden />{busyAction === 'propose' ? 'PROPOSING...' : repairSettings.repairEnabled ? 'PROPOSE REPAIR' : 'ENABLE TEXT REPAIR IN SETTINGS'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleAccept}
                                        disabled={busyAction !== null || !selectedIssue.proposal || selectedIssue.state === 'stale'}
                                        className="archive-action-btn archive-action-btn--primary"
                                    >
                                        <span className="flex items-center gap-2"><Check className="h-4 w-4" aria-hidden />{busyAction === 'accept' ? 'APPLYING...' : 'ACCEPT'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleKeepOriginal}
                                        disabled={busyAction !== null || selectedIssue.state === 'stale'}
                                        className="archive-action-btn"
                                    >
                                        {busyAction === 'keep' ? 'RECORDING...' : 'KEEP ORIGINAL'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="flex h-full min-h-48 items-center justify-center text-center font-mono text-xs uppercase text-gray-500">
                                Select an issue to inspect its anchored source context.
                            </div>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
};
