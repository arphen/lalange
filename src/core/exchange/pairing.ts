import { generateUUID } from '../../utils/uuid';
import type { ExchangeBundle, ExchangeInvitationSummary } from './types';

const CODE_PREFIX = 'xchg1';
const DATA_CHANNEL_LABEL = 'xyz-device-exchange-v1';
const MAX_CHUNK_BYTES = 32 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const BUFFER_LOW_THRESHOLD = 256 * 1024;
const ICE_GATHER_TIMEOUT_MS = 5000;
const PUBLIC_EXCHANGE_ORIGIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://arphen.xyz';

interface EncodedOffer {
    kind: 'offer';
    sessionId: string;
    secret: string;
    description: RTCSessionDescriptionInit;
    invitation?: ExchangeInvitationSummary;
}

interface EncodedAnswer {
    kind: 'answer';
    sessionId: string;
    secret: string;
    description: RTCSessionDescriptionInit;
}

type PairingSignal = EncodedOffer | EncodedAnswer;

interface TransferStartMessage {
    type: 'transfer-start';
    transferId: string;
    byteLength: number;
    chunkCount: number;
    checksum: string;
}

interface TransferFinishMessage {
    type: 'transfer-finish';
    transferId: string;
}

interface TransferAckMessage {
    type: 'transfer-ack';
    transferId: string;
}

interface TransferCancelMessage {
    type: 'transfer-cancel';
    transferId: string;
    reason: string;
}

type ControlMessage = TransferStartMessage | TransferFinishMessage | TransferAckMessage | TransferCancelMessage;

interface IncomingTransfer {
    metadata: TransferStartMessage;
    chunks: Uint8Array[];
    receivedBytes: number;
}

export interface ExchangeTransferProgress {
    transferredBytes: number;
    totalBytes: number;
}

export interface ExchangeOfferSession {
    peer: OpticalExchangePeer;
    invitationUrl: string;
    offerCode: string;
    pairingCode: string;
}

export interface ExchangeAnswerSession {
    peer: OpticalExchangePeer;
    answerCode: string;
    pairingCode: string;
    invitation?: ExchangeInvitationSummary;
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
    if (typeof CompressionStream === 'undefined') return bytes;
    const body = new Response(bytes as BodyInit).body;
    if (!body) return bytes;
    const stream = body.pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array, compressed: boolean): Promise<Uint8Array> {
    if (!compressed) return bytes;
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot decode the compressed pairing code.');
    }
    const body = new Response(bytes as BodyInit).body;
    if (!body) throw new Error('This browser cannot read the compressed pairing code.');
    const stream = body.pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePairingSignal(signal: PairingSignal): Promise<string> {
    const json = new TextEncoder().encode(JSON.stringify(signal));
    const canCompress = typeof CompressionStream !== 'undefined';
    const payload = await compress(json);
    return `${CODE_PREFIX}.${canCompress ? 'g' : 'j'}.${bytesToBase64Url(payload)}`;
}

export async function decodePairingSignal(code: string): Promise<PairingSignal> {
    const match = code.trim().match(/^xchg1\.(g|j)\.([A-Za-z0-9_-]+)$/);
    if (!match) throw new Error('This is not a valid device exchange code.');
    const json = await decompress(base64UrlToBytes(match[2]), match[1] === 'g');
    const signal = JSON.parse(new TextDecoder().decode(json)) as PairingSignal;

    if ((signal.kind !== 'offer' && signal.kind !== 'answer')
        || !signal.sessionId
        || !signal.secret
        || !signal.description?.type
        || !signal.description.sdp) {
        throw new Error('The device exchange code is incomplete.');
    }
    return signal;
}

export function extractPairingCode(value: string): string | undefined {
    const hash = value.startsWith('http') ? new URL(value).hash : value;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    return params.get('offer') ?? params.get('answer') ?? undefined;
}

function displayPairingCode(secret: string): string {
    return secret.replace(/-/g, '').slice(0, 6).toUpperCase();
}

function waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
    if (peerConnection.iceGatheringState === 'complete') return Promise.resolve();

    return new Promise((resolve) => {
        const timeout = window.setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
        function finish() {
            window.clearTimeout(timeout);
            peerConnection.removeEventListener('icegatheringstatechange', handleChange);
            resolve();
        }
        function handleChange() {
            if (peerConnection.iceGatheringState === 'complete') finish();
        }
        peerConnection.addEventListener('icegatheringstatechange', handleChange);
    });
}

