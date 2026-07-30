export const PWA_MAX_PRECACHE_FILE_BYTES = 2 * 1024 * 1024;

export const PWA_PRECACHE_GLOB_IGNORES = [
  '**/local_models/**',
  '**/*.wasm',
  '**/assets/web-llm-*.js',
  '**/assets/kokoro-*.js',
  '**/assets/transformers.web-*.js',
];