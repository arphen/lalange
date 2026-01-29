// Polyfill process.nextTick for SimplePeer (required by RxDB WebRTC replication in browser)
// See: https://rxdb.info/replication-webrtc.html
if (typeof process === 'undefined' || typeof process.nextTick !== 'function') {
    (globalThis as Record<string, unknown>).process = {
        ...(typeof process !== 'undefined' ? process : {}),
        nextTick: (fn: () => void, ...args: unknown[]) => setTimeout(() => fn(...(args as [])), 0)
    };
}

import { getConnectionHandlerSimplePeer } from 'rxdb/plugins/replication-webrtc';
import { initDB, type MyDatabase } from './db';
import { type RxReplicationState } from 'rxdb/plugins/replication';
import { type RxDocumentData } from 'rxdb';

// Use a public signaling server for testing, or a local one if available.
// RxDB provides a default one for demos: wss://signaling.rxdb.info
// For production, we should host our own.
const SIGNALING_SERVER_URL = 'wss://signaling.rxdb.info';

export type ReplicationState = RxReplicationState<RxDocumentData<unknown>, unknown>;

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
        const collection = db[collectionName as keyof MyDatabase['collections']];
        if (!collection) continue;

        // RxDB WebRTC sync is not typed on collections, need to cast
        const collectionWithSync = collection as typeof collection & {
            syncWebRTC: (options: unknown) => Promise<ReplicationState>;
        };
        const replicationState = await collectionWithSync.syncWebRTC({
            topic: `${roomId}-${collectionName}`,
            connectionHandler: getConnectionHandlerSimplePeer({
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
            push: {},
            password: secret
        });

        replicationState.error$.subscribe((err: unknown) => {
            console.error(`Replication error on ${collectionName}:`, err);
            if (onError) onError(err);
        });

        replicationState.active$.subscribe((active: boolean) => {
            console.log(`Replication active on ${collectionName}:`, active);
            if (onStatusChange) onStatusChange(active);
        });

        replicationStates.push(replicationState);
    }

    return replicationStates;
}
