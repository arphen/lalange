import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = join(projectRoot, 'public', 'ocr-assets');
const tesseractRoot = join(projectRoot, 'node_modules', 'tesseract.js');
const coreRoot = join(projectRoot, 'node_modules', 'tesseract.js-core');
const englishRoot = join(projectRoot, 'node_modules', '@tesseract.js-data', 'eng');
const coreOutput = join(assetRoot, 'tesseract-core');
const languageOutput = join(assetRoot, 'tessdata', '4.0.0_best_int');

mkdirSync(coreOutput, { recursive: true });
mkdirSync(languageOutput, { recursive: true });

cpSync(join(tesseractRoot, 'dist', 'worker.min.js'), join(assetRoot, 'worker.min.js'));

for (const filename of readdirSync(coreRoot)) {
    if (!/^tesseract-core-(?:lstm|simd-lstm|relaxedsimd-lstm)\.wasm(?:\.js)?$/.test(filename)) continue;
    cpSync(join(coreRoot, filename), join(coreOutput, filename));
}

cpSync(
    join(englishRoot, '4.0.0_best_int', 'eng.traineddata.gz'),
    join(languageOutput, 'eng.traineddata.gz'),
);

console.log('Prepared local PDF OCR assets in public/ocr-assets.');