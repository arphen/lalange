import { describe, it, expect, beforeEach } from 'vitest';
import { 
    createDurationStrategy, 
    createLegacyStrategy, 
    createSentenceBudgetStrategy,
    createConstantStrategy,
    getAvailableStrategies,
    DEFAULT_STRATEGY_ID,
    type DurationContext,
    type WordMeta,
} from './index';

describe('Duration Strategy Factory', () => {
    it('should create legacy strategy', () => {
        const strategy = createDurationStrategy('legacy');
        expect(strategy.id).toBe('legacy');
        expect(strategy.name).toBeDefined();
    });

    it('should create sentence-budget strategy', () => {
        const strategy = createDurationStrategy('sentence-budget');
        expect(strategy.id).toBe('sentence-budget');
    });

    it('should create constant strategy', () => {
        const strategy = createDurationStrategy('constant');
        expect(strategy.id).toBe('constant');
    });

    it('should throw for unknown strategy', () => {
        expect(() => createDurationStrategy('unknown' as never)).toThrow();
    });

    it('should list available strategies', () => {
        const strategies = getAvailableStrategies();
        expect(strategies.length).toBeGreaterThanOrEqual(3);
        expect(strategies.find(s => s.id === 'legacy')).toBeDefined();
        expect(strategies.find(s => s.id === 'sentence-budget')).toBeDefined();
    });

    it('should have a valid default strategy', () => {
        const strategy = createDurationStrategy(DEFAULT_STRATEGY_ID);
        expect(strategy).toBeDefined();
    });
});

describe('Legacy Duration Strategy', () => {
    const strategy = createLegacyStrategy();
    const context: DurationContext = { wpm: 300, tFloor: 75 };

    const createMeta = (word: string, density = 1.0): WordMeta => ({
        word,
        sentenceIndex: 0,
        sentenceLength: 1,
        density,
        isSentenceEnd: word.endsWith('.') || word.endsWith('!') || word.endsWith('?'),
        isClauseEnd: word.endsWith(';') || word.endsWith(':'),
        isPause: word.endsWith(','),
    });

    it('should calculate duration for normal word', () => {
        const result = strategy.calculateDuration(createMeta('hello'), context);
        // T_floor (75) + baseInterval*1.0 (200) + visual (25*sqrt(5) ≈ 56) = ~331
        expect(result.duration).toBeGreaterThan(300);
        expect(result.duration).toBeLessThan(400);
    });

    it('should add extra time for sentence-ending punctuation', () => {
        const normalResult = strategy.calculateDuration(createMeta('word'), context);
        const periodResult = strategy.calculateDuration(createMeta('word.'), context);
        
        // Period should add ~300ms (plus a small amount for the extra character length)
        const diff = periodResult.duration - normalResult.duration;
        expect(diff).toBeGreaterThan(295);
        expect(diff).toBeLessThan(320);
    });

    it('should add extra time for commas', () => {
        const normalResult = strategy.calculateDuration(createMeta('word'), context);
        const commaResult = strategy.calculateDuration(createMeta('word,'), context);
        
        // Comma should add ~150ms (plus a small amount for the extra character length)
        const diff = commaResult.duration - normalResult.duration;
        expect(diff).toBeGreaterThan(145);
        expect(diff).toBeLessThan(170);
    });

    it('should increase duration for high-density words', () => {
        const normalResult = strategy.calculateDuration(createMeta('word', 1.0), context);
        const denseResult = strategy.calculateDuration(createMeta('word', 2.0), context);
        
        // Double density should roughly double the info component
        expect(denseResult.duration).toBeGreaterThan(normalResult.duration);
    });

    it('should increase duration for longer words', () => {
        const shortResult = strategy.calculateDuration(createMeta('cat'), context);
        const longResult = strategy.calculateDuration(createMeta('extraordinarily'), context);
        
        expect(longResult.duration).toBeGreaterThan(shortResult.duration);
    });

    it('should provide breakdown in result', () => {
        const result = strategy.calculateDuration(createMeta('test.'), context);
        
        expect(result.breakdown).toBeDefined();
        expect(result.breakdown!.base).toBe(75);
        expect(result.breakdown!.punctuation).toBe(300);
    });
});

