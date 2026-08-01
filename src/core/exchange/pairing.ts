import { generateUUID } from '../../utils/uuid';
import type { ExchangeBundle, ExchangeInvitationSummary } from './types';

const LEGACY_CODE_PREFIX = 'xchg1';
const COMPACT_CODE_PREFIX = 'XCHG2';
const BASE45_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const MAX_INVITATION_BOOKS = 3;
const DATA_CHANNEL_LABEL = 'xyz-device-exchange-v1';
const MAX_CHUNK_BYTES = 32 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const BUFFER_LOW_THRESHOLD = 256 * 1024;
const ICE_GATHER_TIMEOUT_MS = 10000;
const PUBLIC_EXCHANGE_ORIGIN = import.meta.env.VITE_PUBLIC_APP_URL || 'https://arphen.xyz';
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.cloudflare.com:3478' },
];

export function buildExchangeIceServers(
    configuredServers = import.meta.env.VITE_WEBRTC_ICE_SERVERS,
): RTCIceServer[] {
    if (!configuredServers) return [...DEFAULT_ICE_SERVERS];

    let parsed: unknown;
    try {
        parsed = JSON.parse(configuredServers);
    } catch {
        throw new Error('VITE_WEBRTC_ICE_SERVERS must be a JSON array of WebRTC ICE servers.');
    }

    if (!Array.isArray(parsed) || parsed.some((server) => {
        if (!server || typeof server !== 'object' || !('urls' in server)) return true;
        const { urls } = server as { urls: unknown };
        return typeof urls !== 'string'
            && (!Array.isArray(urls) || urls.length === 0 || urls.some((url) => typeof url !== 'string'));
    })) {
        throw new Error('VITE_WEBRTC_ICE_SERVERS must be a JSON array of WebRTC ICE servers.');
    }

    return [...DEFAULT_ICE_SERVERS, ...(parsed as RTCIceServer[])];
}

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

type CompactInvitation = [
    intent: 0 | 1 | 2,
    sourceDeviceName: string,
    bookCount: number,
    books: Array<[title: string, author?: string]>,
];

type CompactPairingSignal = [
    kind: 0 | 1,
    sessionId: string,
    secret: string,
    sdp: string,
    invitation?: CompactInvitation,
];

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

