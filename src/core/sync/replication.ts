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

/**
 * Create a custom connection handler that wraps SimplePeer with message chunking
 * to handle large documents (chapters can be 300-500KB)
 */
function getChunkedConnectionHandler(options: Parameters<typeof getConnectionHandlerSimplePeer>[0]) {
    const baseHandlerCreator = getConnectionHandlerSimplePeer(options);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (opts: any) => {
        const handler = await baseHandlerCreator(opts);
        console.log('[Sync] Connection handler created');
        
        // Store chunk reassembly buffers per peer
        const chunkBuffers = new Map<SimplePeer, Map<string, { chunks: string[]; total: number }>>();
        
        // Wrap the send function to chunk large messages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const originalSend = handler.send.bind(handler) as (peer: SimplePeer, message: any) => Promise<void>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as any).send = async (peer: SimplePeer, message: unknown): Promise<void> => {
            const msgStr = JSON.stringify(message);
            const encoder = new TextEncoder();
            const encoded = encoder.encode(msgStr);
            
            if (encoded.byteLength <= MAX_CHUNK_SIZE) {
                // Small message, send directly
                return originalSend(peer, message);
            }
            
            const totalChunks = Math.ceil(encoded.byteLength / MAX_CHUNK_SIZE);
            console.log(`[Sync] Chunking large message: ${encoded.byteLength} bytes into ${totalChunks} chunks`);
            
            // Large message - chunk it
            const messageId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const decoder = new TextDecoder();
            
            // Send each chunk as an object with chunk metadata
            for (let i = 0; i < totalChunks; i++) {
                const start = i * MAX_CHUNK_SIZE;
                const end = Math.min(start + MAX_CHUNK_SIZE, encoded.byteLength);
                const chunkBytes = encoded.subarray(start, end);
                const chunkData = decoder.decode(chunkBytes);
                const chunkMsg = {
                    __chunk: true,
                    __id: messageId,
                    __index: i,
                    __total: totalChunks,
                    __data: chunkData
                };
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
                
                // Check if this is a chunk (object with __chunk flag)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const msg = message as any;
                if (msg && typeof msg === 'object' && msg.__chunk === true) {
                    const { __id: messageId, __index: index, __total: total, __data: chunkData } = msg;
                    
                    // Get or create buffer for this peer
                    if (!chunkBuffers.has(peer)) {
                        chunkBuffers.set(peer, new Map());
                    }
                    const peerBuffers = chunkBuffers.get(peer)!;
                    
                    // Get or create buffer for this message
                    if (!peerBuffers.has(messageId)) {
                        peerBuffers.set(messageId, { chunks: new Array(total), total });
                        console.log(`[Sync] Starting to receive chunked message: ${messageId} (${total} chunks)`);
                    }
                    const buffer = peerBuffers.get(messageId)!;
                    buffer.chunks[index] = chunkData;
                    
                    // Check if complete
                    const receivedCount = buffer.chunks.filter(c => c !== undefined).length;
                    if (receivedCount === buffer.total) {
                        // Reassemble and emit
                        const fullMessage = buffer.chunks.join('');
                        peerBuffers.delete(messageId);
                        console.log(`[Sync] Reassembled chunked message: ${messageId} (${fullMessage.length} bytes)`);
                        
                        try {
                            const parsed = JSON.parse(fullMessage);
                            chunkedMessage$.next({ peer, message: parsed });
                        } catch (e) {
                            console.error('[Sync] Failed to parse reassembled message:', e);
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
            console.log('[Sync] Peer disconnected, cleaning up chunk buffers');
            chunkBuffers.delete(peer);
        });
        
        // Log connections
        handler.connect$.subscribe(() => {
            console.log('[Sync] Peer connected');
        });
        
        return handler;
    };
}

export async function startBookSync(
    roomId: string,
    secret: string,
    onStatusChange?: (status: boolean) => void,
    onError?: (err: unknown) => void,
    onDebug?: (msg: string) => void
): Promise<ReplicationState[]> {
    const log = (msg: string) => {
        console.log(`[Sync] ${msg}`);
        if (onDebug) onDebug(msg);
    };
    
    log(`Starting book sync for room: ${roomId.slice(0, 8)}...`);
    
    log('Initializing DB...');
    const db = await initDB();
    log('DB initialized');
    
    const collections = ['books', 'chapters', 'images', 'reading_states'];
    const replicationStates: ReplicationState[] = [];

    for (const collectionName of collections) {
        const collection = db[collectionName as keyof MyDatabase['collections']] as RxCollection;
        if (!collection) {
            log(`Collection ${collectionName} not found, skipping`);
            continue;
        }

        const topic = `${roomId}-${collectionName}-${secret}`;
        log(`Setting up ${collectionName}...`);

        try {
            log(`Calling replicateWebRTC for ${collectionName}...`);
            const pool = await replicateWebRTC({
                collection,
                topic, // Include secret in topic for room isolation
                connectionHandlerCreator: getChunkedConnectionHandler({
                    signalingServerUrl: SIGNALING_SERVER_URL,
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
            
            log(`${collectionName} pool created`);

            pool.error$.subscribe((err: unknown) => {
                log(`Error on ${collectionName}: ${err}`);
                if (onError) onError(err);
            });

            pool.peerStates$.subscribe((peerStates: Map<unknown, unknown>) => {
                const isActive = peerStates.size > 0;
                log(`${collectionName} peers: ${peerStates.size}`);
                if (onStatusChange) onStatusChange(isActive);
            });

            replicationStates.push(pool);
        } catch (e) {
            log(`Failed to setup ${collectionName}: ${e}`);
            throw e;
        }
    }

    log(`All pools created (${replicationStates.length}), waiting for peers...`);
    return replicationStates;
}