describe('Sentence Budget Duration Strategy', () => {
    let strategy: ReturnType<typeof createSentenceBudgetStrategy>;
    const context: DurationContext = { wpm: 300, tFloor: 75 };

    beforeEach(() => {
        strategy = createSentenceBudgetStrategy();
    });

    const createMeta = (word: string, sentenceIndex: number, sentenceLength: number, density = 1.0): WordMeta => ({
        word,
        sentenceIndex,
        sentenceLength,
        density,
        isSentenceEnd: word.endsWith('.') || word.endsWith('!') || word.endsWith('?'),
        isClauseEnd: word.endsWith(';') || word.endsWith(':'),
        isPause: word.endsWith(','),
    });

    it('should maintain approximate WPM budget', () => {
        const words = ['The', 'quick', 'brown', 'fox', 'jumps.'];
        const densities = [1.0, 1.0, 1.0, 1.0, 1.0];
        
        strategy.prepareSentence?.(words, densities, context);

        let totalDuration = 0;
        for (let i = 0; i < words.length; i++) {
            const meta = createMeta(words[i], i, words.length, densities[i]);
            const result = strategy.calculateDuration(meta, context);
            totalDuration += result.duration;
        }

        // Expected budget: 5 words * (60000/300) = 1000ms
        // Allow some variance for floor constraints
        expect(totalDuration).toBeGreaterThan(900);
        expect(totalDuration).toBeLessThan(1200);
    });

    it('should give more time to high-density words', () => {
        const words = ['easy', 'difficult', 'normal.'];
        const densities = [0.5, 2.0, 1.0];
        
        strategy.prepareSentence?.(words, densities, context);

        const durations = words.map((word, i) => {
            const meta = createMeta(word, i, words.length, densities[i]);
            return strategy.calculateDuration(meta, context).duration;
        });

        // Difficult word should get more time than easy word
        expect(durations[1]).toBeGreaterThan(durations[0]);
    });

    it('should give more time to sentence-ending punctuation', () => {
        const words = ['word', 'word.'];
        const densities = [1.0, 1.0];
        
        strategy.prepareSentence?.(words, densities, context);

        const durations = words.map((word, i) => {
            const meta = createMeta(word, i, words.length, densities[i]);
            return strategy.calculateDuration(meta, context).duration;
        });

        // Word with period should get more time
        expect(durations[1]).toBeGreaterThan(durations[0]);
    });

    it('should respect tFloor constraint', () => {
        const words = ['a', 'extraordinarily.'];
        const densities = [0.1, 2.0]; // Very low density for 'a'
        
        strategy.prepareSentence?.(words, densities, context);

        const meta = createMeta('a', 0, 2, densities[0]);
        const result = strategy.calculateDuration(meta, context);

        // Should not go below floor
        expect(result.duration).toBeGreaterThanOrEqual(context.tFloor);
    });

    it('should reset state correctly', () => {
        const words = ['test.'];
        const densities = [1.0];
        
        strategy.prepareSentence?.(words, densities, context);
        strategy.reset?.();

        // After reset, should fallback to basic calculation
        const meta = createMeta('newword', 0, 1, 1.0);
        const result = strategy.calculateDuration(meta, context);
        
        // Should still return a valid duration
        expect(result.duration).toBeGreaterThan(0);
    });
});

describe('Constant Duration Strategy', () => {
    const strategy = createConstantStrategy();
    const context: DurationContext = { wpm: 300, tFloor: 75 };

    const createMeta = (word: string): WordMeta => ({
        word,
        sentenceIndex: 0,
        sentenceLength: 1,
        density: 1.0,
        isSentenceEnd: false,
        isClauseEnd: false,
        isPause: false,
    });

    it('should return same duration for all words', () => {
        const results = [
            strategy.calculateDuration(createMeta('short'), context),
            strategy.calculateDuration(createMeta('extraordinarily'), context),
            strategy.calculateDuration(createMeta('word.'), context),
            strategy.calculateDuration(createMeta('word,'), context),
        ];

        // All durations should be equal
        const firstDuration = results[0].duration;
        results.forEach(r => {
            expect(r.duration).toBe(firstDuration);
        });
    });

    it('should calculate duration from WPM', () => {
        const result = strategy.calculateDuration(createMeta('word'), context);
        
        // 60000 / 300 = 200ms
        expect(result.duration).toBe(200);
    });

    it('should respect tFloor at high WPM', () => {
        const fastContext: DurationContext = { wpm: 1000, tFloor: 75 };
        const result = strategy.calculateDuration(createMeta('word'), fastContext);
        
        // 60000 / 1000 = 60ms, but floor is 75
        expect(result.duration).toBe(75);
    });
});
