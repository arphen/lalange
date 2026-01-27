/**
 * TTS Audio Player
 * 
 * Handles audio playback with seamless transitions between reading and listening.
 * Uses Web Audio API for low-latency, gapless playback.
 */

import { type TTSAudioResult, type SentenceBoundary } from './kokoro';
import { useTTSStore } from '../store/tts';

// Configuration for memory management
const MAX_QUEUED_BUFFERS = 10; // Keep at most N audio buffers in memory
const BUFFER_CLEANUP_BEHIND = 2; // Keep N sentences behind current for seeking back

export interface AudioPlayerOptions {
    onTimeUpdate?: (currentTime: number, duration: number) => void;
    onSentenceChange?: (sentenceIndex: number) => void;
    onEnded?: () => void;
    onError?: (error: Error) => void;
    onAudioQueued?: (sentenceIndex: number) => void;
    onBufferLow?: () => void;
}

class TTSAudioPlayer {
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private audioQueue: Map<number, { buffer: AudioBuffer; sentence: SentenceBoundary }> = new Map();
    private isPlaying = false;
    private currentTime = 0;
    private startTime = 0;
    private pauseTime = 0;
    private totalDuration = 0;
    private currentSentenceIndex = 0;
    private sentences: SentenceBoundary[] = [];
    private options: AudioPlayerOptions = {};
    private rafId: number | null = null;
    private playedSentenceIndices: Set<number> = new Set();
    private waitingForBuffer = false; // True when we ran out of audio but should resume when more arrives
    
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
     * Queue audio for playback with memory management
     */
    queueAudio(result: TTSAudioResult, sentence: SentenceBoundary): void {
        if (!this.audioContext) {
            this.ensureContext().catch(console.error);
        }
        
        if (this.audioContext) {
            const buffer = this.createAudioBuffer(result.samples, result.sampleRate);
            this.audioQueue.set(sentence.index, { buffer, sentence });
            this.totalDuration += result.duration;
            
            console.log(`[TTS Player] Queued sentence ${sentence.index} (${result.duration.toFixed(2)}s), queue size: ${this.audioQueue.size}`);
            
            // Store sentence for seeking
            if (!this.sentences.find(s => s.index === sentence.index)) {
                this.sentences.push(sentence);
                this.sentences.sort((a, b) => a.index - b.index);
            }
            
            // Notify that audio is available
            this.options.onAudioQueued?.(sentence.index);
            
            // If we were waiting for buffer (underrun recovery), resume playback now
            if (this.waitingForBuffer) {
                console.log('[TTS Player] Buffer replenished, resuming playback');
                this.waitingForBuffer = false;
                this.playNextInQueue();
            }
            
            // Clean up old buffers to prevent memory bloat
            this.cleanupOldBuffers();
        }
    }
    
    /**
     * Clean up audio buffers that are far behind current playback position
     * Keeps memory usage bounded even during long listening sessions
     */
    private cleanupOldBuffers(): void {
        const currentIdx = this.currentSentenceIndex;
        const minIndexToKeep = currentIdx - BUFFER_CLEANUP_BEHIND;
        
        // Remove buffers that are too far behind
        for (const [idx] of this.audioQueue) {
            if (idx < minIndexToKeep) {
                this.audioQueue.delete(idx);
                console.log(`[TTS Player] Cleaned up audio buffer for sentence ${idx}`);
            }
        }
        
        // Also enforce max queue size (keep ahead buffers limited)
        if (this.audioQueue.size > MAX_QUEUED_BUFFERS) {
            const indices = Array.from(this.audioQueue.keys()).sort((a, b) => a - b);
            const toRemove = indices.slice(0, indices.length - MAX_QUEUED_BUFFERS);
            for (const idx of toRemove) {
                if (idx < currentIdx - BUFFER_CLEANUP_BEHIND) {
                    this.audioQueue.delete(idx);
                }
            }
        }
    }
    
    /**
     * Clear the audio queue and release all resources
     */
    clearQueue(): void {
        // Explicitly clear the Map to help GC
        this.audioQueue.clear();
        this.sentences = [];
        this.playedSentenceIndices.clear();
        this.totalDuration = 0;
        this.currentTime = 0;
        this.currentSentenceIndex = 0;
        this.waitingForBuffer = false;
        
        console.log('[TTS Player] Queue cleared, resources released');
    }
    