async function sha256(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class OpticalExchangePeer {
    private readonly peerConnection: RTCPeerConnection;
    private channel?: RTCDataChannel;
    private incoming?: IncomingTransfer;
    private incomingResolvers: Array<{
        resolve: (bundle: ExchangeBundle) => void;
        reject: (error: Error) => void;
        onProgress?: (progress: ExchangeTransferProgress) => void;
    }> = [];
    private pendingBundles: ExchangeBundle[] = [];
    private ackResolvers = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    private connectionResolvers: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

    constructor(peerConnection: RTCPeerConnection, channel?: RTCDataChannel) {
        this.peerConnection = peerConnection;
        if (channel) this.attachChannel(channel);
        peerConnection.addEventListener('datachannel', (event) => this.attachChannel(event.channel));
        peerConnection.addEventListener('connectionstatechange', () => {
            if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'closed') {
                const error = new Error('The direct device connection closed.');
                this.connectionResolvers.splice(0).forEach(({ reject }) => reject(error));
                this.incomingResolvers.splice(0).forEach(({ reject }) => reject(error));
                this.ackResolvers.forEach(({ reject }) => reject(error));
                this.ackResolvers.clear();
            }
        });
    }

    private attachChannel(channel: RTCDataChannel): void {
        this.channel = channel;
        channel.binaryType = 'arraybuffer';
        channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD;
        channel.addEventListener('open', () => {
            this.connectionResolvers.splice(0).forEach(({ resolve }) => resolve());
        });
        channel.addEventListener('message', (event) => {
            void this.handleMessage(event.data).catch((error) => {
                this.incomingResolvers.shift()?.reject(error as Error);
            });
        });
    }

    async waitForConnection(): Promise<void> {
        if (this.channel?.readyState === 'open') return;
        if (this.peerConnection.connectionState === 'failed') {
            throw new Error('The devices could not connect on this network.');
        }
        return new Promise((resolve, reject) => this.connectionResolvers.push({ resolve, reject }));
    }

    async applyAnswerCode(code: string): Promise<void> {
        const signal = await decodePairingSignal(extractPairingCode(code) ?? code);
        if (signal.kind !== 'answer') throw new Error('Scan the answer shown on the receiving device.');
        await this.peerConnection.setRemoteDescription(signal.description);
    }

    async sendBundle(
        bundle: ExchangeBundle,
        onProgress?: (progress: ExchangeTransferProgress) => void,
    ): Promise<void> {
        await this.waitForConnection();
        const channel = this.channel!;
        const bytes = new TextEncoder().encode(JSON.stringify(bundle));
        const transferId = generateUUID();
        const chunkCount = Math.ceil(bytes.byteLength / MAX_CHUNK_BYTES);
        const checksum = await sha256(bytes);

        channel.send(JSON.stringify({
            type: 'transfer-start',
            transferId,
            byteLength: bytes.byteLength,
            chunkCount,
            checksum,
        } satisfies TransferStartMessage));

        for (let offset = 0; offset < bytes.byteLength; offset += MAX_CHUNK_BYTES) {
            if (channel.readyState !== 'open') throw new Error('The direct device connection closed.');
            if (channel.bufferedAmount > MAX_BUFFERED_BYTES) await this.waitForBuffer();
            const chunk = bytes.slice(offset, Math.min(offset + MAX_CHUNK_BYTES, bytes.byteLength));
            channel.send(chunk.buffer);
            onProgress?.({
                transferredBytes: Math.min(offset + chunk.byteLength, bytes.byteLength),
                totalBytes: bytes.byteLength,
            });
        }

        channel.send(JSON.stringify({ type: 'transfer-finish', transferId } satisfies TransferFinishMessage));
        await new Promise<void>((resolve, reject) => {
            this.ackResolvers.set(transferId, { resolve, reject });
        });
    }

    receiveBundle(onProgress?: (progress: ExchangeTransferProgress) => void): Promise<ExchangeBundle> {
        const pending = this.pendingBundles.shift();
        if (pending) return Promise.resolve(pending);
        return new Promise((resolve, reject) => {
            this.incomingResolvers.push({ resolve, reject, onProgress });
        });
    }

    cancel(reason = 'Cancelled by the other device.'): void {
        if (this.incoming && this.channel?.readyState === 'open') {
            this.channel.send(JSON.stringify({
                type: 'transfer-cancel',
                transferId: this.incoming.metadata.transferId,
                reason,
            } satisfies TransferCancelMessage));
        }
        this.close();
    }

    close(): void {
        this.channel?.close();
        this.peerConnection.close();
    }

    private waitForBuffer(): Promise<void> {
        const channel = this.channel!;
        if (channel.bufferedAmount <= BUFFER_LOW_THRESHOLD) return Promise.resolve();
        return new Promise((resolve) => {
            channel.addEventListener('bufferedamountlow', () => resolve(), { once: true });
        });
    }

    private async handleMessage(data: unknown): Promise<void> {
        if (typeof data === 'string') {
            const message = JSON.parse(data) as ControlMessage;
            await this.handleControlMessage(message);
            return;
        }

        if (!this.incoming) throw new Error('Received book data before transfer metadata.');
        const chunk = data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(await (data as Blob).arrayBuffer());
        this.incoming.chunks.push(chunk);
        this.incoming.receivedBytes += chunk.byteLength;
        this.incomingResolvers[0]?.onProgress?.({
            transferredBytes: this.incoming.receivedBytes,
            totalBytes: this.incoming.metadata.byteLength,
        });
    }

    private async handleControlMessage(message: ControlMessage): Promise<void> {
        if (message.type === 'transfer-start') {
            if (this.incoming) throw new Error('A transfer is already in progress.');
            this.incoming = { metadata: message, chunks: [], receivedBytes: 0 };
            return;
        }

        if (message.type === 'transfer-ack') {
            this.ackResolvers.get(message.transferId)?.resolve();
            this.ackResolvers.delete(message.transferId);
            return;
        }

        if (message.type === 'transfer-cancel') {
            const error = new Error(message.reason);
            this.incomingResolvers.shift()?.reject(error);
            this.ackResolvers.get(message.transferId)?.reject(error);
            this.ackResolvers.delete(message.transferId);
            this.incoming = undefined;
            return;
        }

        if (!this.incoming || this.incoming.metadata.transferId !== message.transferId) {
            throw new Error('Transfer completion did not match the active exchange.');
        }

        const { metadata, chunks, receivedBytes } = this.incoming;
        this.incoming = undefined;
        if (receivedBytes !== metadata.byteLength || chunks.length !== metadata.chunkCount) {
            throw new Error('The transfer was incomplete.');
        }

        const bytes = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        if (await sha256(bytes) !== metadata.checksum) throw new Error('The transfer checksum failed.');
        const bundle = JSON.parse(new TextDecoder().decode(bytes)) as ExchangeBundle;
        this.channel?.send(JSON.stringify({
            type: 'transfer-ack',
            transferId: metadata.transferId,
        } satisfies TransferAckMessage));

        const resolver = this.incomingResolvers.shift();
        if (resolver) resolver.resolve(bundle);
        else this.pendingBundles.push(bundle);
    }
}

