import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRightLeft, Check, Gift, Headphones, ScanLine, Send, X } from 'lucide-react';
import type { BookDocType } from '../../core/sync/db';
import {
    createExchangeBundle,
    createOpticalExchangeOffer,
    applyExchangeBundle,
    discardStagedExchangeBundle,
    getDefaultExchangeSelection,
    planExchangeImport,
    stageExchangeBundle,
    summarizeExchangeInvitation,
    type ExchangeBookResolution,
    type ExchangeBundle,
    type ExchangeContinuation,
    type ExchangeDataSelection,
    type ExchangeIntent,
    type ExchangeImportPlan,
    type OpticalExchangePeer,
} from '../../core/exchange';
import { QrCameraScanner } from './QrCameraScanner';

type ExchangePhase =
    | 'configure'
    | 'preparing'
    | 'offer'
    | 'scan-answer'
    | 'connecting'
    | 'sending'
    | 'waiting-return'
    | 'receiving-return'
    | 'review-return'
    | 'applying-return'
    | 'complete'
    | 'error';

interface ExchangeSheetProps {
    isOpen: boolean;
    books: BookDocType[];
    initialBookIds?: string[];
    initialIntent?: ExchangeIntent;
    continuation?: ExchangeContinuation;
    libraryComplete?: boolean;
    onClose: () => void;
}

