import { describe, expect, it } from 'vitest';
import { shouldUseLargeModelCache } from './modelCache';

describe('shouldUseLargeModelCache', () => {
    it('routes fp32 weights to the large-object cache', () => {
        expect(shouldUseLargeModelCache(
            'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx',
        )).toBe(true);
    });

    it('keeps quantized weights in the normal browser cache', () => {
        expect(shouldUseLargeModelCache(
            'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model_quantized.onnx',
        )).toBe(false);
    });
});