function bytesToBase45(bytes: Uint8Array): string {
    let encoded = '';
    for (let index = 0; index < bytes.length; index += 2) {
        const value = index + 1 < bytes.length
            ? bytes[index] * 256 + bytes[index + 1]
            : bytes[index];
        encoded += BASE45_ALPHABET[value % 45];
        encoded += BASE45_ALPHABET[Math.floor(value / 45) % 45];
        if (index + 1 < bytes.length) encoded += BASE45_ALPHABET[Math.floor(value / (45 * 45))];
    }
        return encoded.replace(/%/g, '%25').replace(/ /g, '%20').replace(/\//g, '%2F');
}

function base45ToBytes(value: string): Uint8Array {
        const decodedValue = value.replace(/%20/g, ' ').replace(/%2F/g, '/').replace(/%25/g, '%');
    if (decodedValue.length % 3 === 1) throw new Error('Invalid Base45 payload.');

    const bytes: number[] = [];
    for (let index = 0; index < decodedValue.length; index += 3) {
        const chunkLength = Math.min(3, decodedValue.length - index);
        const first = BASE45_ALPHABET.indexOf(decodedValue[index]);
        const second = BASE45_ALPHABET.indexOf(decodedValue[index + 1]);
        const third = chunkLength === 3 ? BASE45_ALPHABET.indexOf(decodedValue[index + 2]) : 0;
        if (first < 0 || second < 0 || third < 0) throw new Error('Invalid Base45 payload.');

        const decoded = first + second * 45 + third * 45 * 45;
        if ((chunkLength === 3 && decoded > 0xffff) || (chunkLength === 2 && decoded > 0xff)) {
            throw new Error('Invalid Base45 payload.');
        }
        if (chunkLength === 3) bytes.push(decoded >> 8);
        bytes.push(decoded & 0xff);
    }
    return Uint8Array.from(bytes);
}

function compactPairingSignal(signal: PairingSignal): CompactPairingSignal {
    const compact: CompactPairingSignal = [
        signal.kind === 'offer' ? 0 : 1,
        signal.sessionId,
        signal.secret,
        signal.description.sdp || '',
    ];
    if (signal.kind === 'offer' && signal.invitation) {
        const intent = signal.invitation.intent === 'give' ? 0 : signal.invitation.intent === 'handoff' ? 1 : 2;
        compact.push([
            intent,
            signal.invitation.sourceDevice.name,
            signal.invitation.bookCount,
            signal.invitation.books.slice(0, MAX_INVITATION_BOOKS).map((book) => [book.title, book.author]),
        ]);
    }
    return compact;
}

function expandPairingSignal(signal: CompactPairingSignal): PairingSignal {
    const [kind, sessionId, secret, sdp, compactInvitation] = signal;
    if ((kind !== 0 && kind !== 1) || !sessionId || !secret || !sdp) {
        throw new Error('The device exchange code is incomplete.');
    }

    if (kind === 1) return { kind: 'answer', sessionId, secret, description: { type: 'answer', sdp } };

    let invitation: ExchangeInvitationSummary | undefined;
    if (compactInvitation) {
        const [intent, sourceDeviceName, bookCount, books] = compactInvitation;
        invitation = {
            intent: intent === 0 ? 'give' : intent === 1 ? 'handoff' : 'reconcile',
            scope: 'selection',
            sourceDevice: { id: '', name: sourceDeviceName, createdAt: 0 },
            bookCount,
            books: books.map(([title, author], index) => ({
                bookId: `preview-${index}`,
                title,
                author,
                estimatedBytes: 0,
            })),
            selection: {
                content: false,
                analysis: false,
                progress: false,
                highlights: false,
                listening: false,
            },
        };
    }
    return { kind: 'offer', sessionId, secret, description: { type: 'offer', sdp }, invitation };
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

export async function encodePairingSignal(signal: PairingSignal, legacy = false): Promise<string> {
    const encodedSignal = legacy ? signal : compactPairingSignal(signal);
    const json = new TextEncoder().encode(JSON.stringify(encodedSignal));
    const canCompress = typeof CompressionStream !== 'undefined';
    const payload = await compress(json);
    if (legacy) {
        return `${LEGACY_CODE_PREFIX}.${canCompress ? 'g' : 'j'}.${bytesToBase64Url(payload)}`;
    }
    return `${COMPACT_CODE_PREFIX}:${canCompress ? 'G' : 'J'}:${bytesToBase45(payload)}:`;
}

export async function decodePairingSignal(code: string): Promise<PairingSignal> {
    const normalizedCode = code.trim();
    if (/^[A-Z0-9]{6}$/i.test(normalizedCode)) {
        throw new Error('This is the verification code, not the full device exchange code. Copy the full answer code from the other device.');
    }
    const compactMatch = normalizedCode.match(/^XCHG2:(G|J):(.+):$/);
    if (compactMatch) {
        const json = await decompress(base45ToBytes(compactMatch[2]), compactMatch[1] === 'G');
        return expandPairingSignal(JSON.parse(new TextDecoder().decode(json)) as CompactPairingSignal);
    }

    const legacyMatch = normalizedCode.match(/^xchg1\.(g|j)\.([A-Za-z0-9_-]+)$/);
    if (!legacyMatch) throw new Error('This is not a valid device exchange code.');
    const json = await decompress(base64UrlToBytes(legacyMatch[2]), legacyMatch[1] === 'g');
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
    if (/^https?:/i.test(value)) {
        const url = new URL(value);
        const pathMatch = url.pathname.match(/^\/exchange\/(.+)$/i);
        if (pathMatch) return pathMatch[1];
    }
    const hash = /^https?:/i.test(value) ? new URL(value).hash : value;
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
    const peerConnection = new RTCPeerConnection({ iceServers: buildExchangeIceServers() });
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
    const publicOrigin = new URL(PUBLIC_EXCHANGE_ORIGIN).origin.toUpperCase();
    const invitationUrl = `${publicOrigin}/EXCHANGE/${offerCode}`;

    return {
        peer,
        offerCode,
        invitationUrl,
        pairingCode: displayPairingCode(secret),
    };
}

export async function answerOpticalExchangeOffer(codeOrUrl: string): Promise<ExchangeAnswerSession> {
    const code = extractPairingCode(codeOrUrl) ?? codeOrUrl;
    const useLegacyCode = code.trim().startsWith(`${LEGACY_CODE_PREFIX}.`);
    const offer = await decodePairingSignal(code);
    if (offer.kind !== 'offer') throw new Error('Scan the invitation shown on the sending device.');

    const peerConnection = new RTCPeerConnection({ iceServers: buildExchangeIceServers() });
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
    }, useLegacyCode);
    return {
        peer,
        answerCode,
        pairingCode: displayPairingCode(offer.secret),
        invitation: offer.invitation,
    };
}
