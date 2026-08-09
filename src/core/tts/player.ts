/**
 * TTS Audio Player - Simplified Sequential Design
 * 
 * Plays audio sentences one after another using a simple queue.
 * No complex time-based seeking - just sentence-by-sentence playback.
 */

import { type TTSAudioResult } from './audio';
import { type SentenceBoundary } from './sentences';
import { useTTSStore } from '../store/tts';

// Configuration
const MAX_QUEUED_BUFFERS = 10;
const BUFFER_CLEANUP_BEHIND = 2;
const CLOCK_UPDATE_INTERVAL_SECONDS = 0.2;

const logTTSPlayerDebug = (...args: unknown[]): void => {
    if (import.meta.env.DEV) console.debug(...args);
};

type AudioContextGlobal = typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

type LegacyAudioBufferSourceNode = AudioBufferSourceNode & {
    noteOn?: (when: number) => void;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const estimateTokenWeight = (token: string): number => {
    const normalized = token.trim();
    if (!normalized) return 1;

    const alphaNumeric = normalized.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
    const lengthBasis = Math.max(alphaNumeric.length, normalized.length * 0.7);

    let weight = 0.65 + Math.min(1.75, lengthBasis / 6);

    if (/[,:;)]$/.test(normalized)) weight += 0.22;
    if (/[.!?]["'\])}]*$/.test(normalized)) weight += 0.62;
    if (/[-–—]$/.test(normalized)) weight += 0.18;
    if (/^[A-Z]{2,}$/.test(alphaNumeric)) weight += 0.14;
    if (/^\d/.test(alphaNumeric)) weight += 0.12;

    return clamp(weight, 0.45, 3.25);
};

export const buildWordProgressBoundaries = (sentenceText: string, wordCount: number): number[] => {
    if (wordCount <= 0) return [];

    const tokens = sentenceText.trim().split(/\s+/).filter(Boolean);
    const weights: number[] = [];

    for (let index = 0; index < wordCount; index++) {
        const tokenIndex = tokens.length > 0
            ? Math.min(tokens.length - 1, Math.floor((index * tokens.length) / wordCount))
            : -1;
        const token = tokenIndex >= 0 ? tokens[tokenIndex] : '';
        weights.push(estimateTokenWeight(token));
    }

    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    if (totalWeight <= 0) {
        return Array.from({ length: wordCount }, (_, index) => (index + 1) / wordCount);
    }

    let cumulative = 0;
    const boundaries = weights.map((weight) => {
        cumulative += weight / totalWeight;
        return clamp(cumulative, 0, 1);
    });

    boundaries[boundaries.length - 1] = 1;
    return boundaries;
};

const getWordOffsetForProgress = (progress: number, boundaries: number[]): number => {
    if (boundaries.length === 0) return 0;

    for (let index = 0; index < boundaries.length; index++) {
        if (progress <= boundaries[index]) {
            return index;
        }
    }

    return boundaries.length - 1;
};

export interface AudioPlayerOptions {
    onSentenceChange?: (sentenceIndex: number) => void;
    onWordChange?: (wordIndex: number) => void;
    onEnded?: () => void;
    onError?: (error: Error) => void;
    onAudioQueued?: (sentenceIndex: number, queueSize: number) => void;
    onBufferLow?: (currentSentenceIndex: number) => void;
}

interface QueuedAudio {
    buffer: AudioBuffer;
    sentence: SentenceBoundary;
    /** Audible duration, i.e. the buffer length already divided by playbackRate */
    duration: number;
    playbackRate: number;
}

interface ScheduledAudio {
    source: AudioBufferSourceNode;
    startTime: number;
    ended: boolean;
}

class TTSAudioPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private scheduledSources: Map<number, ScheduledAudio> = new Map();
    
    // Simple queue: map sentence index to audio
    private audioQueue: Map<number, QueuedAudio> = new Map();
    
    // State
    private isPlaying = false;
    private playbackRequestId = 0;
    private currentSentenceIndex = 0;
    private waitingForSentenceIndex: number | null = null; // Track which sentence we're waiting for
    private startupBufferTarget = 1;
    private options: AudioPlayerOptions = {};
    
    // For word tracking within a sentence
    private sentenceStartTime = 0;
    private currentSentenceDuration = 0;
    private lastClockUpdateTime = 0;
    private currentSentence: SentenceBoundary | null = null;
    private currentWordProgressBoundaries: number[] = [];
    private rafId: number | null = null;
    
    private async ensureContext(): Promise<AudioContext> {
        if (!this.audioContext) {
            // Keep the output graph at the device's native rate. AudioBuffer keeps
            // the model's 24 kHz source rate and Web Audio resamples it cleanly.
            const audioGlobal = globalThis as AudioContextGlobal;
            const AudioContextConstructor = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
            if (!AudioContextConstructor) {
                throw new Error('Audio playback is not supported by this browser.');
            }
            this.audioContext = new AudioContextConstructor();
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
        
        if (this.audioContext.state === 'suspended' && typeof this.audioContext.resume === 'function') {
            await this.audioContext.resume();
        }
        
        return this.audioContext;
    }
    
    setOptions(options: AudioPlayerOptions): void {
        this.options = options;
    }
    
    private createAudioBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
        if (!this.audioContext) {
            throw new Error('Audio context not initialized');
        }
        
        const buffer = this.audioContext.createBuffer(1, samples.length, sampleRate);
        const channelData = new Float32Array(samples.length);
        channelData.set(samples);
        if (typeof buffer.copyToChannel === 'function') {
            buffer.copyToChannel(channelData, 0);
        } else {
            buffer.getChannelData(0).set(channelData);
        }
        return buffer;
    }
    
    /**
     * Queue audio for a sentence
     */
    async queueAudio(result: TTSAudioResult, sentence: SentenceBoundary): Promise<void> {
        await this.ensureContext();
        
        const buffer = this.createAudioBuffer(result.samples, result.sampleRate);
        this.audioQueue.set(sentence.index, {
            buffer,
            sentence,
            duration: result.duration,
            playbackRate: result.playbackRate ?? 1,
        });
        
        logTTSPlayerDebug(`[TTS Player] Queued sentence ${sentence.index} (${result.duration.toFixed(2)}s), queue: ${this.audioQueue.size}`);
        
        // Notify UI
        this.options.onAudioQueued?.(sentence.index, this.audioQueue.size);
        
        // Re-check the contiguous startup target whenever another sentence arrives.
        if (this.isPlaying && !this.currentSource && this.waitingForSentenceIndex === this.currentSentenceIndex) {
            this.playCurrentSentence();
        } else if (this.isPlaying && this.currentSource) {
            this.scheduleBufferedSentences();
        }
        
        this.cleanupOldBuffers();
    }
    
    private cleanupOldBuffers(): void {
        const minIndexToKeep = this.currentSentenceIndex - BUFFER_CLEANUP_BEHIND;
        
        for (const [idx] of this.audioQueue) {
            if (idx < minIndexToKeep) {
                this.audioQueue.delete(idx);
            }
        }
        
        if (this.audioQueue.size > MAX_QUEUED_BUFFERS) {
            const indices = Array.from(this.audioQueue.keys()).sort((a, b) => a - b);
            for (const idx of indices) {
                if (this.audioQueue.size <= MAX_QUEUED_BUFFERS) break;
                if (idx < this.currentSentenceIndex - BUFFER_CLEANUP_BEHIND) {
                    this.audioQueue.delete(idx);
                }
            }
        }
    }
    
    clearQueue(): void {
        this.cancelScheduledSources();
        this.audioQueue.clear();
        logTTSPlayerDebug('[TTS Player] Queue cleared');
    }
    
    getQueueSize(): number {
        return this.audioQueue.size;
    }

    getBufferedAheadCount(fromSentenceIndex: number = this.currentSentenceIndex): number {
        let count = 0;
        let sentenceIndex = fromSentenceIndex + 1;

        while (this.audioQueue.has(sentenceIndex)) {
            count += 1;
            sentenceIndex += 1;
        }

        return count;
    }

    checkBuffer(): void {
        this.options.onBufferLow?.(this.currentSentenceIndex);
    }
    
    hasAudioForSentence(sentenceIndex: number): boolean {
        return this.audioQueue.has(sentenceIndex);
    }
    
    /**
     * Start playback from a specific sentence index
     */
    async play(fromSentenceIndex?: number, startupBufferTarget: number = 1): Promise<void> {
        const playbackRequestId = ++this.playbackRequestId;
        await this.ensureContext();

        if (playbackRequestId !== this.playbackRequestId) {
            return;
        }
        
        if (fromSentenceIndex !== undefined) {
            this.currentSentenceIndex = fromSentenceIndex;
            this.startupBufferTarget = Math.max(1, Math.round(startupBufferTarget));
        }
        
        if (this.isPlaying) {
            logTTSPlayerDebug('[TTS Player] Already playing');
            return;
        }
        
        this.isPlaying = true;
        const hasAudio = this.audioQueue.has(this.currentSentenceIndex);
        logTTSPlayerDebug(`[TTS Player] Starting playback from sentence ${this.currentSentenceIndex} (hasAudio: ${hasAudio}, queueSize: ${this.audioQueue.size})`);
        
        this.playCurrentSentence();
    }
    
    private playCurrentSentence(): void {
        if (!this.isPlaying || !this.audioContext || !this.gainNode) {
            return;
        }
        
        const queueItem = this.audioQueue.get(this.currentSentenceIndex);
        const contiguousBuffered = queueItem ? 1 + this.getBufferedAheadCount() : 0;
        
        if (!queueItem || contiguousBuffered < this.startupBufferTarget) {
            // Wait until the initial contiguous buffer is ready. After playback
            // starts, startupBufferTarget resets to one and refill is rolling.
            if (this.waitingForSentenceIndex !== this.currentSentenceIndex) {
                logTTSPlayerDebug(`[TTS Player] Waiting for ${this.startupBufferTarget} contiguous sentence(s) from ${this.currentSentenceIndex}...`);
                this.waitingForSentenceIndex = this.currentSentenceIndex;
                useTTSStore.getState().setPlaybackState('generating');
                
                // Notify that we need more audio
                this.options.onBufferLow?.(this.currentSentenceIndex);
            }
            return;
        }
        
        // Clear waiting flag since we have audio
        this.waitingForSentenceIndex = null;
        this.startupBufferTarget = 1;
        
        const { buffer, sentence, duration, playbackRate } = queueItem;

        logTTSPlayerDebug(`[TTS Player] Playing sentence ${sentence.index}: "${sentence.text.slice(0, 40)}..."`);
        useTTSStore.getState().setPlaybackState('playing');
        
        // Stop any existing source
        if (this.currentSource) {
            try {
                this.currentSource.stop();
                this.currentSource.disconnect();
            } catch {
                // Already stopped
            }
        }
        this.cancelScheduledSources();
        
        const source = this.createSource(buffer, playbackRate);

        this.currentSource = source;
        this.sentenceStartTime = this.audioContext.currentTime;
        this.currentSentenceDuration = duration;
        this.currentSentence = sentence;
        this.currentWordProgressBoundaries = buildWordProgressBoundaries(
            sentence.text,
            sentence.endWordIndex - sentence.startWordIndex + 1,
        );
        
        // Update store
        useTTSStore.getState().setCurrentTime(0);
        this.lastClockUpdateTime = 0;
        useTTSStore.getState().setDuration(duration);
        useTTSStore.getState().setCurrentSentence(sentence.index);
        useTTSStore.getState().setCurrentWordIndex(sentence.startWordIndex);
        this.options.onWordChange?.(sentence.startWordIndex);
        
        // Start word tracking
        this.startWordTracking();
        
        // Notify sentence change
        this.options.onSentenceChange?.(sentence.index);
        
        // Check if buffer is running low
        const aheadCount = this.getBufferedAheadCount();
        logTTSPlayerDebug(`[TTS Player] Contiguous buffer: ${aheadCount} ahead`);
        this.options.onBufferLow?.(this.currentSentenceIndex);
        
        const sentenceIndex = sentence.index;
        source.onended = () => {
            this.handleSourceEnded(source, sentenceIndex);
        };
        
        try {
            this.startSource(source);
            this.scheduleBufferedSentences();
        } catch (error) {
            console.error('[TTS Player] Failed to start:', error);
            this.options.onError?.(error as Error);
        }
    }

    private createSource(buffer: AudioBuffer, playbackRate: number): AudioBufferSourceNode {
        if (!this.audioContext || !this.gainNode) {
            throw new Error('Audio context not initialized');
        }

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        if (playbackRate !== 1 && source.playbackRate) {
            source.playbackRate.value = playbackRate;
        }
        source.connect(this.gainNode);
        return source;
    }

    private startSource(source: AudioBufferSourceNode, when?: number): void {
        if (typeof source.start === 'function') {
            if (when === undefined) {
                source.start();
            } else {
                source.start(when);
            }
            return;
        }

        const legacySource = source as LegacyAudioBufferSourceNode;
        if (typeof legacySource.noteOn !== 'function') {
            throw new Error('Audio playback cannot start in this browser.');
        }
        legacySource.noteOn(when ?? 0);
    }

    private scheduleBufferedSentences(): void {
        if (!this.isPlaying || !this.audioContext || !this.currentSource) return;

        let sentenceIndex = this.currentSentenceIndex + 1;
        let startTime = this.sentenceStartTime + this.currentSentenceDuration;

        while (true) {
            const queueItem = this.audioQueue.get(sentenceIndex);
            if (!queueItem) break;

            const scheduled = this.scheduledSources.get(sentenceIndex);
            if (scheduled) {
                startTime = scheduled.startTime + queueItem.duration;
                sentenceIndex += 1;
                continue;
            }

            const source = this.createSource(queueItem.buffer, queueItem.playbackRate);
            const scheduledSentenceIndex = sentenceIndex;
            const scheduledStartTime = Math.max(this.audioContext.currentTime, startTime);
            const scheduledAudio: ScheduledAudio = {
                source,
                startTime: scheduledStartTime,
                ended: false,
            };
            this.scheduledSources.set(scheduledSentenceIndex, scheduledAudio);
            source.onended = () => {
                this.handleSourceEnded(source, scheduledSentenceIndex);
            };

            try {
                this.startSource(source, scheduledStartTime);
            } catch (error) {
                this.scheduledSources.delete(scheduledSentenceIndex);
                this.cancelScheduledSources();
                console.error('[TTS Player] Failed to schedule buffered sentence:', error);
                this.options.onError?.(error as Error);
                return;
            }

            startTime = scheduledStartTime + queueItem.duration;
            sentenceIndex += 1;
        }
    }

    private handleSourceEnded(source: AudioBufferSourceNode, sentenceIndex: number): void {
        if (!this.isPlaying) return;

        const scheduledSource = this.scheduledSources.get(sentenceIndex);
        if (scheduledSource?.source === source) {
            scheduledSource.ended = true;
            return;
        }
        if (source !== this.currentSource) return;

        this.stopWordTracking();
        this.currentWordProgressBoundaries = [];

        const promotedSentenceIndex = sentenceIndex + 1;
        const promoted = this.scheduledSources.get(promotedSentenceIndex);
        if (promoted) {
            this.scheduledSources.delete(promotedSentenceIndex);
            this.currentSource = promoted.source;
            this.currentSentenceIndex = promotedSentenceIndex;

            const nextItem = this.audioQueue.get(promotedSentenceIndex);
            if (nextItem) {
                this.activateSentence(nextItem, promoted.startTime);
                if (promoted.ended) {
                    this.handleSourceEnded(promoted.source, promotedSentenceIndex);
                } else {
                    this.scheduleBufferedSentences();
                }
                return;
            }
        }

        this.currentSource = null;
        this.currentSentenceIndex = sentenceIndex + 1;
        this.cleanupOldBuffers();
        this.playCurrentSentence();
    }

    private activateSentence(queueItem: QueuedAudio, startTime: number): void {
        const { sentence, duration } = queueItem;
        this.sentenceStartTime = startTime;
        this.currentSentenceDuration = duration;
        this.currentSentence = sentence;
        this.currentWordProgressBoundaries = buildWordProgressBoundaries(
            sentence.text,
            sentence.endWordIndex - sentence.startWordIndex + 1,
        );

        const store = useTTSStore.getState();
        store.setCurrentTime(0);
        this.lastClockUpdateTime = 0;
        store.setDuration(duration);
        store.setCurrentSentence(sentence.index);
        store.setCurrentWordIndex(sentence.startWordIndex);
        this.options.onWordChange?.(sentence.startWordIndex);

        this.startWordTracking();
        this.options.onSentenceChange?.(sentence.index);
        this.options.onBufferLow?.(this.currentSentenceIndex);
    }

    private cancelScheduledSources(): void {
        for (const { source } of this.scheduledSources.values()) {
            try {
                source.stop();
                source.disconnect();
            } catch {
                // Already stopped
            }
        }
        this.scheduledSources.clear();
    }
    
    private startWordTracking(): void {
        this.stopWordTracking();
        
        const update = () => {
            if (!this.isPlaying || !this.audioContext || !this.currentSentence) {
                this.rafId = null;
                return;
            }
            
            const elapsed = clamp(
                this.audioContext.currentTime - this.sentenceStartTime,
                0,
                this.currentSentenceDuration,
            );
            const safeDuration = this.currentSentenceDuration > 0 ? this.currentSentenceDuration : 0.001;
            const progress = Math.min(1, elapsed / safeDuration);
            
            if (
                elapsed >= this.currentSentenceDuration
                || elapsed - this.lastClockUpdateTime >= CLOCK_UPDATE_INTERVAL_SECONDS
            ) {
                useTTSStore.getState().setCurrentTime(elapsed);
                this.lastClockUpdateTime = elapsed;
            }
            
            // Calculate current word within sentence
            const sentence = this.currentSentence;
            const wordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
            const weightedOffset = getWordOffsetForProgress(progress, this.currentWordProgressBoundaries);
            const fallbackOffset = Math.min(Math.floor(progress * Math.max(wordCount, 1)), Math.max(wordCount - 1, 0));
            const wordOffset = this.currentWordProgressBoundaries.length === wordCount
                ? weightedOffset
                : fallbackOffset;
            const currentWord = sentence.startWordIndex + wordOffset;
            
            const store = useTTSStore.getState();
            if (store.currentWordIndex !== currentWord) {
                store.setCurrentWordIndex(currentWord);
                this.options.onWordChange?.(currentWord);
            }
            
            // Keep running until sentence ends (onended will stop tracking)
            if (this.isPlaying) {
                this.rafId = requestAnimationFrame(update);
            } else {
                this.rafId = null;
            }
        };
        
        // Start immediately with first update
        update();
    }
    
    private stopWordTracking(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    
    pause(): void {
        this.playbackRequestId += 1;

        if (!this.isPlaying) {
            logTTSPlayerDebug('[TTS Player] Already paused');
            return;
        }
        
        logTTSPlayerDebug(`[TTS Player] Pausing at sentence ${this.currentSentenceIndex}`);
        if (this.audioContext && this.currentSentence) {
            const elapsed = clamp(
                this.audioContext.currentTime - this.sentenceStartTime,
                0,
                this.currentSentenceDuration,
            );
            useTTSStore.getState().setCurrentTime(elapsed);
            this.lastClockUpdateTime = elapsed;
        }
        this.isPlaying = false;
        this.stopWordTracking();
        
        if (this.currentSource) {
            try {
                this.currentSource.stop();
                this.currentSource.disconnect();
            } catch {
                // Already stopped
            }
            this.currentSource = null;
        }
        this.cancelScheduledSources();

        this.currentWordProgressBoundaries = [];
        
        useTTSStore.getState().setPlaybackState('paused');
    }
    
    async toggle(): Promise<void> {
        if (this.isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }
    
    stop(): void {
        logTTSPlayerDebug('[TTS Player] Stopping');
        this.pause();
        this.currentSentenceIndex = 0;
        this.currentSentence = null;
        this.currentWordProgressBoundaries = [];
        this.waitingForSentenceIndex = null;
        this.startupBufferTarget = 1;
        useTTSStore.getState().setPlaybackState('idle');
        useTTSStore.getState().setCurrentWordIndex(0);
    }
    
    setVolume(volume: number): void {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
        }
        useTTSStore.getState().setVolume(volume);
    }
    
    getState(): {
        isPlaying: boolean;
        currentSentenceIndex: number;
        queueSize: number;
    } {
        return {
            isPlaying: this.isPlaying,
            currentSentenceIndex: this.currentSentenceIndex,
            queueSize: this.audioQueue.size,
        };
    }
    
    getCurrentWordIndex(): number {
        return useTTSStore.getState().currentWordIndex;
    }
    
    dispose(): void {
        logTTSPlayerDebug('[TTS Player] Disposing');
        this.stop();
        this.clearQueue();
        
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
            this.gainNode = null;
        }
        
        this.options = {};
    }
}

// Singleton instance
export const ttsPlayer = new TTSAudioPlayer();

/**
 * Convert Float32 audio to WAV blob for download/caching
 */
export function audioToWavBlob(samples: Float32Array, sampleRate: number = 24000): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = samples.length * bytesPerSample;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    
    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, totalSize - 8, true);
    writeString(view, 8, 'WAVE');
    
    // fmt chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Convert float32 to int16
    const int16Array = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    // Write audio data
    const dataView = new Uint8Array(buffer, headerSize);
    dataView.set(new Uint8Array(int16Array.buffer));
    
    return new Blob([buffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Estimate audio duration for text (before generation)
 * Based on average speaking rate of ~150 WPM
 */
export function estimateAudioDuration(text: string, speed: number = 1.0): number {
    const words = text.split(/\s+/).length;
    const wpm = 150 * speed;
    return (words / wpm) * 60; // seconds
}
