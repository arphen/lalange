import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { execSync } from 'child_process'

const commitHash = execSync('git rev-parse --short HEAD').toString().trim();

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  const plugins: PluginOption[] = [
    basicSsl(),
    react(),
    !isDev && VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        maximumFileSizeToCacheInBytes: 25 * 1024 * 1024, // 25MB - needed for ONNX WASM runtime
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
