/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;

interface ImportMetaEnv {
	readonly VITE_WEBRTC_ICE_SERVERS?: string;
}
