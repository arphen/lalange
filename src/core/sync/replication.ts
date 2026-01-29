// Polyfill process.nextTick for SimplePeer (required by RxDB WebRTC replication in browser)
// See: https://rxdb.info/replication-webrtc.html
if (typeof process === 'undefined' || typeof process.nextTick !== 'function') {
    (globalThis as Record<string, unknown>).process = {
        ...(typeof process !== 'undefined' ? process : {}),
        nextTick: (fn: () => void, ...args: unknown[]) => setTimeout(() => fn(...(args as [])), 0)
    };
}

import { replicateWebRTC, getConnectionHandlerSimplePeer, type SimplePeer } from 'rxdb/plugins/replication-webrtc';
import { initDB, type MyDatabase } from './db';
import type { RxCollection } from 'rxdb';

// Use a public signaling server for testing, or a local one if available.
// RxDB provides a default one for demos: wss://signaling.rxdb.info
// For production, we should host our own.
const SIGNALING_SERVER_URL = 'wss://signaling.rxdb.info';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReplicationState = { cancel: () => Promise<void>; error$: any; peerStates$: any };

// WebRTC data channel max message size is typically 256KB, but varies by browser
// We chunk to 64KB to be safe across all browsers
const MAX_CHUNK_SIZE = 64 * 1024;
const CHUNK_HEADER = 'CHUNK:';

/**
 * Create a custom connection handler that wraps SimplePeer with message chunking
 * to handle large documents (chapters can be 300-500KB)
 */
function getChunkedConnectionHandler(options: Parameters<typeof getConnectionHandlerSimplePeer>[0]) {
    const baseHandlerCreator = getConnectionHandlerSimplePeer(options);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (opts: any) => {
        const handler = await baseHandlerCreator(opts);
        
        // Store chunk reassembly buffers per peer
        const chunkBuffers = new Map<SimplePeer, Map<string, { chunks: string[]; total: number }>>();
        
        // Wrap the send function to chunk large messages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const originalSend = handler.send.bind(handler) as (peer: SimplePeer, message: any) => Promise<void>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as any).send = async (peer: SimplePeer, message: unknown): Promise<void> => {
            const msgStr = JSON.stringify(message);
            
            if (msgStr.length <= MAX_CHUNK_SIZE) {
                // Small message, send directly
                return originalSend(peer, message);
            }
            
            // Large message - chunk it
            const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const chunks: string[] = [];
            
            for (let i = 0; i < msgStr.length; i += MAX_CHUNK_SIZE) {
                chunks.push(msgStr.slice(i, i + MAX_CHUNK_SIZE));
            }
            
            // Send each chunk with header: CHUNK:id:index:total:data
            for (let i = 0; i < chunks.length; i++) {
                const chunkMsg = `${CHUNK_HEADER}${messageId}:${i}:${chunks.length}:${chunks[i]}`;
                await originalSend(peer, chunkMsg);
            }
        };
        
        // Wrap message$ to reassemble chunks
        const originalMessage$ = handler.message$;
        const { Subject } = await import('rxjs');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chunkedMessage$ = new Subject<any>();
        
        originalMessage$.subscribe({
            next: (data: { peer: SimplePeer; message: unknown }) => {
                const { peer, message } = data;
                
                // Check if this is a chunk
                if (typeof message === 'string' && message.startsWith(CHUNK_HEADER)) {
                    const parts = message.slice(CHUNK_HEADER.length).split(':');
                    const [messageId, indexStr, totalStr, ...dataParts] = parts;
                    const index = parseInt(indexStr, 10);
                    const total = parseInt(totalStr, 10);
                    const chunkData = dataParts.join(':'); // Rejoin in case data had colons
                    
                    // Get or create buffer for this peer
                    if (!chunkBuffers.has(peer)) {
                        chunkBuffers.set(peer, new Map());
                    }
                    const peerBuffers = chunkBuffers.get(peer)!;
                    
                    // Get or create buffer for this message
                    if (!peerBuffers.has(messageId)) {
                        peerBuffers.set(messageId, { chunks: new Array(total), total });
                    }
                    const buffer = peerBuffers.get(messageId)!;
                    buffer.chunks[index] = chunkData;
                    
                    // Check if complete
                    const receivedCount = buffer.chunks.filter(c => c !== undefined).length;
                    if (receivedCount === buffer.total) {
                        // Reassemble and emit
                        const fullMessage = buffer.chunks.join('');
                        peerBuffers.delete(messageId);
                        
                        try {
                            const parsed = JSON.parse(fullMessage);
                            chunkedMessage$.next({ peer, message: parsed });
                        } catch (e) {
                            console.error('Failed to parse reassembled message:', e);
                        }
                    }
                } else {
                    // Regular message, pass through
                    chunkedMessage$.next(data);
                }
            },
            error: (err: unknown) => chunkedMessage$.error(err),
            complete: () => chunkedMessage$.complete()
        });
        
        // Override message$ with our chunked version
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as any).message$ = chunkedMessage$.asObservable();
        
        // Cleanup chunk buffers on disconnect
        handler.disconnect$.subscribe((peer: SimplePeer) => {
            chunkBuffers.delete(peer);
        });
        
        return handler;
    };
}

export async function startBookSync(
    roomId: string,
    secret: string,
    onStatusChange?: (status: boolean) => void,
    onError?: (err: unknown) => void
): Promise<ReplicationState[]> {
    const db = await initDB();
    const collections = ['books', 'chapters', 'images', 'reading_states'];
    const replicationStates: ReplicationState[] = [];

    for (const collectionName of collections) {
        const collection = db[collectionName as keyof MyDatabase['collections']] as RxCollection;
        if (!collection) continue;

        const pool = await replicateWebRTC({
            collection,
            topic: `${roomId}-${collectionName}-${secret}`, // Include secret in topic for room isolation
            connectionHandlerCreator: getChunkedConnectionHandler({
                signalingServerUrl: SIGNALING_SERVER_URL,
                // SimplePeer uses Google's public STUN servers by default, but we can make it explicit.
                // STUN servers help peers find each other through NATs (common in home Wi-Fi).
                // For a production app on strict networks, you would also need a TURN server here.
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            }),
            pull: {},
            push: {}
        });

        pool.error$.subscribe((err: unknown) => {
            console.error(`Replication error on ${collectionName}:`, err);
            if (onError) onError(err);
        });

        pool.peerStates$.subscribe((peerStates: Map<unknown, unknown>) => {
            const isActive = peerStates.size > 0;
            console.log(`Replication peers on ${collectionName}:`, peerStates.size);
            if (onStatusChange) onStatusChange(isActive);
        });

        replicationStates.push(pool);
    }

    return replicationStates;
}
