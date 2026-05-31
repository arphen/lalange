import { useCallback, useEffect, useMemo, useState } from 'react';

type FullscreenCapableElement = HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
    msRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenCapableDocument = Document & {
    webkitFullscreenElement?: Element | null;
    msFullscreenElement?: Element | null;
    webkitExitFullscreen?: () => Promise<void> | void;
    msExitFullscreen?: () => Promise<void> | void;
};

const getFullscreenElement = (doc: FullscreenCapableDocument): Element | null => {
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
};

const hasRequestApi = (element: FullscreenCapableElement | null): boolean => {
    return Boolean(element && (element.requestFullscreen || element.webkitRequestFullscreen || element.msRequestFullscreen));
};

const hasExitApi = (doc: FullscreenCapableDocument): boolean => {
    return Boolean(doc.exitFullscreen || doc.webkitExitFullscreen || doc.msExitFullscreen);
};

export const useFullscreen = (targetElement: HTMLElement | null) => {
    const [isFullscreen, setIsFullscreen] = useState(() => {
        if (typeof document === 'undefined') return false;
        return Boolean(getFullscreenElement(document as FullscreenCapableDocument));
    });

    const isFullscreenSupported = useMemo(() => {
        if (typeof document === 'undefined') return false;

        const doc = document as FullscreenCapableDocument;
        const fallbackTarget = doc.documentElement as FullscreenCapableElement;
        const target = (targetElement as FullscreenCapableElement | null) ?? fallbackTarget;

        return hasRequestApi(target) && hasExitApi(doc);
    }, [targetElement]);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        const doc = document as FullscreenCapableDocument;
        const handleFullscreenChange = () => {
            setIsFullscreen(Boolean(getFullscreenElement(doc)));
        };

        doc.addEventListener('fullscreenchange', handleFullscreenChange);
        doc.addEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
        doc.addEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);

        return () => {
            doc.removeEventListener('fullscreenchange', handleFullscreenChange);
            doc.removeEventListener('webkitfullscreenchange', handleFullscreenChange as EventListener);
            doc.removeEventListener('MSFullscreenChange', handleFullscreenChange as EventListener);
        };
    }, []);

    const enterFullscreen = useCallback(async (): Promise<boolean> => {
        if (typeof document === 'undefined') return false;

        const doc = document as FullscreenCapableDocument;
        if (getFullscreenElement(doc)) return true;

        const fallbackTarget = doc.documentElement as FullscreenCapableElement;
        const target = (targetElement as FullscreenCapableElement | null) ?? fallbackTarget;

        try {
            if (target.requestFullscreen) {
                await target.requestFullscreen();
                return true;
            }
            if (target.webkitRequestFullscreen) {
                await target.webkitRequestFullscreen();
                return true;
            }
            if (target.msRequestFullscreen) {
                await target.msRequestFullscreen();
                return true;
            }
        } catch {
            return false;
        }

        return false;
    }, [targetElement]);

    const exitFullscreen = useCallback(async (): Promise<boolean> => {
        if (typeof document === 'undefined') return false;

        const doc = document as FullscreenCapableDocument;
        if (!getFullscreenElement(doc)) return true;

        try {
            if (doc.exitFullscreen) {
                await doc.exitFullscreen();
                return true;
            }
            if (doc.webkitExitFullscreen) {
                await doc.webkitExitFullscreen();
                return true;
            }
            if (doc.msExitFullscreen) {
                await doc.msExitFullscreen();
                return true;
            }
        } catch {
            return false;
        }

        return false;
    }, []);

    const toggleFullscreen = useCallback(async (): Promise<boolean> => {
        if (isFullscreen) {
            return exitFullscreen();
        }
        return enterFullscreen();
    }, [enterFullscreen, exitFullscreen, isFullscreen]);

    return {
        isFullscreen,
        isFullscreenSupported,
        enterFullscreen,
        exitFullscreen,
        toggleFullscreen,
    };
};