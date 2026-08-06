export const PWA_MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;
export const PWA_INJECT_REGISTER = false as const;
export const PWA_PRECACHE_GLOB_PATTERNS = ['**/*.{js,mjs,css,html}'];

export const PWA_PRECACHE_GLOB_IGNORES = [
  '**/local_models/**',
  '**/*.wasm',
  '**/assets/web-llm-*.js',
  '**/assets/kokoro-*.js',
  '**/assets/transformers.web-*.js',
  // Piper (Slovenian TTS) and its ONNX Runtime, pulled in only on first use.
  '**/assets/piper-*.js',
  '**/assets/voices_static-*.js',
  '**/assets/ort.min-*.js',
  '**/ocr-assets/**',
];