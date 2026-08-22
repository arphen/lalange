/**
 * Wires TTS playback into the OS-level media session (lock screen, notification
 * shade, Bluetooth headset buttons, hardware media keys) via the browser's
 * Media Session API.
 */

import { useEffect } from 'react';
import type { TTSPlaybackState } from '../store/tts';

const MEDIA_SESSION_SKIP_WORDS = 10;

export interface TTSMediaSessionOptions {
    playbackState: TTSPlaybackState;
    title: string;
    artist?: string;
    album?: string;
    artwork?: string;
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onSkip: (deltaWords: number) => void;
}

const hasMediaSession = (): boolean =>
    typeof navigator !== 'undefined' && 'mediaSession' in navigator;

const artworkMimeType = (dataUrl: string): string =>
    /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'image/jpeg';

const FALLBACK_ARTWORK = { src: '/icon-512.png', sizes: '512x512', type: 'image/png' };

export function useTTSMediaSession(options: TTSMediaSessionOptions): void {
    const { playbackState, title, artist, album, artwork, onPlay, onPause, onStop, onSkip } = options;

    useEffect(() => {
        if (!hasMediaSession()) return;

        const session = navigator.mediaSession;
        session.setActionHandler('play', onPlay);
        session.setActionHandler('pause', onPause);
        session.setActionHandler('stop', onStop);
        session.setActionHandler('seekbackward', () => onSkip(-MEDIA_SESSION_SKIP_WORDS));
        session.setActionHandler('seekforward', () => onSkip(MEDIA_SESSION_SKIP_WORDS));
        session.setActionHandler('previoustrack', () => onSkip(-MEDIA_SESSION_SKIP_WORDS));
        session.setActionHandler('nexttrack', () => onSkip(MEDIA_SESSION_SKIP_WORDS));

        return () => {
            session.setActionHandler('play', null);
            session.setActionHandler('pause', null);
            session.setActionHandler('stop', null);
            session.setActionHandler('seekbackward', null);
            session.setActionHandler('seekforward', null);
            session.setActionHandler('previoustrack', null);
            session.setActionHandler('nexttrack', null);
        };
    }, [onPlay, onPause, onStop, onSkip]);

    // While this hook is mounted (the Audio panel is open) the OS should always see a
    // ready session — 'idle' still shows a pressable Play button, not "nothing playing".
    useEffect(() => {
        if (!hasMediaSession()) return;
        navigator.mediaSession.playbackState = playbackState === 'playing' ? 'playing' : 'paused';
    }, [playbackState]);

    useEffect(() => {
        if (!hasMediaSession() || typeof MediaMetadata === 'undefined') return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title,
            artist: artist ?? '',
            album: album ?? '',
            artwork: [artwork ? { src: artwork, sizes: '512x512', type: artworkMimeType(artwork) } : FALLBACK_ARTWORK],
        });
    }, [title, artist, album, artwork]);

    // Closing the Audio panel or leaving the book unmounts this hook — the OS session
    // must disappear with it, since there's nothing left listening to its buttons.
    useEffect(() => {
        return () => {
            if (!hasMediaSession()) return;
            navigator.mediaSession.playbackState = 'none';
            navigator.mediaSession.metadata = null;
        };
    }, []);
}
