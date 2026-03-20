import { describe, it, expect } from 'vitest';
import type { IPortDefinition } from '@robota-sdk/dag-core';
import {
    findPort,
    resolveInputPort,
    normalizePortOrders,
    validatePorts,
    applyBulkRequired,
    applyBulkType,
    removePortsByIndexes,
    summarizeRemovedBindings
} from '../port-editor-utils';

function makePort(overrides: Partial<IPortDefinition> & { key: string }): IPortDefinition {
    return {
        type: 'string',
        required: false,
        ...overrides
    };
}

describe('findPort', () => {
    const ports = [makePort({ key: 'a' }), makePort({ key: 'b' })];

    it('finds existing port by key', () => {
        expect(findPort(ports, 'a')?.key).toBe('a');
    });

    it('returns undefined for missing key', () => {
        expect(findPort(ports, 'missing')).toBeUndefined();
    });
});

describe('resolveInputPort', () => {
    const ports = [
        makePort({ key: 'images', isList: true }),
        makePort({ key: 'text' })
    ];

    it('resolves direct port', () => {
        const result = resolveInputPort(ports, 'text');
        expect(result.port?.key).toBe('text');
        expect(result.resolvedKey).toBe('text');
    });

    it('resolves list port handle', () => {
        const result = resolveInputPort(ports, 'images[0]');
        expect(result.port?.key).toBe('images');
        expect(result.resolvedKey).toBe('images');
    });

    it('returns undefined for unknown port', () => {
        const result = resolveInputPort(ports, 'unknown');
        expect(result.port).toBeUndefined();
    });
});

describe('normalizePortOrders', () => {
    it('assigns sequential order values', () => {
        const ports = [makePort({ key: 'a', order: 5 }), makePort({ key: 'b', order: 10 })];
        const result = normalizePortOrders(ports);
        expect(result[0].order).toBe(0);
        expect(result[1].order).toBe(1);
    });
});

describe('validatePorts', () => {
    it('passes for valid ports', () => {
        const ports = [makePort({ key: 'input1' })];
        const result = validatePorts(ports);
        expect(result.errors).toHaveLength(0);
    });

    it('rejects empty key', () => {
        const ports = [makePort({ key: '' })];
        const result = validatePorts(ports);
        expect(result.errors.some((e) => e.field === 'key')).toBe(true);
    });

    it('rejects duplicate keys', () => {
        const ports = [makePort({ key: 'dup' }), makePort({ key: 'dup' })];
        const result = validatePorts(ports);
        expect(result.errors.filter((e) => e.message.includes('Duplicate'))).toHaveLength(2);
    });

    it('rejects negative order', () => {
        const ports = [makePort({ key: 'a', order: -1 })];
        const result = validatePorts(ports);
        expect(result.errors.some((e) => e.field === 'order')).toBe(true);
    });

    it('requires binaryKind for binary type', () => {
        const ports = [makePort({ key: 'img', type: 'binary' })];
        const result = validatePorts(ports);
        expect(result.errors.some((e) => e.field === 'binaryKind')).toBe(true);
    });
});

describe('applyBulkRequired', () => {
    it('sets required on selected indexes', () => {
        const ports = [makePort({ key: 'a' }), makePort({ key: 'b' }), makePort({ key: 'c' })];
        const result = applyBulkRequired(ports, [0, 2], true);
        expect(result[0].required).toBe(true);
        expect(result[1].required).toBe(false);
        expect(result[2].required).toBe(true);
    });
});

describe('applyBulkType', () => {
    it('changes type for selected indexes', () => {
        const ports = [makePort({ key: 'a' }), makePort({ key: 'b' })];
        const result = applyBulkType(ports, [1], 'number');
        expect(result[0].type).toBe('string');
        expect(result[1].type).toBe('number');
    });

    it('adds binaryKind when changing to binary', () => {
        const ports = [makePort({ key: 'a' })];
        const result = applyBulkType(ports, [0], 'binary');
        expect(result[0].type).toBe('binary');
        expect(result[0].binaryKind).toBe('file');
    });
});

describe('removePortsByIndexes', () => {
    it('removes ports at specified indexes', () => {
        const ports = [makePort({ key: 'a' }), makePort({ key: 'b' }), makePort({ key: 'c' })];
        const result = removePortsByIndexes(ports, [1]);
        expect(result).toHaveLength(2);
        expect(result.map((p) => p.key)).toEqual(['a', 'c']);
    });
});

describe('summarizeRemovedBindings', () => {
    it('returns undefined for empty array', () => {
        expect(summarizeRemovedBindings([])).toBeUndefined();
    });

    it('summarizes removed bindings', () => {
        const removed = [{
            edgeId: 'a->b',
            binding: { outputKey: 'out', inputKey: 'in' },
            reason: 'output_not_found' as const
        }];
        const result = summarizeRemovedBindings(removed);
        expect(result).toContain('Removed 1');
        expect(result).toContain('a->b');
    });
});