export async function createOpticalExchangeOffer(
    invitationSummary?: ExchangeInvitationSummary,
): Promise<ExchangeOfferSession> {
    const peerConnection = new RTCPeerConnection({ iceServers: [] });
    const channel = peerConnection.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true });
    const peer = new OpticalExchangePeer(peerConnection, channel);
    const sessionId = generateUUID();
    const secret = generateUUID();

    await peerConnection.setLocalDescription(await peerConnection.createOffer());
    await waitForIceGathering(peerConnection);
    if (!peerConnection.localDescription) throw new Error('Could not create a local exchange offer.');

    const offerCode = await encodePairingSignal({
        kind: 'offer',
        sessionId,
        secret,
        description: peerConnection.localDescription.toJSON(),
        invitation: invitationSummary,
    });
    const invitation = new URL('/exchange', PUBLIC_EXCHANGE_ORIGIN);
    invitation.hash = new URLSearchParams({ offer: offerCode }).toString();

    return {
        peer,
        offerCode,
        invitationUrl: invitation.toString(),
        pairingCode: displayPairingCode(secret),
    };
}

export async function answerOpticalExchangeOffer(codeOrUrl: string): Promise<ExchangeAnswerSession> {
    const code = extractPairingCode(codeOrUrl) ?? codeOrUrl;
    const offer = await decodePairingSignal(code);
    if (offer.kind !== 'offer') throw new Error('Scan the invitation shown on the sending device.');

    const peerConnection = new RTCPeerConnection({ iceServers: [] });
    const peer = new OpticalExchangePeer(peerConnection);
    await peerConnection.setRemoteDescription(offer.description);
    await peerConnection.setLocalDescription(await peerConnection.createAnswer());
    await waitForIceGathering(peerConnection);
    if (!peerConnection.localDescription) throw new Error('Could not create a local exchange answer.');

    const answerCode = await encodePairingSignal({
        kind: 'answer',
        sessionId: offer.sessionId,
        secret: offer.secret,
        description: peerConnection.localDescription.toJSON(),
    });
    return {
        peer,
        answerCode,
        pairingCode: displayPairingCode(offer.secret),
        invitation: offer.invitation,
    };
}
