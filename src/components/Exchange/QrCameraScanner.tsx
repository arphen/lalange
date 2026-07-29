import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { Camera, CameraOff } from 'lucide-react';

interface QrCameraScannerProps {
    onScan: (value: string) => void;
    label: string;
}

export function QrCameraScanner({ onScan, label }: QrCameraScannerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const onScanRef = useRef(onScan);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        onScanRef.current = onScan;
    }, [onScan]);

    useEffect(() => {
        if (!videoRef.current) return;
        let active = true;
        const scanner = new QrScanner(
            videoRef.current,
            (result) => {
                if (!active) return;
                active = false;
                scanner.stop();
                onScanRef.current(result.data);
            },
            {
                preferredCamera: 'environment',
                highlightScanRegion: true,
                highlightCodeOutline: true,
                returnDetailedScanResult: true,
            },
        );

        void scanner.start().catch((scanError: unknown) => {
            setError(scanError instanceof Error ? scanError.message : 'Camera access failed.');
        });
        return () => {
            active = false;
            scanner.destroy();
        };
    }, []);

    return (
        <div className="exchange-scanner">
            <div className="exchange-scanner__viewport">
                <video ref={videoRef} muted playsInline aria-label={label} />
                <div className="exchange-scanner__label">
                    {error ? <CameraOff size={15} /> : <Camera size={15} />}
                    <span>{error ? 'Camera unavailable' : label}</span>
                </div>
            </div>
            {error && <p className="exchange-error">{error}</p>}
        </div>
    );
}
