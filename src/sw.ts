import { clientsClaim } from 'workbox-core';
import {
    cleanupOutdatedCaches,
    createHandlerBoundToURL,
    precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
    GET_DEPLOYMENT_METADATA,
    type DeploymentMetadata,
} from './core/pwa/updateProtocol';
import { fetchNavigationWithFallback } from './core/pwa/navigationFallback';

interface InjectedServiceWorkerScope {
    skipWaiting(): Promise<void>;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

declare global {
    interface Window {
        __WB_MANIFEST: Array<string | { url: string; revision?: string | null }>;
    }
}

const serviceWorker = globalThis as unknown as InjectedServiceWorkerScope;
const deploymentMetadata: DeploymentMetadata = { hash: __COMMIT_HASH__ };

void serviceWorker.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
const offlineAppHandler = createHandlerBoundToURL('index.html');
registerRoute(new NavigationRoute((options) => fetchNavigationWithFallback(
    options.request,
    (request) => fetch(request),
    () => offlineAppHandler(options),
)));
registerRoute(
    ({ url }) => url.pathname === '/version.json',
    () => Promise.resolve(new Response(JSON.stringify(deploymentMetadata), {
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json',
        },
    })),
);

serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== GET_DEPLOYMENT_METADATA) return;

    event.ports[0]?.postMessage(deploymentMetadata);
});