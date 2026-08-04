import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import {
    buildLocalAccessUrl,
    extractIpv4FromCandidate,
    isLoopbackHost,
    isPrivateIpv4,
} from '../utils/localAccess';

type BrowserWithLegacyRTC = Window & {
    RTCPeerConnection?: typeof RTCPeerConnection;
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
    mozRTCPeerConnection?: typeof RTCPeerConnection;
};

const detectLocalIpv4 = async (timeoutMs = 1800): Promise<string | null> => {
    if (typeof window === 'undefined') return null;

    const rtcWindow = window as BrowserWithLegacyRTC;
    const PeerConnection =
        rtcWindow.RTCPeerConnection ??
        rtcWindow.webkitRTCPeerConnection ??
        rtcWindow.mozRTCPeerConnection;

    if (!PeerConnection) return null;

    return new Promise((resolve) => {
        const candidates = new Set<string>();
        const pc = new PeerConnection({ iceServers: [] });
        let finished = false;

        const finish = (ip: string | null) => {
            if (finished) return;
            finished = true;
            pc.close();
            resolve(ip);
        };

        pc.createDataChannel('local-access');

        pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
            const candidate = event.candidate?.candidate;

            if (!candidate) {
                const first = [...candidates][0] ?? null;
                finish(first);
                return;
            }

            const ip = extractIpv4FromCandidate(candidate);
            if (ip && isPrivateIpv4(ip)) {
                candidates.add(ip);
                finish(ip);
            }
        };

        pc.createOffer()
            .then((offer: RTCSessionDescriptionInit) => pc.setLocalDescription(offer))
            .catch(() => finish(null));

        setTimeout(() => {
            const first = [...candidates][0] ?? null;
            finish(first);
        }, timeoutMs);
    });
};

export const LocalAccessQr: React.FC = () => {
    const location = useLocation();
    const [isOpen, setIsOpen] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [detectedHost, setDetectedHost] = useState<string>('');
    const [manualHost, setManualHost] = useState('');
    const [copyFeedback, setCopyFeedback] = useState('');

    const currentLocation = typeof window !== 'undefined' ? window.location : null;
    const isLoopback = currentLocation ? isLoopbackHost(currentLocation.hostname) : false;

    const hostOverride = manualHost.trim() || detectedHost;

    const currentUrl = useMemo(() => {
        if (!currentLocation) return '';
        return `${currentLocation.origin}${location.pathname}${location.search}${location.hash}`;
    }, [currentLocation, location.hash, location.pathname, location.search]);

    const localShareUrl = useMemo(() => {
        if (!currentLocation) return '';

        return buildLocalAccessUrl(
            {
                protocol: currentLocation.protocol,
                hostname: currentLocation.hostname,
                port: currentLocation.port,
                pathname: location.pathname,
                search: location.search,
                hash: location.hash,
            },
            hostOverride,
        );
    }, [currentLocation, hostOverride, location.hash, location.pathname, location.search]);

    const qrUrl = localShareUrl || currentUrl;

    const runHostDetection = useCallback(async () => {
        if (!isLoopback) return;

        setIsDetecting(true);
        const ip = await detectLocalIpv4();
        setDetectedHost(ip ?? '');
        setIsDetecting(false);
    }, [isLoopback]);

    useEffect(() => {
        if (!isOpen || !isLoopback || manualHost.trim() || detectedHost) return;
        const timeout = window.setTimeout(() => {
            void runHostDetection();
        }, 0);

        return () => window.clearTimeout(timeout);
    }, [detectedHost, isLoopback, isOpen, manualHost, runHostDetection]);

    useEffect(() => {
        if (!copyFeedback) return;
        const timeout = setTimeout(() => setCopyFeedback(''), 2000);
        return () => clearTimeout(timeout);
    }, [copyFeedback]);

    const handleCopy = useCallback(async () => {
        if (!qrUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
            setCopyFeedback('Copy unavailable');
            return;
        }

        try {
            await navigator.clipboard.writeText(qrUrl);
            setCopyFeedback('Copied');
        } catch {
            setCopyFeedback('Copy failed');
        }
    }, [qrUrl]);

    return (
        <>
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 left-4 z-[75] px-3 py-2 bg-black/55 backdrop-blur-md rounded-full border border-white/10 text-white/80 hover:text-white hover:bg-white/10 transition-colors shadow-lg font-mono text-[10px] uppercase tracking-wider"
                title="Open this route on another local device"
            >
                Local Link
            </button>

            {isOpen && (
                <div className="fixed inset-0 z-[95] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-basalt border border-white/10 rounded-lg max-w-md w-full shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-white/10 bg-black/20 flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-mono font-bold text-dune-gold tracking-widest uppercase">
                                    Open Local Route
                                </h2>
                                <p className="text-xs text-gray-400 mt-2 font-mono">
                                    Scan to open this exact route over local Wi-Fi. No books are transferred.
                                </p>
                            </div>

                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-gray-400 hover:text-white transition-colors"
                                title="Close"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="bg-white p-4 rounded-lg inline-block mb-4">
                                <QRCodeSVG
                                    value={qrUrl}
                                    size={220}
                                    level="L"
                                    includeMargin={true}
                                />
                            </div>

                            {isLoopback && (
                                <div className="mb-4 p-3 border border-white/10 rounded bg-black/20">
                                    <label className="block text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-2">
                                        LAN host (auto-detect or enter manually)
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            value={manualHost}
                                            onChange={(e) => setManualHost(e.target.value)}
                                            placeholder={detectedHost || '192.168.1.42'}
                                            className="flex-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-xs font-mono text-white outline-none focus:border-dune-gold/50"
                                        />
                                        <button
                                            onClick={() => void runHostDetection()}
                                            className="px-3 py-2 border border-white/20 rounded text-[10px] font-mono uppercase tracking-wider text-white/80 hover:text-white hover:border-white/40 transition-colors"
                                            disabled={isDetecting}
                                        >
                                            {isDetecting ? 'Detecting' : 'Detect'}
                                        </button>
                                    </div>
                                    {!localShareUrl && (
                                        <p className="text-[10px] font-mono text-yellow-300/80 mt-2">
                                            Localhost is device-only. Enter your computer LAN IP for phone access.
                                        </p>
                                    )}
                                </div>
                            )}

                            <div className="p-3 bg-black/30 border border-white/10 rounded mb-4">
                                <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-2">URL</p>
                                <a
                                    href={qrUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-mono text-dune-gold break-all hover:text-white transition-colors"
                                >
                                    {qrUrl}
                                </a>
                            </div>

                            <div className="flex gap-2 mb-3">
                                <button
                                    onClick={() => void handleCopy()}
                                    className="px-4 py-2 bg-dune-gold text-black rounded font-mono text-xs uppercase tracking-wider hover:bg-white transition-colors"
                                >
                                    Copy URL
                                </button>
                                {copyFeedback && (
                                    <div className="px-3 py-2 border border-white/10 rounded text-[10px] font-mono uppercase tracking-wider text-gray-300">
                                        {copyFeedback}
                                    </div>
                                )}
                            </div>

                            {currentLocation?.protocol !== 'https:' && (
                                <p className="text-[10px] font-mono text-gray-400 leading-relaxed">
                                    HTTP usually works on same Wi-Fi. Use HTTPS only if you need secure-context features.
                                    For local HTTPS dev on this app, run with <span className="text-dune-gold">VITE_HTTPS=1 npm run dev</span>.
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};