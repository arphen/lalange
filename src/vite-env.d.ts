/// <reference types="vite/client" />

declare const __COMMIT_HASH__: string;

// vite-plugin-pwa virtual module
declare module 'virtual:pwa-register' {
    export interface RegisterSWOptions {
        immediate?: boolean;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
        onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
        onRegisterError?: (error: Error) => void;
    }
    
    export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