const modeOptions: Array<{ intent: ExchangeIntent; label: string; description: string; icon: typeof Gift }> = [
    { intent: 'give', label: 'Give', description: 'Books only', icon: Gift },
    { intent: 'handoff', label: 'Handoff', description: 'Continue now', icon: Headphones },
    { intent: 'reconcile', label: 'Sync', description: 'Review both', icon: ArrowRightLeft },
];

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExchangeSheet({
    isOpen,
    books,
    initialBookIds = [],
    initialIntent = 'give',
    continuation,
    libraryComplete = false,
    onClose,
}: ExchangeSheetProps) {
    const [intent, setIntent] = useState<ExchangeIntent>(initialIntent);
    const [bookIds, setBookIds] = useState<string[]>(() => (
        initialBookIds.length > 0 ? initialBookIds : books.slice(0, 1).map((book) => book.id)
    ));
    const [selection, setSelection] = useState<ExchangeDataSelection>(() => getDefaultExchangeSelection(initialIntent));
    const [phase, setPhase] = useState<ExchangePhase>('configure');
    const [invitationUrl, setInvitationUrl] = useState('');
    const [pairingCode, setPairingCode] = useState('');
    const [progress, setProgress] = useState(0);
    const [totalBytes, setTotalBytes] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [pastedAnswer, setPastedAnswer] = useState('');
    const [returnBundle, setReturnBundle] = useState<ExchangeBundle | null>(null);
    const [returnPlan, setReturnPlan] = useState<ExchangeImportPlan | null>(null);
    const [returnResolutions, setReturnResolutions] = useState<Record<string, ExchangeBookResolution>>({});
    const peerRef = useRef<OpticalExchangePeer | null>(null);
    const bundleRef = useRef<ExchangeBundle | null>(null);

    useEffect(() => () => peerRef.current?.close(), []);

    if (!isOpen) return null;

    const chooseIntent = (nextIntent: ExchangeIntent) => {
        setIntent(nextIntent);
        setSelection(getDefaultExchangeSelection(nextIntent));
        if (nextIntent === 'handoff') {
            const handoffBookId = continuation?.bookId ?? bookIds[0] ?? books[0]?.id;
            setBookIds(handoffBookId ? [handoffBookId] : []);
        }
    };

    const toggleBook = (bookId: string) => {
        if (intent === 'handoff') {
            setBookIds([bookId]);
            return;
        }
        setBookIds((current) => (
            current.includes(bookId) ? current.filter((id) => id !== bookId) : [...current, bookId]
        ));
    };

    const beginExchange = async () => {
        try {
            setPhase('preparing');
            setError(null);
            const bundle = await createExchangeBundle({
                intent,
                bookIds,
                selection,
                continuation: intent === 'handoff' ? continuation : undefined,
                scope: intent === 'reconcile' && libraryComplete && bookIds.length === books.length
                    ? 'library'
                    : 'selection',
            });
            const offer = await createOpticalExchangeOffer(summarizeExchangeInvitation(bundle.manifest));
            bundleRef.current = bundle;
            setTotalBytes(bundle.books.reduce((sum, book) => sum + book.estimatedBytes, 0));
            peerRef.current = offer.peer;
            setInvitationUrl(offer.invitationUrl);
            setPairingCode(offer.pairingCode);
            setPhase('offer');
        } catch (exchangeError) {
            setError(exchangeError instanceof Error ? exchangeError.message : 'Could not prepare the exchange.');
            setPhase('error');
        }
    };

    const acceptAnswer = async (answer: string) => {
        if (!peerRef.current || !bundleRef.current) return;
        if (/^[A-Z0-9]{6}$/i.test(answer.trim())) {
            setError('That is the six-character verification code. Copy and paste the full answer code from the other device.');
            return;
        }
        try {
            setError(null);
            setPhase('connecting');
            await peerRef.current.applyAnswerCode(answer);
            await peerRef.current.waitForConnection();
            setPhase('sending');
            await peerRef.current.sendBundle(bundleRef.current, ({ transferredBytes, totalBytes }) => {
                setProgress(totalBytes > 0 ? transferredBytes / totalBytes : 0);
            });
            setProgress(1);
            if (bundleRef.current.manifest.intent === 'reconcile') {
                setPhase('waiting-return');
                const incoming = await peerRef.current.receiveBundle(({ transferredBytes, totalBytes }) => {
                    setPhase('receiving-return');
                    setProgress(totalBytes > 0 ? transferredBytes / totalBytes : 0);
                });
                await stageExchangeBundle(incoming);
                const incomingPlan = await planExchangeImport(incoming);
                setReturnBundle(incoming);
                setReturnPlan(incomingPlan);
                setReturnResolutions(Object.fromEntries(incomingPlan.books.map((book) => [book.bookId, book.suggestedResolution])));
                setProgress(1);
                setPhase('review-return');
            } else {
                setPhase('complete');
            }
        } catch (exchangeError) {
            setError(exchangeError instanceof Error ? exchangeError.message : 'The devices could not complete the transfer.');
            setPhase('error');
        }
    };

    const updateReturnResolution = (
        bookId: string,
        key: keyof ExchangeBookResolution,
        value: string,
    ) => {
        setReturnResolutions((current) => ({
            ...current,
            [bookId]: { ...current[bookId], [key]: value },
        }));
    };

    const applyReturnExchange = async () => {
        if (!returnBundle) return;
        try {
            setPhase('applying-return');
            await applyExchangeBundle(returnBundle, { resolutions: returnResolutions });
            await discardStagedExchangeBundle(returnBundle.manifest.exchangeId);
            setPhase('complete');
        } catch (exchangeError) {
            setError(exchangeError instanceof Error ? exchangeError.message : 'The returned state could not be applied.');
            setPhase('error');
        }
    };

    const handleClose = () => {
        peerRef.current?.close();
        peerRef.current = null;
        bundleRef.current = null;
        setIntent(initialIntent);
        setBookIds(initialBookIds.length > 0 ? initialBookIds : books.slice(0, 1).map((book) => book.id));
        setSelection(getDefaultExchangeSelection(initialIntent));
        setPhase('configure');
        setProgress(0);
        setTotalBytes(0);
        setError(null);
        setPastedAnswer('');
        setReturnBundle(null);
        setReturnPlan(null);
        setReturnResolutions({});
        onClose();
    };

    const selectedBooks = books.filter((book) => bookIds.includes(book.id));

    return createPortal((
        <div className="exchange-overlay" role="presentation">
            <section className="exchange-sheet" role="dialog" aria-modal="true" aria-labelledby="exchange-title">
                <header className="exchange-sheet__header">
                    <div>
                        <p className="exchange-kicker">Direct device exchange</p>
                        <h2 id="exchange-title">Move a reading life</h2>
                    </div>
                    <button type="button" className="exchange-icon-button" onClick={handleClose} aria-label="Close exchange">
                        <X />
                    </button>
                </header>

                {phase === 'configure' && (
                    <div className="exchange-sheet__body">
                        <div className="exchange-modes" role="tablist" aria-label="Exchange mode">
                            {modeOptions.map(({ intent: optionIntent, label, description, icon: Icon }) => (
                                <button
                                    type="button"
                                    key={optionIntent}
                                    className={optionIntent === intent ? 'is-active' : undefined}
                                    onClick={() => chooseIntent(optionIntent)}
                                    role="tab"
                                    aria-selected={optionIntent === intent}
                                >
                                    <Icon size={18} />
                                    <span>{label}<small>{description}</small></span>
                                </button>
                            ))}
                        </div>

                        <div className="exchange-section-heading">
                            <span>Books</span>
                            {intent !== 'handoff' && (
                                <button type="button" onClick={() => setBookIds(bookIds.length === books.length ? [] : books.map((book) => book.id))}>
                                    {bookIds.length === books.length ? 'Clear' : 'Select all'}
                                </button>
                            )}
                        </div>
                        <div className="exchange-book-list">
                            {books.map((book) => (
                                <button
                                    type="button"
                                    key={book.id}
                                    className={bookIds.includes(book.id) ? 'is-selected' : undefined}
                                    onClick={() => toggleBook(book.id)}
                                >
                                    <span className="exchange-book-list__cover">
                                        {book.cover ? <img src={book.cover} alt="" /> : book.title.slice(0, 1)}
                                    </span>
                                    <span className="exchange-book-list__text"><strong>{book.title}</strong><small>{book.author || 'Unknown author'}</small></span>
                                    <span className="exchange-book-list__check"><Check size={14} /></span>
                                </button>
                            ))}
                        </div>

                        <div className="exchange-section-heading"><span>Include</span></div>
                        <div className="exchange-toggles">
                            {([
                                ['content', 'Book files'],
                                ['analysis', 'Pacing analysis'],
                                ['progress', 'Reading position'],
                                ['highlights', 'Highlights & notes'],
                                ['listening', 'Listening position'],
                            ] as const).map(([key, label]) => (
                                <label key={key}>
                                    <span>{label}</span>
                                    <input
                                        type="checkbox"
                                        checked={selection[key]}
                                        disabled={key === 'content'}
                                        onChange={(event) => setSelection((current) => ({ ...current, [key]: event.target.checked }))}
                                    />
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                {phase === 'preparing' && <ExchangeStatus icon={<Send />} title="Preparing the bundle" detail="Fingerprinting selected books on this device." />}

                {phase === 'offer' && (
                    <div className="exchange-pairing">
                        <div className="exchange-qr"><QRCodeSVG value={invitationUrl} size={232} level="L" includeMargin /></div>
                        <p className="exchange-step">1 / 2</p>
                        <h3>Scan this on the other device</h3>
                        <p>{selectedBooks.length} {selectedBooks.length === 1 ? 'book stays' : 'books stay'} on your local network.</p>
                        <div className="exchange-pair-code"><span>Match code</span><strong>{pairingCode}</strong></div>
                        <button type="button" className="exchange-primary" onClick={() => setPhase('scan-answer')}>
                            <ScanLine size={18} /> Scan their answer
                        </button>
                    </div>
                )}

                {phase === 'scan-answer' && (
                    <div className="exchange-sheet__body">
                        <p className="exchange-step">2 / 2</p>
                        <h3 className="exchange-stage-title">Scan the answer shown there</h3>
                        <QrCameraScanner label="Point at the answer QR" onScan={(value) => void acceptAnswer(value)} />
                        <div className="exchange-paste">
                            <input
                                value={pastedAnswer}
                                onChange={(event) => {
                                    setPastedAnswer(event.target.value);
                                    setError(null);
                                }}
                                placeholder="Or paste full answer code"
                            />
                            <button type="button" onClick={() => void acceptAnswer(pastedAnswer)} disabled={!pastedAnswer.trim()}>Connect</button>
                        </div>
                        {error && <p className="exchange-error">{error}</p>}
                    </div>
                )}

                {(phase === 'connecting' || phase === 'sending') && (
                    <ExchangeStatus
                        icon={<ArrowRightLeft />}
                        title={phase === 'connecting' ? 'Joining devices' : `Sending ${formatBytes(totalBytes)}`}
                        detail={phase === 'connecting' ? `Confirm ${pairingCode} appears on both screens.` : `${Math.round(progress * 100)}% transferred`}
                        progress={phase === 'sending' ? progress : undefined}
                    />
                )}

                {(phase === 'waiting-return' || phase === 'receiving-return') && (
                    <ExchangeStatus
                        icon={<ArrowRightLeft />}
                        title={phase === 'waiting-return' ? 'Reviewing on the other device' : 'Receiving their reviewed library'}
                        detail={phase === 'waiting-return' ? 'Keep both screens together. Their choices return over this same direct connection.' : `${Math.round(progress * 100)}% transferred back`}
                        progress={phase === 'receiving-return' ? progress : undefined}
                    />
                )}

                {phase === 'review-return' && returnPlan && (
                    <div className="exchange-sheet__body exchange-return-review">
                        <p className="exchange-kicker">Returned by {returnPlan.sourceDevice.name}</p>
                        <h3 className="exchange-stage-title">Review what changed there</h3>
                        <p className="exchange-return-review__intro">Their reviewed state is staged. Nothing here changes until you apply these choices.</p>
                        {returnPlan.books.length === 0 && (
                            <p className="exchange-return-review__empty">No selected books were returned. Apply to finish the reconciliation receipt.</p>
                        )}
                        <div className="exchange-review__books">
                            {returnPlan.books.map((book) => (
                                <article key={book.bookId}>
                                    <h2>{book.title}</h2>
                                    {book.content !== 'same' && (
                                        <SheetResolutionRow label="Book" comparison={book.content} value={returnResolutions[book.bookId]?.content} onChange={(value) => updateReturnResolution(book.bookId, 'content', value)} options={[
                                            ['keep-local', 'Keep mine'], ['take-incoming', 'Take theirs'], ['keep-both', 'Keep both'],
                                        ]} />
                                    )}
                                    {book.progress !== 'same' && (
                                        <SheetResolutionRow label="Position" comparison={book.progress} value={returnResolutions[book.bookId]?.progress} onChange={(value) => updateReturnResolution(book.bookId, 'progress', value)} options={[
                                            ['keep-local', 'Continue here'], ['take-incoming', 'Continue there'], ['keep-both-bookmarks', 'Keep both'],
                                        ]} />
                                    )}
                                    {book.highlights !== 'same' && (
                                        <SheetResolutionRow label="Highlights" comparison={book.highlights} value={returnResolutions[book.bookId]?.highlights} onChange={(value) => updateReturnResolution(book.bookId, 'highlights', value)} options={[
                                            ['keep-local', 'Keep mine'], ['take-incoming', 'Take theirs'], ['merge-prefer-local', 'Merge, mine wins'], ['merge-prefer-incoming', 'Merge, theirs wins'],
                                        ]} />
                                    )}
                                </article>
                            ))}
                        </div>
                    </div>
                )}

                {phase === 'applying-return' && <ExchangeStatus icon={<ArrowRightLeft />} title="Applying reviewed return" detail="Finishing reconciliation on this device." />}

                {phase === 'complete' && <ExchangeStatus icon={<Check />} title="Transfer received" detail="The other device has verified every byte." />}
                {phase === 'error' && <ExchangeStatus icon={<X />} title="Exchange interrupted" detail={error || 'Try the pairing again.'} error />}

                <footer className="exchange-sheet__footer">
                    {phase === 'configure' ? (
                        <button type="button" className="exchange-primary" onClick={() => void beginExchange()} disabled={bookIds.length === 0}>
                            Show transfer code <Send size={17} />
                        </button>
                    ) : phase === 'review-return' ? (
                        <button type="button" className="exchange-primary" onClick={() => void applyReturnExchange()}>
                            Apply returned state <Check size={17} />
                        </button>
                    ) : (phase === 'complete' || phase === 'error') ? (
                        <button type="button" className="exchange-primary" onClick={handleClose}>{phase === 'complete' ? 'Done' : 'Close'}</button>
                    ) : null}
                </footer>
            </section>
        </div>
    ), document.body);
}

function SheetResolutionRow({ label, comparison, value, onChange, options }: {
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

function ExchangeStatus({
    icon,
    title,
    detail,
    progress,
    error = false,
}: {
    icon: React.ReactNode;
    title: string;
    detail: string;
    progress?: number;
    error?: boolean;
}) {
    return (
        <div className={`exchange-status-screen${error ? ' is-error' : ''}`}>
            <div className="exchange-status-screen__icon">{icon}</div>
            <h3>{title}</h3>
            <p>{detail}</p>
            {progress !== undefined && <div className="exchange-progress"><span style={{ width: `${progress * 100}%` }} /></div>}
        </div>
    );
}
