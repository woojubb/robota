import { describe, it, expect } from 'vitest';
import {
    isNodeConfigValue,
    extractConfigDefaultsFromSchema,
    mergeConfigWithDefaults
} from '../schema-defaults';

describe('isNodeConfigValue', () => {
    it('accepts string', () => {
        expect(isNodeConfigValue('hello')).toBe(true);
    });

    it('accepts number', () => {
        expect(isNodeConfigValue(42)).toBe(true);
    });

    it('accepts boolean', () => {
        expect(isNodeConfigValue(true)).toBe(true);
    });

    it('accepts null', () => {
        expect(isNodeConfigValue(null)).toBe(true);
    });

    it('accepts nested object', () => {
        expect(isNodeConfigValue({ a: 'b', c: 1 })).toBe(true);
    });

    it('accepts array of primitives', () => {
        expect(isNodeConfigValue([1, 'two', true])).toBe(true);
    });

    it('rejects undefined', () => {
        expect(isNodeConfigValue(undefined)).toBe(false);
    });

    it('rejects function', () => {
        expect(isNodeConfigValue(() => {})).toBe(false);
    });
});

describe('extractConfigDefaultsFromSchema', () => {
    it('returns empty object for non-object input', () => {
        expect(extractConfigDefaultsFromSchema(null)).toEqual({});
        expect(extractConfigDefaultsFromSchema(undefined)).toEqual({});
        expect(extractConfigDefaultsFromSchema('string')).toEqual({});
    });

    it('extracts simple defaults', () => {
        const schema = {
            properties: {
                name: { default: 'test' },
                count: { default: 5 }
            }
        };
        expect(extractConfigDefaultsFromSchema(schema)).toEqual({
            name: 'test',
            count: 5
        });
    });

    it('extracts nested object defaults', () => {
        const schema = {
            properties: {
                nested: {
                    properties: {
                        inner: { default: 'value' }
                    }
                }
            }
        };
        expect(extractConfigDefaultsFromSchema(schema)).toEqual({
            nested: { inner: 'value' }
        });
    });

    it('resolves $ref references', () => {
        const schema = {
            definitions: {
                MyType: {
                    properties: {
                        field: { default: 'resolved' }
                    }
                }
            },
            properties: {
                config: { $ref: '#/definitions/MyType' }
            }
        };
        expect(extractConfigDefaultsFromSchema(schema)).toEqual({
            config: { field: 'resolved' }
        });
    });

    it('skips properties without defaults', () => {
        const schema = {
            properties: {
                hasDefault: { default: 'yes' },
                noDefault: { type: 'string' }
            }
        };
        expect(extractConfigDefaultsFromSchema(schema)).toEqual({
            hasDefault: 'yes'
        });
    });
});

describe('mergeConfigWithDefaults', () => {
    it('returns defaults when current is empty', () => {
        const defaults = { a: 'default', b: 42 };
        expect(mergeConfigWithDefaults({}, defaults)).toEqual(defaults);
    });

    it('current values override defaults', () => {
        const current = { a: 'override' };
        const defaults = { a: 'default', b: 42 };
        expect(mergeConfigWithDefaults(current, defaults)).toEqual({
            a: 'override',
            b: 42
        });
    });

    it('deep merges nested objects', () => {
        const current = { nested: { a: 'override' } };
        const defaults = { nested: { a: 'default', b: 'keep' } };
        expect(mergeConfigWithDefaults(current, defaults)).toEqual({
            nested: { a: 'override', b: 'keep' }
        });
    });

    it('does not deep merge arrays', () => {
        const current = { list: [1, 2] };
        const defaults = { list: [3, 4, 5] };
        expect(mergeConfigWithDefaults(current, defaults)).toEqual({
            list: [1, 2]
        });
    });

    it('returns empty when both are empty', () => {
        expect(mergeConfigWithDefaults({}, {})).toEqual({});
    });
});
