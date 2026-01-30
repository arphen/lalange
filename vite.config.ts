import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'child_process'

// Get commit hash, with fallback for CI environments without git history
let commitHash = 'unknown';
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Cloudflare Pages sets CF_PAGES_COMMIT_SHA
  commitHash = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) || 'unknown';
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  const plugins: PluginOption[] = [
    basicSsl(),
    react(),
    !isDev && VitePWA({
      registerType: 'prompt', // Show update prompt instead of auto-updating
      workbox: {
        maximumFileSizeToCacheInBytes: 128 * 1024 * 1024, // 128MB - needed for ONNX WASM runtime and large TTS model files
        // Don't precache LLM model files - they're managed by web-llm in IndexedDB
        globIgnores: ['**/local_models/**'],
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
    plugins,
    server: {
      host: true,
      headers: {
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      }
    }
  }
})