    /**
     * Get current queue size (for debugging/monitoring)
     */
    getQueueSize(): number {
        return this.audioQueue.size;
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
        this.waitingForBuffer = false;
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
            // No audio available - enter buffer underrun state
            console.log(`[TTS Player] No audio available at time ${this.currentTime.toFixed(2)}, queue size: ${this.audioQueue.size}, waiting for buffer...`);
            
            // Notify that buffer is low - this gives the UI a chance to generate more
            this.options.onBufferLow?.();
            
            // Instead of ending playback, wait for more audio to arrive
            // The queueAudio() method will call playNextInQueue() when new audio arrives
            this.waitingForBuffer = true;
            useTTSStore.getState().setPlaybackState('generating'); // Show we're waiting for more
            
            // Keep the time update running so UI stays responsive
            // But we don't end playback here - we'll resume when audio arrives
            return;
        }
        
        // We have audio, clear the waiting flag
        this.waitingForBuffer = false;
        
        const { buffer, sentence } = queueItem;
        console.log(`[TTS Player] Playing sentence ${sentence.index}: "${sentence.text.slice(0, 30)}..."`);
        
        // Calculate offset into the buffer
        const sentenceStartTime = sentence.audioStartTime ?? 0;
        const offset = Math.max(0, this.currentTime - sentenceStartTime);
        
        // Create and start source
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode);
        
        // Track which sentence we're playing
        const playingSentenceIndex = sentence.index;
        
        source.onended = () => {
            // Mark sentence as played for cleanup
            this.playedSentenceIndices.add(playingSentenceIndex);
            
            if (this.isPlaying && source === this.currentSource) {
                this.currentSentenceIndex++;
                this.options.onSentenceChange?.(this.currentSentenceIndex);
                
                // Check if buffer is running low (less than 2 sentences ahead)
                const aheadCount = this.countSentencesAhead();
                if (aheadCount < 2) {
                    console.log(`[TTS Player] Buffer low: only ${aheadCount} sentences ahead`);
                    this.options.onBufferLow?.();
                }
                
                // Clean up old buffers after advancing
                this.cleanupOldBuffers();
                
                this.playNextInQueue();
            }
            
            // Help GC by disconnecting
            try {
                source.disconnect();
            } catch {
                // Already disconnected
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
    
    /**
     * Count how many sentences are buffered ahead of current position
     */
    private countSentencesAhead(): number {
        let count = 0;
        for (const [idx] of this.audioQueue) {
            if (idx > this.currentSentenceIndex) {
                count++;
            }
        }
        return count;
    }
    
    private findQueueItemAtTime(time: number): { buffer: AudioBuffer; sentence: SentenceBoundary } | null {
        // If queue is empty, nothing to play
        if (this.audioQueue.size === 0) {
            console.log('[TTS Player] findQueueItemAtTime: Queue is empty');
            return null;
        }
        
        // Get sorted items for predictable ordering
        const sortedItems = Array.from(this.audioQueue.values())
            .sort((a, b) => a.sentence.index - b.sentence.index);
        
        // If time is at the very start (0 or close to it), return the first available item
        if (time < 0.1) {
            console.log(`[TTS Player] findQueueItemAtTime: time=${time.toFixed(2)}, returning first item (sentence ${sortedItems[0]?.sentence.index})`);
            return sortedItems[0] ?? null;
        }
        
        // Search for item containing this time
        for (const item of sortedItems) {
            const startTime = item.sentence.audioStartTime ?? 0;
            const endTime = item.sentence.audioEndTime ?? Infinity;
            
            if (time >= startTime && time < endTime) {
                return item;
            }
        }
        
        // Return first item that starts after current time (for seeking ahead)
        const nextItem = sortedItems.find(item => {
            const startTime = item.sentence.audioStartTime ?? 0;
            return startTime >= time;
        });
        
        if (nextItem) {
            return nextItem;
        }
        
        // If we're past all audio, return null (playback should end)
        console.log(`[TTS Player] findQueueItemAtTime: No item found for time ${time.toFixed(2)}`);
        return null;
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
        console.log('[TTS Player] Disposing player, releasing all resources');
        
        this.stop();
        this.stopTimeUpdate();
        this.clearQueue();
        
        // Disconnect and release current source
        if (this.currentSource) {
            try {
                this.currentSource.disconnect();
            } catch {
                // Already disconnected
            }
            this.currentSource = null;
        }
        
        // Close audio context
        if (this.audioContext) {
            this.audioContext.close().catch(console.error);
            this.audioContext = null;
            this.gainNode = null;
        }
        
        // Clear all references
        this.options = {};
    }
    
    /**
     * Check if a sentence's audio is already queued
     */
    hasAudioForSentence(sentenceIndex: number): boolean {
        return this.audioQueue.has(sentenceIndex);
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
