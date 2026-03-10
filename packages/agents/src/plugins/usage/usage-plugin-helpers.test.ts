import { describe, it, expect } from 'vitest';
import {
    resolvePluginOptions,
    validateUsageOptions,
    calculateCost,
    isModuleSuccessEvent,
    isModuleErrorEvent,
    extractStringField,
    resolveOperation
} from './usage-plugin-helpers';
import { ConfigurationError } from '../../utils/errors';
import { EVENT_EMITTER_EVENTS } from '../event-emitter/types';

describe('usage-plugin-helpers', () => {
    describe('resolvePluginOptions', () => {
        it('returns defaults for minimal options', () => {
            const resolved = resolvePluginOptions({ strategy: 'memory' });
            expect(resolved.strategy).toBe('memory');
            expect(resolved.enabled).toBe(true);
            expect(resolved.trackCosts).toBe(true);
            expect(resolved.maxEntries).toBe(10000);
            expect(resolved.batchSize).toBe(50);
            expect(resolved.flushInterval).toBe(60000);
            expect(resolved.aggregateStats).toBe(true);
            expect(resolved.aggregationInterval).toBe(300000);
        });

        it('preserves explicit costRates', () => {
            const rates = { 'gpt-4': { input: 0.03, output: 0.06 } };
            const resolved = resolvePluginOptions({ strategy: 'memory', costRates: rates });
            expect(resolved.costRates).toEqual(rates);
        });

        it('omits costRates when not provided', () => {
            const resolved = resolvePluginOptions({ strategy: 'memory' });
            expect(resolved.costRates).toBeUndefined();
        });
    });

    describe('calculateCost', () => {
        const rates = { 'gpt-4': { input: 0.03, output: 0.06 } };

        it('calculates cost for known model', () => {
            const cost = calculateCost(rates, 'gpt-4', { input: 100, output: 50 });
            expect(cost).toEqual({ input: 3, output: 3, total: 6 });
        });

        it('returns undefined for unknown model', () => {
            expect(calculateCost(rates, 'unknown', { input: 100, output: 50 })).toBeUndefined();
        });

        it('returns undefined when no rates provided', () => {
            expect(calculateCost(undefined, 'gpt-4', { input: 100, output: 50 })).toBeUndefined();
        });
    });

    describe('validateUsageOptions', () => {
        it('passes for valid memory options', () => {
            expect(() => validateUsageOptions({ strategy: 'memory' })).not.toThrow();
        });

        it('passes for valid file options', () => {
            expect(() => validateUsageOptions({ strategy: 'file', filePath: '/tmp/usage.json' })).not.toThrow();
        });

        it('passes for valid remote options', () => {
            expect(() => validateUsageOptions({ strategy: 'remote', remoteEndpoint: 'http://example.com' })).not.toThrow();
        });

        it('throws for empty strategy', () => {
            expect(() => validateUsageOptions({ strategy: '' as any })).toThrow(ConfigurationError);
        });

        it('throws for invalid strategy', () => {
            expect(() => validateUsageOptions({ strategy: 'invalid' as any })).toThrow(ConfigurationError);
        });

        it('throws for file strategy without filePath', () => {
            expect(() => validateUsageOptions({ strategy: 'file' })).toThrow(ConfigurationError);
        });

        it('throws for remote strategy without endpoint', () => {
            expect(() => validateUsageOptions({ strategy: 'remote' })).toThrow(ConfigurationError);
        });
    });

    describe('isModuleSuccessEvent', () => {
        it('returns true for module completion events', () => {
            expect(isModuleSuccessEvent(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE)).toBe(true);
            expect(isModuleSuccessEvent(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE)).toBe(true);
            expect(isModuleSuccessEvent(EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE)).toBe(true);
        });

        it('returns false for error events', () => {
            expect(isModuleSuccessEvent(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR)).toBe(false);
        });

        it('returns false for unrelated events', () => {
            expect(isModuleSuccessEvent('some.random.event')).toBe(false);
        });
    });

    describe('isModuleErrorEvent', () => {
        it('returns true for module error events', () => {
            expect(isModuleErrorEvent(EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR)).toBe(true);
            expect(isModuleErrorEvent(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR)).toBe(true);
            expect(isModuleErrorEvent(EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR)).toBe(true);
        });

        it('returns false for success events', () => {
            expect(isModuleErrorEvent(EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE)).toBe(false);
        });
    });

    describe('extractStringField', () => {
        it('extracts string field from object', () => {
            expect(extractStringField({ name: 'test' }, 'name')).toBe('test');
        });

        it('returns "unknown" for missing field', () => {
            expect(extractStringField({ name: 'test' }, 'missing')).toBe('unknown');
        });

        it('returns "unknown" for non-string field', () => {
            expect(extractStringField({ count: 42 }, 'count')).toBe('unknown');
        });

        it('returns "unknown" for null data', () => {
            expect(extractStringField(null, 'field')).toBe('unknown');
        });

        it('returns "unknown" for undefined data', () => {
            expect(extractStringField(undefined, 'field')).toBe('unknown');
        });
    });

    describe('resolveOperation', () => {
        it('returns "initialization" for initialize events', () => {
            expect(resolveOperation('module.initialize.complete')).toBe('initialization');
        });

        it('returns "execution" for execution events', () => {
            expect(resolveOperation('module.execution.complete')).toBe('execution');
        });

        it('returns "disposal" for other events', () => {
            expect(resolveOperation('module.dispose.complete')).toBe('disposal');
        });
    });
});
