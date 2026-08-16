/**
 * Display Plugin System for RSVP Word Rendering
 * 
 * This module defines the interface for display plugins that control how
 * words are visually rendered in the RSVP reader. Each plugin provides:
 * 
 * 1. Rendering for the main RSVP display
 * 2. HTML rendering for the context "river" (previous/next words)
 * 3. Metadata about the plugin for UI/settings
 * 
 * The system is designed to be extensible - new display strategies can be
 * added by implementing the DisplayPlugin interface.
 */

/**
 * Result of splitting a word for visual emphasis.
 * Used for context rendering where we show bold/light portions.
 */
export interface WordSplit {
    /** The emphasized portion of the word (typically the start) */
    bold: string;
    /** The de-emphasized portion of the word (typically the rest) */
    light: string;
}

/** Structured, inert output for DOM projectors. */
export interface DisplayGlyphRun {
    text: string;
    className?: string;
    breakAfter?: boolean;
}

export interface DisplayWordModel {
    runs: DisplayGlyphRun[];
}

/**
 * Options for rendering a word in the RSVP display.
 */
export interface RenderOptions {
    /** Whether this is a summary/recap word (may render differently) */
    isSummary?: boolean;
    /** Additional CSS classes to apply */
    className?: string;
}

/**
 * Display plugin interface.
 * 
 * Each display strategy must implement this interface to be usable
 * in the RSVP reader. The plugin controls both the main word display
 * and the context rendering.
 */
export interface DisplayPlugin {
    /** Unique identifier for the plugin */
    id: string;
    
    /** Human-readable name for the plugin */
    name: string;
    
    /** Description of how this display mode works */
    description: string;
    
    /**
     * Render a word as HTML for the main RSVP display.
     * This is the primary word shown in the center of the screen.
     * 
     * @param word - The word to render
     * @param options - Optional rendering configuration
     * @returns HTML string for displaying the word
     */
    renderWord(word: string, options?: RenderOptions): string;

    /** Optional text-safe rendering model used by the DOM projector. */
    renderWordModel?(word: string, options?: RenderOptions): DisplayWordModel;
    
    /**
     * Render a word as HTML for the context stream ("river").
     * These are the previous/next words shown above and below the main word.
     * 
     * @param word - The word to render
     * @param index - Position in the word array (for potential styling)
     * @returns HTML string for the context word
     */
    renderContextWord(word: string, index: number): string;
    
    /**
     * Split a word into emphasized and de-emphasized parts.
     * Used for context rendering where we need separate styling.
     * 
     * @param word - The word to split
     * @returns Object with bold and light portions
     */
    splitWord(word: string): WordSplit;
    
    /**
     * Get the CSS class for positioning/centering the main RSVP word.
     * Some plugins may need specific container styling for alignment.
     * 
     * @returns CSS class name(s) for the container
     */
    getContainerClass(): string;
    
    /**
     * Get any required inline styles for the RSVP container.
     * Some plugins need dynamic positioning.
     * 
     * @param word - The current word being displayed
     * @returns CSS style object or undefined
     */
    getContainerStyle?(word: string): React.CSSProperties | undefined;
}

/**
 * Registry of available display plugins.
 */
export type DisplayPluginId = 'saccade' | 'velocireader' | 'velocireader-centered' | 'velocireader-extreme' | 'velocireader-focus' | 'velocireader-focus-slant' | 'velocireader-focus-center';
