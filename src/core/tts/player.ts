/**
 * TTS Audio Player
 * 
 * Handles audio playback with seamless transitions between reading and listening.
 * Uses Web Audio API for low-latency, gapless playback.
 */

import { type TTSAudioResult, type SentenceBoundary } from './kokoro';
import { useTTSStore } from '../store/tts';

export interface AudioPlayerOptions {
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onSentenceChange?: (sentenceIndex: number) => void;
    onEnded?: () => void;
    onError?: (error: Error) => void;
}

class TTSAudioPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private audioQueue: { buffer: AudioBuffer; sentence: SentenceBoundary }[] = [];
    private isPlaying = false;
    private currentTime = 0;
    private startTime = 0;
    private pauseTime = 0;
    private totalDuration = 0;
    private currentSentenceIndex = 0;
    private sentences: SentenceBoundary[] = [];
    private options: AudioPlayerOptions = {};
    private rafId: number | null = null;
    
    constructor() {
        // Initialize on first user interaction to avoid autoplay restrictions
    }
    
    private async ensureContext(): Promise<AudioContext> {
        if (!this.audioContext) {
            this.audioContext = new AudioContext({ sampleRate: 24000 });
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
        
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        return this.audioContext;
    }
    
    /**
     * Set playback options/callbacks
     */
    setOptions(options: AudioPlayerOptions): void {
        this.options = options;
    }
    
    /**
     * Convert Float32 samples to AudioBuffer
     */
    private createAudioBuffer(samples: Float32Array, sampleRate: number): AudioBuffer {
        if (!this.audioContext) {
            throw new Error('Audio context not initialized');
        }
        
        const buffer = this.audioContext.createBuffer(1, samples.length, sampleRate);
        // Create a new Float32Array with a standard ArrayBuffer to satisfy TypeScript
        const channelData = new Float32Array(samples.length);
        channelData.set(samples);
        buffer.copyToChannel(channelData, 0);
        return buffer;
    }
    
    /**
     * Queue audio for playback
     */
    queueAudio(result: TTSAudioResult, sentence: SentenceBoundary): void {
        if (!this.audioContext) {
            this.ensureContext().catch(console.error);
        }
        
        if (this.audioContext) {
            const buffer = this.createAudioBuffer(result.samples, result.sampleRate);
            this.audioQueue.push({ buffer, sentence });
            this.totalDuration += result.duration;
            
            // Store sentence for seeking
            if (!this.sentences.find(s => s.index === sentence.index)) {
                this.sentences.push(sentence);
                this.sentences.sort((a, b) => a.index - b.index);
            }
        }
    }
    
    /**
     * Clear the audio queue
     */
    clearQueue(): void {
        this.audioQueue = [];
        this.sentences = [];
        this.totalDuration = 0;
        this.currentTime = 0;
        this.currentSentenceIndex = 0;
    }
    
    /**
     * Start or resume playback
     */
    async play(): Promise<void> {
        const ctx = await this.ensureContext();
        
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        useTTSStore.getState().setPlaybackState('playing');
        
        this.startTime = ctx.currentTime - this.pauseTime;
        this.playNextInQueue();
        this.startTimeUpdate();
    }
    
    /**
     * Pause playback
     */
    pause(): void {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        this.pauseTime = this.currentTime;
        useTTSStore.getState().setPlaybackState('paused');
        
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch {
                // Source may already be stopped
            }
            this.currentSource = null;
        }
        
        this.stopTimeUpdate();
    }
    
    /**
     * Toggle play/pause
     */
    async toggle(): Promise<void> {
        if (this.isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }
    
    /**
     * Stop playback and reset
     */
    stop(): void {
        this.pause();
        this.currentTime = 0;
        this.pauseTime = 0;
        this.currentSentenceIndex = 0;
        useTTSStore.getState().setPlaybackState('idle');
    }
    
    /**
     * Seek to a specific time
     */
    async seekTo(time: number): Promise<void> {
        const wasPlaying = this.isPlaying;
        
        if (this.currentSource) {
            try {
                this.currentSource.stop();
            } catch {
                // Source may already be stopped
            }
            this.currentSource = null;
        }
        
        this.currentTime = Math.max(0, Math.min(time, this.totalDuration));
        this.pauseTime = this.currentTime;
        
        // Find the sentence at this time
        this.currentSentenceIndex = this.findSentenceIndexAtTime(this.currentTime);
        
        if (wasPlaying) {
            this.isPlaying = false; // Reset so play() can restart
            await this.play();
        }
    }
    
    /**
     * Seek to a specific sentence
     */
    async seekToSentence(sentenceIndex: number): Promise<void> {
        const sentence = this.sentences[sentenceIndex];
        if (sentence?.audioStartTime !== undefined) {
            await this.seekTo(sentence.audioStartTime);
        }
    }
    
    /**
     * Set playback speed (0.5 - 2.0)
     */
    setSpeed(speed: number): void {
        // Note: Speed changes require re-generating audio with Kokoro
        // This is a UI-side speed that affects generation, not playback rate
        useTTSStore.getState().setSpeed(speed);
    }
    
    /**
     * Set volume (0.0 - 1.0)
     */
    setVolume(volume: number): void {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
        }
        useTTSStore.getState().setVolume(volume);
    }
    
    /**
     * Get current playback state
     */
    getState(): {
        isPlaying: boolean;
        currentTime: number;
        duration: number;
        currentSentenceIndex: number;
    } {
        return {
            isPlaying: this.isPlaying,
            currentTime: this.currentTime,
            duration: this.totalDuration,
            currentSentenceIndex: this.currentSentenceIndex,
        };
    }
    
    /**
     * Get current word index based on playback position
     */
    getCurrentWordIndex(): number {
        const sentence = this.sentences[this.currentSentenceIndex];
        if (!sentence) return 0;
        
        // Interpolate within sentence
        if (sentence.audioStartTime !== undefined && sentence.audioEndTime !== undefined) {
            const sentenceDuration = sentence.audioEndTime - sentence.audioStartTime;
            const timeInSentence = this.currentTime - sentence.audioStartTime;
            const progress = Math.max(0, Math.min(1, timeInSentence / sentenceDuration));
            
            const wordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
            const wordOffset = Math.floor(progress * wordCount);
            
            return sentence.startWordIndex + wordOffset;
        }
        
        return sentence.startWordIndex;
    }
    
    private playNextInQueue(): void {
        if (!this.isPlaying || !this.audioContext || !this.gainNode) return;
        
        // Find the queue item at current time
        const queueItem = this.findQueueItemAtTime(this.currentTime);
        if (!queueItem) {
            // End of audio
            this.isPlaying = false;
            useTTSStore.getState().setPlaybackState('idle');
            this.options.onEnded?.();
            return;
        }
        
        const { buffer, sentence } = queueItem;
        
        // Calculate offset into the buffer
        const sentenceStartTime = sentence.audioStartTime ?? 0;
        const offset = Math.max(0, this.currentTime - sentenceStartTime);
        
        // Create and start source
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        
        source.onended = () => {
            if (this.isPlaying && source === this.currentSource) {
                this.currentSentenceIndex++;
                this.options.onSentenceChange?.(this.currentSentenceIndex);
                this.playNextInQueue();
            }
        };
        
        this.currentSource = source;
        this.currentSentenceIndex = sentence.index;
        
        try {
            source.start(0, offset);
        } catch (error) {
            console.error('[TTS Player] Failed to start playback:', error);
            this.options.onError?.(error as Error);
        }
    }
    
    private findQueueItemAtTime(time: number): { buffer: AudioBuffer; sentence: SentenceBoundary } | null {
        for (const item of this.audioQueue) {
            const startTime = item.sentence.audioStartTime ?? 0;
            const endTime = item.sentence.audioEndTime ?? 0;
            
            if (time >= startTime && time < endTime) {
                return item;
            }
        }
        
        // Return first unplayed item
        return this.audioQueue.find(item => {
            const startTime = item.sentence.audioStartTime ?? 0;
            return startTime >= time;
        }) ?? null;
    }
    
    private findSentenceIndexAtTime(time: number): number {
        for (let i = 0; i < this.sentences.length; i++) {
            const sentence = this.sentences[i];
            const startTime = sentence.audioStartTime ?? 0;
            const endTime = sentence.audioEndTime ?? Infinity;
            
            if (time >= startTime && time < endTime) {
                return i;
            }
        }
        return 0;
    }
    
    private startTimeUpdate(): void {
        if (this.rafId) return;
        
        const update = () => {
            if (!this.isPlaying || !this.audioContext) {
                this.stopTimeUpdate();
                return;
            }
            
            this.currentTime = this.audioContext.currentTime - this.startTime;
            this.options.onTimeUpdate?.(this.currentTime, this.totalDuration);
            
            // Update store
            useTTSStore.getState().setCurrentTime(this.currentTime);
            
            this.rafId = requestAnimationFrame(update);
        };
        
        this.rafId = requestAnimationFrame(update);
    }
    
    private stopTimeUpdate(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    
    /**
     * Clean up resources
     */
    dispose(): void {
        this.stop();
        this.clearQueue();
        
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
            this.gainNode = null;
        }
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
