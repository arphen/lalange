import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { BookDocType } from '../../core/sync/db';

interface SyncModalProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookDocType | null;
}

export const SyncModal: React.FC<SyncModalProps> = ({ isOpen, onClose, book }) => {
    if (!isOpen || !book) return null;

    // TODO: In the future, this will be a WebRTC handshake URL or similar.
    // For now, we'll just encode a placeholder URL or the Book ID.
    // The "phone exchange.md" mentions a "Scanning the QR code" which authenticates via Key Exchange.
    // Let's assume a deep link schema for now or just the ID for testing.
    const syncData = JSON.stringify({
        type: 'sync-handshake',
        bookId: book.id,
        title: book.title
    });

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

                    <div className="bg-white p-4 rounded-lg inline-block mb-6">
                        <QRCodeSVG
                            value={syncData}
                            size={200}
                            level="H"
                            includeMargin={true}
                        />
                    </div>

                    <p className="text-xs font-mono text-gray-500 max-w-xs mx-auto">
                        Keep this window open. Your phone will connect via local peer-to-peer sync.
                    </p>
                </div>
            </div>
        </div>
    );
};
