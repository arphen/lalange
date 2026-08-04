import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tts = vi.hoisted(() => ({
    selectedVoice: 'af_heart',
    readyVoice: 'sl_SI-artur-medium',
}));

vi.mock('../../core/store/tts', () => ({
    useTTSStore: () => ({
        voice: tts.selectedVoice,
        setVoice: vi.fn(),
        backendPreference: 'auto',
        setBackendPreference: vi.fn(),
        bufferAhead: 5,
        setBufferAhead: vi.fn(),
        speed: 1,
        setSpeed: vi.fn(),
        volume: 1,
        setVolume: vi.fn(),
        isReady: true,
        isLoading: false,
        loadProgress: 1,
        loadStatus: 'Ready · Piper / WASM',
    }),
}));

vi.mock('../../core/tts', () => ({
    VOICES: [
        {
            id: 'af_heart',
            name: 'Heart',
            engine: 'kokoro',
            gender: 'female',
            language: 'en-US',
            languageLabel: 'American English',
            flag: 'US',
            quality: 'A',
        },
        {
            id: 'sl_SI-artur-medium',
            name: 'Artur',
            engine: 'piper',
            gender: 'male',
            language: 'sl-SI',
            languageLabel: 'Slovenian',
            flag: 'SI',
            quality: 'B',
        },
    ],
    clearTTSCache: vi.fn(),
    getVoice: (voiceId: string) => ({ id: voiceId, engine: voiceId.startsWith('sl_') ? 'piper' : 'kokoro' }),
    getVoiceEngine: (voiceId: string) => voiceId.startsWith('sl_') ? 'piper' : 'kokoro',
    initTTS: vi.fn(),
    isTTSModelCached: vi.fn(async () => false),
    isTTSReady: (voiceId: string) => voiceId === tts.readyVoice,
}));

import { TTSSettings } from './SettingsPanel';

describe('TTSSettings', () => {
    beforeEach(() => {
        tts.selectedVoice = 'af_heart';
        tts.readyVoice = 'sl_SI-artur-medium';
    });

    it('does not report the selected engine as loaded when another engine is ready', async () => {
        render(<TTSSettings />);

        expect(screen.getByRole('heading', { name: 'Kokoro Model Status' })).toBeInTheDocument();
        expect(screen.queryByText(/Loaded in memory/)).not.toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'DOWNLOAD & LOAD MODEL' })).toBeInTheDocument();
    });
});