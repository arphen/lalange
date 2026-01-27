import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { startBookSync, type ReplicationState } from '../../core/sync/replication';
import { initDB } from '../../core/sync/db';

export const SyncPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('Initializing...');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const replicationStatesRef = useRef<ReplicationState[]>([]);

    const room = searchParams.get('room');
    const key = searchParams.get('key');
    const bookId = searchParams.get('bookId');

    useEffect(() => {
        if (!room || !key) {
            setError('Missing sync parameters (room or key).');
            return;
        }

        const start = async () => {
            try {
                setStatus('Connecting to host...');
                const states = await startBookSync(room, key, (isActive) => {
                    console.log('Sync active:', isActive);
                    setStatus(isActive ? 'Connected! Receiving data...' : 'Waiting for host...');
                }, (err) => {
                    console.error(err);
                    setError('Connection failed.');
                });
                replicationStatesRef.current = states;
                
                // Monitor sync progress via DB changes?
                // For now, simpler: check if the book exists every few seconds.
                if (bookId) {
                    const db = await initDB();
                    const interval = setInterval(async () => {
                        const doc = await db.books.findOne(bookId).exec();
                        if (doc) {
                            setStatus('Book metadata received. Downloading chapters...');
                            // Check chapters count
                            const chapterCount = await db.chapters.count({ selector: { bookId } }).exec();
                            if (doc.chapterIds && chapterCount >= doc.chapterIds.length) {
                                setStatus('Sync Complete!');
                                setProgress(100);
                                clearInterval(interval);
                            } else {
                                const expected = doc.chapterIds ? doc.chapterIds.length : 1;
                                setProgress(Math.floor((chapterCount / expected) * 100));
                            }
                        }
                    }, 1000);
                    return () => clearInterval(interval);
                }

            } catch (e) {
                console.error(e);
                setError('Failed to start sync service.');
            }
        };

        start();

        return () => {
            replicationStatesRef.current.forEach(rs => rs.cancel());
            replicationStatesRef.current = [];
        };
    }, [room, key, bookId]);

    const handleStartReading = () => {
        if (bookId) {
            navigate(`/reader/${bookId}`);
        } else {
            navigate('/');
        }
    };

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-basalt text-white p-4">
                <div className="text-magma-vent text-xl font-mono mb-4">ERROR</div>
                <p className="mb-4 text-center">{error}</p>
                <button 
                    onClick={() => navigate('/')}
                    className="px-6 py-2 border border-white/20 hover:bg-white/10 font-mono text-sm"
                >
                    RETURN HOME
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-basalt text-white p-4">
            <h1 className="text-2xl font-mono font-bold text-dune-gold mb-8 tracking-widest">
                COMPANION SYNC
            </h1>

            <div className="w-full max-w-xs bg-white/5 rounded-lg border border-white/10 p-6 flex flex-col items-center">
                <div className="w-16 h-16 mb-4 text-dune-gold animate-pulse">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                </div>
                
                <div className="font-mono text-xs text-gray-400 uppercase tracking-wider mb-2">
                    STATUS
                </div>
                <div className="text-center font-mono text-sm mb-6 text-canarian-pine">
                    {status}
                </div>

                {bookId && (
                    <div className="w-full mb-6">
                        <div className="flex justify-between text-xs font-mono text-gray-500 mb-1">
                            <span>PROGRESS</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-1 bg-white/10 w-full overflow-hidden">
                            <div 
                                className="h-full bg-dune-gold transition-all duration-500"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                    </div>
                )}

                <button
                    onClick={handleStartReading}
                    disabled={progress < 100 && bookId !== null}
                    className="w-full py-3 bg-dune-gold text-black font-mono font-bold text-sm hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {progress < 100 && bookId !== null ? 'SYNCING...' : 'OPEN READER'}
                </button>
            </div>
        </div>
    );
};
