// Polyfill process.nextTick for SimplePeer (required by RxDB WebRTC replication in browser)
// See: https://rxdb.info/replication-webrtc.html
if (typeof process === 'undefined' || typeof process.nextTick !== 'function') {
    (globalThis as Record<string, unknown>).process = {
        ...(typeof process !== 'undefined' ? process : {}),
        nextTick: (fn: () => void, ...args: unknown[]) => setTimeout(() => fn(...(args as [])), 0)
    };
}

import { replicateWebRTC, getConnectionHandlerSimplePeer } from 'rxdb/plugins/replication-webrtc';
import { initDB, type MyDatabase } from './db';
import type { RxCollection } from 'rxdb';

// Use a public signaling server for testing, or a local one if available.
// RxDB provides a default one for demos: wss://signaling.rxdb.info
// For production, we should host our own.
const SIGNALING_SERVER_URL = 'wss://signaling.rxdb.info';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReplicationState = { cancel: () => Promise<void>; error$: any; peerStates$: any };

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
            connectionHandlerCreator: getConnectionHandlerSimplePeer({
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
