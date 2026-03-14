import { describe, it, expect } from 'vitest';
import { CelCostEvaluator } from '../services/cel-cost-evaluator.js';

describe('CelCostEvaluator', () => {
    const evaluator = new CelCostEvaluator();

    it('evaluates fixed cost formula', () => {
        const result = evaluator.evaluate('0.0', {});
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(0);
    });

    it('evaluates formula with input context', () => {
        const result = evaluator.evaluate(
            'double(size(input.prompt)) / 4.0 * rate',
            { input: { prompt: 'hello world' }, rate: 0.001 },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBeCloseTo(0.00275, 4);
    });

    it('evaluates formula with config and variables', () => {
        const result = evaluator.evaluate(
            'baseCost + (size(input.images) > 0 ? surcharge : 0.0)',
            { input: { images: ['img.png'] }, baseCost: 8.0, surcharge: 2.0 },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(10.0);
    });

    it('evaluates lookup table formula', () => {
        const result = evaluator.evaluate(
            'double(tokens) * rates[model]',
            { tokens: 1000, model: 'gpt-4o-mini', rates: { 'gpt-4o-mini': 0.15 } },
        );
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.value).toBe(150.0);
    });

    it('returns error for invalid formula', () => {
        const result = evaluator.evaluate('invalid +++', {});
        expect(result.ok).toBe(false);
    });

    it('returns error for non-numeric result', () => {
        const result = evaluator.evaluate('"hello"', {});
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('CEL_NON_NUMERIC');
    });

    it('validates formula without evaluating', () => {
        expect(evaluator.validate('1 + 2').ok).toBe(true);
        expect(evaluator.validate('invalid +++').ok).toBe(false);
    });
});
