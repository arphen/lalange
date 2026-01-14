/**
 * Display Plugin Registry
 * 
 * Central registry for all display plugins. Provides functions to:
 * - Get a plugin by ID
 * - List all available plugins
 * - Get the default plugin
 */

import { type DisplayPlugin, type DisplayPluginId } from './types';
import { saccadePlugin } from './saccade';
import { velocireaderPlugin } from './velocireader';
import { velocireaderCenteredPlugin } from './velocireader-centered';
import { velocireaderExtremePlugin } from './velocireader-extreme';
import { velocireaderFocusPlugin } from './velocireader-focus';
import { velocireaderFocusSlantPlugin } from './velocireader-focus-slant';

/**
 * Map of all registered display plugins.
 */
const plugins: Map<DisplayPluginId, DisplayPlugin> = new Map([
    ['saccade', saccadePlugin],
    ['velocireader', velocireaderPlugin],
    ['velocireader-centered', velocireaderCenteredPlugin],
    ['velocireader-extreme', velocireaderExtremePlugin],
    ['velocireader-focus', velocireaderFocusPlugin],
    ['velocireader-focus-slant', velocireaderFocusSlantPlugin],
]);

/**
 * The default plugin ID to use when none is specified.
 */
export const DEFAULT_DISPLAY_PLUGIN: DisplayPluginId = 'velocireader-focus-slant';

/**
 * Get a display plugin by ID.
 * Returns the default plugin if the ID is not found.
 */
export function getDisplayPlugin(id: DisplayPluginId): DisplayPlugin {
    return plugins.get(id) ?? plugins.get(DEFAULT_DISPLAY_PLUGIN)!;
}

/**
 * Get all available display plugins.
 * Returns an array of plugins sorted by name.
 */
export function getAllDisplayPlugins(): DisplayPlugin[] {
    return Array.from(plugins.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get all available display plugin IDs.
 */
export function getAllDisplayPluginIds(): DisplayPluginId[] {
    return Array.from(plugins.keys());
}

/**
 * Check if a plugin ID is valid.
 */
export function isValidPluginId(id: string): id is DisplayPluginId {
    return plugins.has(id as DisplayPluginId);
}

// Re-export types and plugins for convenience
export { type DisplayPlugin, type DisplayPluginId, type WordSplit, type RenderOptions } from './types';
export { saccadePlugin, getSaccadeSplit, getSaccadeGradientHtml } from './saccade';
export { 
    velocireaderPlugin, 
    getVelocireaderORPIndex, 
    getVelocireaderHtml, 
    getLuminance, 
    getFontWeight, 
    getCharWidth, 
    getSlantAngle 
} from './velocireader';
