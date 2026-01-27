/**
 * TTS Audio Player - Simplified Sequential Design
 * 
 * Plays audio sentences one after another using a simple queue.
 * No complex time-based seeking - just sentence-by-sentence playback.
 */

import { type TTSAudioResult, type SentenceBoundary } from './kokoro';
import { useTTSStore } from '../store/tts';

// Configuration
const MAX_QUEUED_BUFFERS = 10;
const BUFFER_CLEANUP_BEHIND = 2;

export interface AudioPlayerOptions {
    onSentenceChange?: (sentenceIndex: number) => void;
    onEnded?: () => void;
    onError?: (error: Error) => void;
    onAudioQueued?: (sentenceIndex: number, queueSize: number) => void;
    onBufferLow?: (currentSentenceIndex: number) => void;
}

interface QueuedAudio {
    buffer: AudioBuffer;
    sentence: SentenceBoundary;
    duration: number;
}

class TTSAudioPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    
    // Simple queue: map sentence index to audio
    private audioQueue: Map<number, QueuedAudio> = new Map();
    
    // State
    private isPlaying = false;
    private currentSentenceIndex = 0;
    private options: AudioPlayerOptions = {};
    
    // For word tracking within a sentence
    private sentenceStartTime = 0;
    private currentSentenceDuration = 0;
    private currentSentence: SentenceBoundary | null = null;
    private rafId: number | null = null;
    
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
        buffer.copyToChannel(channelData, 0);
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
        });
        
        console.log(`[TTS Player] Queued sentence ${sentence.index} (${result.duration.toFixed(2)}s), queue: ${this.audioQueue.size}`);
        
        // Notify UI
        this.options.onAudioQueued?.(sentence.index, this.audioQueue.size);
        
        // If we're playing and waiting for this sentence, start it now
        if (this.isPlaying && sentence.index === this.currentSentenceIndex && !this.currentSource) {
            console.log(`[TTS Player] Audio arrived for sentence ${sentence.index}, playing now`);
            this.playCurrentSentence();
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
        this.audioQueue.clear();
        console.log('[TTS Player] Queue cleared');
    }
    
    getQueueSize(): number {
        return this.audioQueue.size;
    }
    
    hasAudioForSentence(sentenceIndex: number): boolean {
        return this.audioQueue.has(sentenceIndex);
    }
    
    /**
     * Start playback from a specific sentence index
     */
    async play(fromSentenceIndex?: number): Promise<void> {
        await this.ensureContext();
        
        if (fromSentenceIndex !== undefined) {
            this.currentSentenceIndex = fromSentenceIndex;
        }
        
        if (this.isPlaying) {
            console.log('[TTS Player] Already playing');
            return;
        }
        
        this.isPlaying = true;
        console.log(`[TTS Player] Starting playback from sentence ${this.currentSentenceIndex}`);
        
        this.playCurrentSentence();
    }
    
    private playCurrentSentence(): void {
        if (!this.isPlaying || !this.audioContext || !this.gainNode) {
            return;
        }
        
        const queueItem = this.audioQueue.get(this.currentSentenceIndex);
        
        if (!queueItem) {
            // No audio for this sentence yet - wait for it
            console.log(`[TTS Player] Waiting for audio for sentence ${this.currentSentenceIndex}...`);
            useTTSStore.getState().setPlaybackState('generating');
            
            // Notify that we need more audio
            this.options.onBufferLow?.(this.currentSentenceIndex);
            return;
        }
        
        const { buffer, sentence, duration } = queueItem;
        
        console.log(`[TTS Player] Playing sentence ${sentence.index}: "${sentence.text.slice(0, 40)}..."`);
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
        
        // Create and play new source
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        
        this.currentSource = source;
        this.sentenceStartTime = this.audioContext.currentTime;
        this.currentSentenceDuration = duration;
        this.currentSentence = sentence;
        
        // Update store
        useTTSStore.getState().setCurrentTime(0);
        useTTSStore.getState().setDuration(duration);
        useTTSStore.getState().setCurrentSentence(sentence.index);
        useTTSStore.getState().setCurrentWordIndex(sentence.startWordIndex);
        
        // Start word tracking
        this.startWordTracking();
        
        // Notify sentence change
        this.options.onSentenceChange?.(sentence.index);
        
        // Check if buffer is running low
        const aheadCount = this.countSentencesAhead();
        if (aheadCount < 3) {
            console.log(`[TTS Player] Buffer low: ${aheadCount} ahead`);
            this.options.onBufferLow?.(this.currentSentenceIndex);
        }
        
        const sentenceIndex = sentence.index;
        source.onended = () => {
            if (!this.isPlaying || source !== this.currentSource) {
                return;
            }
            
            this.stopWordTracking();
            this.currentSource = null;
            
            // Move to next sentence
            this.currentSentenceIndex = sentenceIndex + 1;
            
            // Clean up
            this.cleanupOldBuffers();
            
            // Play next
            this.playCurrentSentence();
        };
        
        try {
            source.start();
        } catch (error) {
            console.error('[TTS Player] Failed to start:', error);
            this.options.onError?.(error as Error);
        }
    }
    
    private countSentencesAhead(): number {
        let count = 0;
        for (const [idx] of this.audioQueue) {
            if (idx > this.currentSentenceIndex) {
                count++;
            }
        }
        return count;
    }
    
    private startWordTracking(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        
        const update = () => {
            if (!this.isPlaying || !this.audioContext || !this.currentSentence) {
                return;
            }
            
            const elapsed = this.audioContext.currentTime - this.sentenceStartTime;
            const progress = Math.min(1, elapsed / this.currentSentenceDuration);
            
            // Update time display
            useTTSStore.getState().setCurrentTime(elapsed);
            
            // Calculate current word within sentence
            const sentence = this.currentSentence;
            const wordCount = sentence.endWordIndex - sentence.startWordIndex + 1;
            const wordOffset = Math.floor(progress * wordCount);
            const currentWord = sentence.startWordIndex + Math.min(wordOffset, wordCount - 1);
            
            useTTSStore.getState().setCurrentWordIndex(currentWord);
            
            if (progress < 1 && this.isPlaying) {
                this.rafId = requestAnimationFrame(update);
            }
        };
        
        this.rafId = requestAnimationFrame(update);
    }
    
    private stopWordTracking(): void {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }
    
    pause(): void {
        if (!this.isPlaying) return;
        
        console.log('[TTS Player] Pausing');
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
        console.log('[TTS Player] Stopping');
        this.pause();
        this.currentSentenceIndex = 0;
        this.currentSentence = null;
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
        console.log('[TTS Player] Disposing');
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
