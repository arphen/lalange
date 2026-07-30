import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'child_process'
import { PWA_MAX_PRECACHE_FILE_BYTES, PWA_PRECACHE_GLOB_IGNORES } from './pwa.config'

// Get commit hash, with fallback for CI environments without git history
let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Cloudflare Pages sets CF_PAGES_COMMIT_SHA
  commitHash = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || 'unknown';
}

// https://vite.dev/config/
export default defineConfig(() => {
  const useHttps = process.env.VITE_HTTPS === '1';

  const plugins: PluginOption[] = [
    useHttps && basicSsl(),
    react(),
    VitePWA({
      registerType: 'prompt', // Show update prompt instead of auto-updating
      devOptions: {
        enabled: false,
      },
      workbox: {
        maximumFileSizeToCacheInBytes: PWA_MAX_PRECACHE_FILE_BYTES,
        // Optional AI and TTS runtimes load on demand and manage their own caches.
        globIgnores: PWA_PRECACHE_GLOB_IGNORES,
      },
      manifest: {
        name: "XYZ",
        short_name: "XYZ",
        start_url: "/",
        display: "standalone",
        background_color: "#000000",
        theme_color: "#000000",
        icons: [
          { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
          { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
        ]
      }
    }),
  ].filter(Boolean);

  return {
    define: {
      __COMMIT_HASH__: JSON.stringify(commitHash),
    },
    optimizeDeps: {
      exclude: ['@mlc-ai/web-llm'], // Skip optimizing the package itself
      entries: ['index.html'],      // Only scan the root index.html, ignoring examples in packages/
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'web-llm': ['@mlc-ai/web-llm'],
          },
        },
      },
    },
    plugins,
    server: {
      host: true,
      ...(useHttps ? { https: {} } : {}),
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      }
    }
  }
})
