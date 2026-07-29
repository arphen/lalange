import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, ArrowRightLeft, BookOpen, Check, Download, ScanLine, X } from 'lucide-react';
import {
    answerOpticalExchangeOffer,
    applyExchangeBundle,
    createExchangeBundle,
    decodePairingSignal,
    discardStagedExchangeBundle,
    extractPairingCode,
    planExchangeImport,
    stageExchangeBundle,
    type ExchangeBookResolution,
    type ExchangeBundle,
    type ExchangeImportPlan,
    type ExchangeInvitationSummary,
    type OpticalExchangePeer,
} from '../../core/exchange';
import { initDB } from '../../core/sync/db';
import { QrCameraScanner } from './QrCameraScanner';

type ReceivePhase = 'scan' | 'preview' | 'answering' | 'answer' | 'receiving' | 'review' | 'applying' | 'returning' | 'complete' | 'error';

export function ExchangePage() {
    const navigate = useNavigate();
    const [phase, setPhase] = useState<ReceivePhase>('scan');
    const [offerCode, setOfferCode] = useState('');
    const [pastedOffer, setPastedOffer] = useState('');
    const [invitation, setInvitation] = useState<ExchangeInvitationSummary | undefined>();
    const [answerCode, setAnswerCode] = useState('');
    const [pairingCode, setPairingCode] = useState('');
    const [progress, setProgress] = useState(0);
    const [bundle, setBundle] = useState<ExchangeBundle | null>(null);
    const [plan, setPlan] = useState<ExchangeImportPlan | null>(null);
    const [resolutions, setResolutions] = useState<Record<string, ExchangeBookResolution>>({});
    const [resultBookIds, setResultBookIds] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const peerRef = useRef<OpticalExchangePeer | null>(null);
    const initialOfferRef = useRef(false);

    const inspectOffer = async (value: string) => {
        try {
            const code = extractPairingCode(value) ?? value;
            const signal = await decodePairingSignal(code);
            if (signal.kind !== 'offer') throw new Error('Scan an invitation from the sending device.');
            setOfferCode(code);
            setInvitation(signal.invitation);
            setPhase('preview');
        } catch (scanError) {
            setError(scanError instanceof Error ? scanError.message : 'This invitation could not be read.');
            setPhase('error');
        }
    };

    useEffect(() => {
        if (initialOfferRef.current) return;
        initialOfferRef.current = true;
        const initialOffer = extractPairingCode(window.location.href);
        if (!initialOffer) return;
        const timeout = window.setTimeout(() => void inspectOffer(initialOffer), 0);
        return () => window.clearTimeout(timeout);
    }, []);

    useEffect(() => () => peerRef.current?.close(), []);

    const acceptInvitation = async () => {
        try {
            setPhase('answering');
            const answer = await answerOpticalExchangeOffer(offerCode);
            peerRef.current = answer.peer;
            setAnswerCode(answer.answerCode);
            setPairingCode(answer.pairingCode);
            setInvitation(answer.invitation);
            setPhase('answer');

            const incoming = await answer.peer.receiveBundle(({ transferredBytes, totalBytes }) => {
                setPhase('receiving');
                setProgress(totalBytes > 0 ? transferredBytes / totalBytes : 0);
            });
            await stageExchangeBundle(incoming);
            const incomingPlan = await planExchangeImport(incoming);
            setBundle(incoming);
            setPlan(incomingPlan);
            setResolutions(Object.fromEntries(incomingPlan.books.map((book) => [book.bookId, book.suggestedResolution])));
            setProgress(1);
            setPhase('review');
        } catch (receiveError) {
            setError(receiveError instanceof Error ? receiveError.message : 'The transfer could not be received.');
            setPhase('error');
        }
    };

    const applyImport = async () => {
        if (!bundle) return;
        try {
            setPhase('applying');
            const result = await applyExchangeBundle(bundle, { resolutions });
            await discardStagedExchangeBundle(bundle.manifest.exchangeId);
            setResultBookIds([...result.importedBookIds, ...result.updatedBookIds]);

            if (bundle.manifest.intent === 'reconcile' && peerRef.current) {
                setPhase('returning');
                const db = await initDB();
                let returnBookIds: string[];
                if (bundle.manifest.scope === 'library') {
                    returnBookIds = (await db.books.find().exec()).map((book) => book.id);
                } else {
                    const existingBookIds = await Promise.all(bundle.books.map(async (book) => (
                        await db.books.findOne(book.bookId).exec() ? book.bookId : undefined
                    )));
                    returnBookIds = existingBookIds.filter((bookId): bookId is string => Boolean(bookId));
                }
                const reviewedBundle = await createExchangeBundle({
                    intent: 'reconcile',
                    scope: bundle.manifest.scope,
                    bookIds: returnBookIds,
                    selection: bundle.manifest.selection,
                });
                await peerRef.current.sendBundle(reviewedBundle, ({ transferredBytes, totalBytes }) => {
                    setProgress(totalBytes > 0 ? transferredBytes / totalBytes : 0);
                });
            }
            setPhase('complete');
        } catch (applyError) {
            setError(applyError instanceof Error ? applyError.message : 'The reviewed exchange could not be applied.');
            setPhase('error');
        }
    };

    const updateResolution = (bookId: string, key: keyof ExchangeBookResolution, value: string) => {
        setResolutions((current) => ({
            ...current,
            [bookId]: { ...current[bookId], [key]: value },
        }));
    };

    const openResult = () => {
        const continuationBookId = bundle?.manifest.continuation?.bookId;
        const target = continuationBookId && resultBookIds.includes(continuationBookId)
            ? continuationBookId
            : resultBookIds[0];
        navigate(target ? `/reader/${target}` : '/');
    };

    return (
        <main className="exchange-receiver">
            <header className="exchange-receiver__brand">
                <span>XYZ / DEVICE EXCHANGE</span>
                <button type="button" onClick={() => navigate('/')} aria-label="Close"><X /></button>
            </header>

            {phase === 'scan' && (
                <section className="exchange-receiver__stage">
                    <p className="exchange-kicker">Incoming exchange</p>
                    <h1>Bring the devices together.</h1>
                    <p>Scan the invitation shown on the sending screen.</p>
                    <QrCameraScanner label="Scan invitation QR" onScan={(value) => void inspectOffer(value)} />
                    <div className="exchange-paste">
                        <input value={pastedOffer} onChange={(event) => setPastedOffer(event.target.value)} placeholder="Or paste invitation code" />
                        <button type="button" onClick={() => void inspectOffer(pastedOffer)} disabled={!pastedOffer.trim()}>Review</button>
                    </div>
                </section>
            )}

            {phase === 'preview' && (
                <section className="exchange-receiver__stage">
                    <p className="exchange-kicker">Invitation from {invitation?.sourceDevice.name || 'another device'}</p>
                    <h1>{invitation?.intent === 'give' ? 'A book is being given.' : invitation?.intent === 'handoff' ? 'Continue from the other screen.' : 'Reconcile these libraries.'}</h1>
                    <div className="exchange-invitation-list">
                        {invitation?.books.map((book) => (
                            <div key={book.bookId}><BookOpen /><span><strong>{book.title}</strong><small>{book.author || 'Unknown author'}</small></span></div>
                        ))}
                        {(invitation?.bookCount ?? 0) > (invitation?.books.length ?? 0) && (
                            <p>+ {(invitation?.bookCount ?? 0) - (invitation?.books.length ?? 0)} more books</p>
                        )}
                    </div>
                    <button type="button" className="exchange-primary" onClick={() => void acceptInvitation()}>
                        Accept and show answer <ArrowRight size={18} />
                    </button>
                </section>
            )}

            {phase === 'answering' && <ReceiverStatus icon={<ArrowRightLeft />} title="Creating a private answer" detail="No account or server is involved." />}

            {phase === 'answer' && (
                <section className="exchange-receiver__stage exchange-receiver__stage--center">
                    <p className="exchange-step">2 / 2</p>
                    <div className="exchange-qr"><QRCodeSVG value={answerCode} size={242} level="L" includeMargin /></div>
                    <h1>Scan this back on the sender.</h1>
                    <div className="exchange-pair-code"><span>Match code</span><strong>{pairingCode}</strong></div>
                </section>
            )}

            {phase === 'receiving' && <ReceiverStatus icon={<Download />} title="Receiving directly" detail={`${Math.round(progress * 100)}% checked`} progress={progress} />}

            {phase === 'review' && plan && (
                <section className="exchange-review">
                    <p className="exchange-kicker">Review before import</p>
                    <h1>{plan.hasConflicts ? 'These devices changed independently.' : 'Ready to place in this archive.'}</h1>
                    <p>Nothing has changed locally yet. Choose how each difference should land.</p>
                    <div className="exchange-review__books">
                        {plan.books.map((book) => (
                            <article key={book.bookId}>
                                <h2>{book.title}</h2>
                                {book.content !== 'same' && (
                                    <ResolutionRow label="Book" comparison={book.content} value={resolutions[book.bookId]?.content} onChange={(value) => updateResolution(book.bookId, 'content', value)} options={[
                                        ['keep-local', 'Keep mine'], ['take-incoming', 'Take theirs'], ['keep-both', 'Keep both'],
                                    ]} />
                                )}
                                {book.progress !== 'same' && (
                                    <ResolutionRow label="Position" comparison={book.progress} value={resolutions[book.bookId]?.progress} onChange={(value) => updateResolution(book.bookId, 'progress', value)} options={[
                                        ['keep-local', 'Continue here'], ['take-incoming', 'Continue there'], ['keep-both-bookmarks', 'Keep both'],
                                    ]} />
                                )}
                                {book.highlights !== 'same' && (
                                    <ResolutionRow label="Highlights" comparison={book.highlights} value={resolutions[book.bookId]?.highlights} onChange={(value) => updateResolution(book.bookId, 'highlights', value)} options={[
                                        ['keep-local', 'Keep mine'], ['take-incoming', 'Take theirs'], ['merge-prefer-local', 'Merge, mine wins'], ['merge-prefer-incoming', 'Merge, theirs wins'],
                                    ]} />
                                )}
                            </article>
                        ))}
                    </div>
                    <button type="button" className="exchange-primary" onClick={() => void applyImport()}>
                        Apply reviewed exchange <Check size={18} />
                    </button>
                </section>
            )}

            {phase === 'applying' && <ReceiverStatus icon={<ArrowRightLeft />} title="Applying reviewed choices" detail="The staged bundle remains recoverable until this finishes." />}
            {phase === 'returning' && <ReceiverStatus icon={<ArrowRightLeft />} title="Returning this library" detail={`${Math.round(progress * 100)}% transferred back for review`} progress={progress} />}
            {phase === 'complete' && <ReceiverStatus icon={<Check />} title="Exchange complete" detail="Books and chosen state are now local." action={<button type="button" className="exchange-primary" onClick={openResult}>Open archive <ArrowRight size={18} /></button>} />}
            {phase === 'error' && <ReceiverStatus icon={<X />} title="Exchange stopped" detail={error || 'Try scanning a new invitation.'} error action={<button type="button" className="exchange-primary" onClick={() => { setError(null); setPhase('scan'); }}><ScanLine size={18} /> Scan again</button>} />}
        </main>
    );
}

function ResolutionRow({ label, comparison, value, onChange, options }: {
    label: string;
    comparison: string;
    value?: string;
    onChange: (value: string) => void;
    options: Array<[string, string]>;
}) {
    return (
        <label className="exchange-resolution">
            <span><strong>{label}</strong><small>{comparison.replace(/-/g, ' ')}</small></span>
            <select value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
            </select>
        </label>
    );
}

function ReceiverStatus({ icon, title, detail, progress, error = false, action }: {
    icon: React.ReactNode;
    title: string;
    detail: string;
    progress?: number;
    error?: boolean;
    action?: React.ReactNode;
}) {
    return (
        <section className={`exchange-receiver__status${error ? ' is-error' : ''}`}>
            <div>{icon}</div><h1>{title}</h1><p>{detail}</p>
            {progress !== undefined && <div className="exchange-progress"><span style={{ width: `${progress * 100}%` }} /></div>}
            {action}
        </section>
    );
}
