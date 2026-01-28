import React, { useEffect, useState, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { BookDocType } from '../../core/sync/db';
import { generateUUID } from '../../utils/uuid';
import { startBookSync, type ReplicationState } from '../../core/sync/replication';

interface SyncModalProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookDocType | null;
}

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose, book }) => {
    const [status, setStatus] = useState<string>('Waiting for connection...');
    const replicationStatesRef = useRef<ReplicationState[]>([]);
    
    // Generate stable room/secret IDs per book session
    const syncIds = useMemo(() => {
        if (!book) return null;
        return { roomId: generateUUID(), secret: generateUUID() };
    }, [book?.id]);
    
    // Compute QR URL without setState
    const qrUrl = useMemo(() => {
        if (!book || !syncIds) return '';
        const url = new URL(window.location.origin);
        url.pathname = '/sync';
        url.searchParams.set('room', syncIds.roomId);
        url.searchParams.set('key', syncIds.secret);
        url.searchParams.set('bookId', book.id);
        return url.toString();
    }, [book, syncIds]);

    useEffect(() => {
        if (!isOpen || !book || !syncIds) {
            // Cleanup on close
            replicationStatesRef.current.forEach(rs => rs.cancel());
            replicationStatesRef.current = [];
            return;
        }

        const start = async () => {
            try {
                const states = await startBookSync(syncIds.roomId, syncIds.secret, (isActive) => {
                    setStatus(isActive ? 'Client Connected. Syncing...' : 'Waiting for connection...');
                }, (err) => {
                    console.error('Sync Error:', err);
                    setStatus('Error connecting. Check console.');
                });
                replicationStatesRef.current = states;
            } catch (e) {
                console.error(e);
                setStatus('Failed to start sync service.');
            }
        };
        start();

        return () => {
            replicationStatesRef.current.forEach(rs => rs.cancel());
            replicationStatesRef.current = [];
        };
    }, [isOpen, book, syncIds]);

    if (!isOpen || !book) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-basalt border border-white/10 p-6 md:p-8 rounded-lg shadow-2xl max-w-md w-full relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <div className="text-center">
                    <h3 className="text-xl font-mono font-bold text-dune-gold mb-2">SYNC TO COMPANION</h3>
                    <p className="text-sm font-mono text-gray-400 mb-6">
                        Scan with your phone to sync "{book.title}"
                    </p>

                    {qrUrl && (
                        <div className="bg-white p-4 rounded-lg inline-block mb-6 relative group">
                             <QRCodeSVG
                                value={qrUrl}
                                size={200}
                                level="L"
                                includeMargin={true}
                            />
                            {/* Overlay to click-to-copy or dev usage */}
                            <a 
                                href={qrUrl} 
                                target="_blank" 
                                rel="noreferrer"
                                className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity text-white font-mono text-xs font-bold cursor-pointer"
                            >
                                OPEN LINK (DEBUG)
                            </a>
                        </div>
                    )}

                    <p className="text-xs font-mono text-magma-vent uppercase tracking-wider mb-2">
                        {status}
                    </p>

                    <p className="text-xs font-mono text-gray-500 max-w-xs mx-auto">
                        Keep this window open. Your phone will connect via local peer-to-peer sync.
                    </p>
                </div>
            </div>
        </div>
    );
};
