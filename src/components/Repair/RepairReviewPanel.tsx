import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { AlertTriangle, Ban, Check, ListChecks, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react';
import { initDB, type ChapterDocType, type ProcessingJobDocType, type TextIssueDocType } from '../../core/sync/db';
import { useSettingsStore } from '../../core/store/settings';
import {
    createRepairContext,
    keepRepairOriginal,
} from '../../core/ingest/repair';
import { repairQueue } from '../../core/ingest/repairQueue';

interface RepairReviewPanelProps {
    bookId: string;
    bookTitle: string;
    onClose: () => void;
}

const REPAIR_PIPELINE_FINGERPRINT = 'bounded-repair-v1';
const REPAIR_VALIDATOR_FINGERPRINT = 'deterministic-repair-validator-v1';

export const RepairReviewPanel: React.FC<RepairReviewPanelProps> = ({ bookId, bookTitle, onClose }) => {
    const repairSettings = useSettingsStore(useShallow((state) => ({
        repairModelId: state.repairModelId,
        repairEnabled: state.textRepairMode !== 'off',
    })));
    const [issues, setIssues] = useState<TextIssueDocType[]>([]);
    const [chapters, setChapters] = useState<ChapterDocType[]>([]);
    const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
    const [jobs, setJobs] = useState<ProcessingJobDocType[]>([]);
    const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
    const [busyAction, setBusyAction] = useState<'prepare' | 'apply' | 'keep' | 'retry' | 'pause' | 'resume' | 'cancel' | null>(null);
    const [queuePaused, setQueuePaused] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    useEffect(() => {
        let issueSubscription: { unsubscribe: () => void } | undefined;
        let chapterSubscription: { unsubscribe: () => void } | undefined;
        let jobSubscription: { unsubscribe: () => void } | undefined;
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
                setSelectedIssueIds((current) => new Set([...current].filter((id) => nextIssues.some((issue) => issue.id === id))));
            });
            chapterSubscription = db.chapters.find({ selector: { bookId }, sort: [{ index: 'asc' }] }).$.subscribe((documents) => {
                setChapters(documents.map((document) => document.toJSON() as ChapterDocType));
            });
            const jobQuery = db.processing_jobs?.find({ selector: { bookId, feature: 'repair' } });
            if (jobQuery?.$) {
                jobSubscription = jobQuery.$.subscribe((documents) => {
                    setJobs(documents.map((document) => document.toJSON() as ProcessingJobDocType));
                });
            }
        };

        subscribe().catch((loadError: unknown) => {
            if (!cancelled) setError((loadError as Error).message || 'Unable to load repair issues.');
        });
        return () => {
            cancelled = true;
            issueSubscription?.unsubscribe();
            chapterSubscription?.unsubscribe();
            jobSubscription?.unsubscribe();
        };
    }, [bookId]);

    const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) || null;
    const selectedChapter = selectedIssue
        ? chapters.find((chapter) => chapter.id === selectedIssue.sourceUnitId)
        : undefined;
    const sourceText = selectedChapter?.content.join(' ') || '';
    const context = selectedIssue && sourceText ? createRepairContext(sourceText, selectedIssue) : null;
    const readyIssues = issues.filter((issue) => issue.state === 'open' && Boolean(issue.proposal));
    const selectedReadyIssueIds = readyIssues
        .filter((issue) => selectedIssueIds.has(issue.id))
        .map((issue) => issue.id);
    const queueRunning = jobs.some((job) => job.state === 'running' || job.state === 'pending');

    const handlePrepareAll = async () => {
        if (!repairSettings.repairEnabled) return;
        setBusyAction('prepare');
        setError(null);
        setMessage('');
        try {
            const queueStatus = await repairQueue.startBook(bookId, repairSettings.repairModelId);
            setQueuePaused(false);
            setMessage(`${queueStatus.total} repair${queueStatus.total === 1 ? '' : 's'} queued. Results will arrive as they complete.`);
        } catch (prepareError: unknown) {
            setError((prepareError as Error).message || 'The repair queue could not be started.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleApply = async (issueIds?: string[]) => {
        const ids = issueIds || selectedReadyIssueIds;
        if (ids.length === 0) {
            setMessage('No prepared repairs are selected.');
            return;
        }
        if (!confirm(`Apply ${ids.length} prepared repair${ids.length === 1 ? '' : 's'}?`)) return;
        setBusyAction('apply');
        setError(null);
        setMessage('');
        try {
            const result = await repairQueue.applyReady(bookId, ids);
            setMessage(`${result.applied} repair${result.applied === 1 ? '' : 's'} applied across the selected chapters.${result.blocked ? ` ${result.blocked} blocked.` : ''}`);
            if (result.errors.length > 0) setError(result.errors.map(({ sourceUnitId, message: detail }) => `${sourceUnitId}: ${detail}`).join(' '));
        } catch (applyError: unknown) {
            setError((applyError as Error).message || 'Prepared repairs could not be applied.');
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
            const db = await initDB();
            if (!selectedIssue) throw new Error('Select an issue first');
            const revisions = await db.content_revisions.find({
                selector: { bookId, sourceUnitId: selectedIssue.sourceUnitId, state: 'active' },
                sort: [{ createdAt: 'desc' }],
                limit: 1,
            }).exec();
            const revision = revisions[0];
            if (!revision) throw new Error('This chapter has no active revision. Scan it again first.');
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
        setBusyAction('apply');
        setError(null);
        setMessage('');
        try {
            const result = await repairQueue.applyReady(bookId, [selectedIssue.id]);
            if (result.applied === 0) throw new Error(result.errors[0]?.message || 'This repair is no longer ready.');
            setMessage('Repair accepted and chapter anchors remapped.');
        } catch (acceptError: unknown) {
            setError((acceptError as Error).message || 'The repair could not be activated.');
        } finally {
            setBusyAction(null);
        }
    };

    const handlePause = async () => {
        setBusyAction('pause');
        await repairQueue.pause(bookId);
        setQueuePaused(true);
        setMessage('Repair queue paused after the active request.');
        setBusyAction(null);
    };

    const handleResume = async () => {
        setBusyAction('resume');
        try {
            await repairQueue.resume(bookId);
            setQueuePaused(false);
            setMessage('Repair queue resumed.');
        } catch (resumeError: unknown) {
            setError((resumeError as Error).message || 'The repair queue could not resume.');
        } finally {
            setBusyAction(null);
        }
    };

    const handleCancel = async () => {
        if (!confirm('Cancel pending repair requests?')) return;
        setBusyAction('cancel');
        await repairQueue.cancel(bookId);
        setQueuePaused(false);
        setMessage('Pending repair requests cancelled.');
        setBusyAction(null);
    };

    const handleRetry = async () => {
        setBusyAction('retry');
        try {
            await repairQueue.retryFailed(bookId);
            setMessage('Failed repair requests returned to the queue.');
        } catch (retryError: unknown) {
            setError((retryError as Error).message || 'Failed repairs could not be retried.');
        } finally {
            setBusyAction(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm md:items-center md:p-8">
            <section
                className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden border border-white/10 bg-basalt text-white shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-labelledby="repair-review-title"
            >
                <header className="border-b border-white/10 px-5 py-4 md:px-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="archive-kicker">TEXT INTEGRITY QUEUE</p>
                            <h2 id="repair-review-title" className="mt-1 font-mono text-lg font-bold uppercase tracking-wider">{bookTitle}</h2>
                            <p className="mt-1 font-mono text-xs text-gray-400" aria-live="polite">
                                {readyIssues.length} ready / {issues.length} issue{issues.length === 1 ? '' : 's'} / {jobs.length} queued
                            </p>
                        </div>
                        <button type="button" onClick={onClose} className="archive-card-action" aria-label="Close text integrity review" title="Close review">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 border-y border-white/10 py-3 font-mono text-[10px] uppercase tracking-wider text-gray-400 sm:grid-cols-4 md:grid-cols-8">
                        <span>Pending {jobs.filter((job) => job.state === 'pending').length}</span>
                        <span>Running {jobs.filter((job) => job.state === 'running').length}</span>
                        <span>Ready {readyIssues.length}</span>
                        <span>Applied {jobs.filter((job) => job.state === 'completed').length}</span>
                        <span>Failed {jobs.filter((job) => job.state === 'failed').length}</span>
                        <span>Blocked {jobs.filter((job) => job.state === 'blocked').length}</span>
                        <span>Cancelled {jobs.filter((job) => job.state === 'cancelled').length}</span>
                        <span>Stale {jobs.filter((job) => job.state === 'stale').length}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handlePrepareAll}
                            disabled={busyAction !== null || !repairSettings.repairEnabled || queueRunning}
                            className="archive-action-btn archive-action-btn--primary"
                            data-testid="repair-prepare-all"
                        >
                            <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" aria-hidden />{busyAction === 'prepare' ? 'PREPARING...' : repairSettings.repairEnabled ? 'PREPARE ALL' : 'ENABLE TEXT REPAIR'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApply(readyIssues.map((issue) => issue.id))}
                            disabled={busyAction !== null || readyIssues.length === 0}
                            className="archive-action-btn archive-action-btn--primary"
                            data-testid="repair-fix-all"
                        >
                            <span className="flex items-center gap-2"><ListChecks className="h-4 w-4" aria-hidden />FIX ALL READY</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleApply()}
                            disabled={busyAction !== null || selectedReadyIssueIds.length === 0}
                            className="archive-action-btn"
                            data-testid="repair-apply-selected"
                        >
                            <Check className="h-4 w-4" aria-hidden /> APPLY SELECTED ({selectedReadyIssueIds.length})
                        </button>
                        {queueRunning && !queuePaused ? (
                            <button type="button" onClick={handlePause} disabled={busyAction !== null} className="archive-action-btn" data-testid="repair-pause">
                                <Pause className="h-4 w-4" aria-hidden /> {busyAction === 'pause' ? 'PAUSING...' : 'PAUSE'}
                            </button>
                        ) : (
                            <button type="button" onClick={handleResume} disabled={busyAction !== null || jobs.every((job) => !['pending', 'blocked'].includes(job.state))} className="archive-action-btn" data-testid="repair-resume">
                                <Play className="h-4 w-4" aria-hidden /> RESUME
                            </button>
                        )}
                        <button type="button" onClick={handleCancel} disabled={busyAction !== null || !queueRunning} className="archive-action-btn" data-testid="repair-cancel">
                            <Ban className="h-4 w-4" aria-hidden /> CANCEL
                        </button>
                        <button type="button" onClick={handleRetry} disabled={busyAction !== null || !jobs.some((job) => job.state === 'failed')} className="archive-action-btn" data-testid="repair-retry">
                            <RotateCcw className="h-4 w-4" aria-hidden /> RETRY FAILED
                        </button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)]">
                    <div className="min-h-0 overflow-y-auto border-b border-white/10 md:border-b-0 md:border-r">
                        {issues.length === 0 ? (
                            <div className="flex h-full min-h-48 items-center justify-center px-6 text-center font-mono text-xs uppercase text-gray-500">
                                No unresolved text issues.
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {issues.map((issue) => {
                                    const isReady = readyIssues.some((readyIssue) => readyIssue.id === issue.id);
                                    return (
                                        <div key={issue.id} className={`flex items-stretch gap-2 px-3 py-3 transition-colors ${issue.id === selectedIssueId ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                            <input
                                                type="checkbox"
                                                checked={selectedIssueIds.has(issue.id)}
                                                disabled={!isReady}
                                                onChange={() => setSelectedIssueIds((current) => {
                                                    const next = new Set(current);
                                                    if (next.has(issue.id)) next.delete(issue.id);
                                                    else next.add(issue.id);
                                                    return next;
                                                })}
                                                aria-label={`Select repair ${issue.id}`}
                                                className="mt-1 h-4 w-4 shrink-0 accent-[#d59b42]"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedIssueId(issue.id);
                                                    setError(null);
                                                    setMessage('');
                                                }}
                                                className="min-w-0 flex-1 text-left"
                                            >
                                                <span className="flex items-center justify-between gap-3">
                                                    <span className="truncate font-mono text-xs text-gray-200">{issue.detectorIds.join(', ')}</span>
                                                    <span className={`shrink-0 font-mono text-[10px] uppercase ${issue.severity === 'high' ? 'text-magma-vent' : 'text-dune-gold'}`}>
                                                        {issue.severity}
                                                    </span>
                                                </span>
                                                <span className="mt-2 block truncate font-mono text-xs text-gray-500">
                                                    {isReady ? 'ready to apply' : issue.state === 'accepted' ? 'applied' : issue.state}
                                                </span>
                                            </button>
                                        </div>
                                    );
                                })}
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
                                        onClick={handleAccept}
                                        disabled={busyAction !== null || !selectedIssue.proposal || selectedIssue.state !== 'open'}
                                        className="archive-action-btn archive-action-btn--primary"
                                    >
                                        <span className="flex items-center gap-2"><Check className="h-4 w-4" aria-hidden />{busyAction === 'apply' ? 'APPLYING...' : 'APPLY THIS'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleKeepOriginal}
                                        disabled={busyAction !== null || selectedIssue.state !== 'open'}
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
