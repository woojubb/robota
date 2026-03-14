import { describe, expect, it } from 'vitest';
import { NodeIoAccessor } from '../lifecycle/node-io-accessor.js';

describe('NodeIoAccessor', () => {
    describe('getInput', () => {
        it('returns existing input value', () => {
            const accessor = new NodeIoAccessor({ text: 'hello' }, 'node-1');
            expect(accessor.getInput('text')).toBe('hello');
        });

        it('returns undefined for missing key', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            expect(accessor.getInput('missing')).toBeUndefined();
        });
    });

    describe('requireInput', () => {
        it('returns value when present', () => {
            const accessor = new NodeIoAccessor({ text: 'hello' }, 'node-1');
            const result = accessor.requireInput('text');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toBe('hello');
        });

        it('returns error for missing key', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInput('missing');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
        });
    });

    describe('requireInputString', () => {
        it('returns string value', () => {
            const accessor = new NodeIoAccessor({ text: 'hello' }, 'node-1');
            const result = accessor.requireInputString('text');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toBe('hello');
        });

        it('returns error for non-string value', () => {
            const accessor = new NodeIoAccessor({ num: 42 }, 'node-1');
            const result = accessor.requireInputString('num');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        });

        it('returns error for missing key', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInputString('missing');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
        });
    });

    describe('requireInputArray', () => {
        it('returns direct array value', () => {
            const accessor = new NodeIoAccessor({ items: ['a', 'b'] }, 'node-1');
            const result = accessor.requireInputArray('items');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toEqual(['a', 'b']);
        });

        it('collects list handle values (images[0], images[1])', () => {
            const accessor = new NodeIoAccessor(
                { 'images[0]': 'img0', 'images[1]': 'img1' },
                'node-1'
            );
            const result = accessor.requireInputArray('images');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toEqual(['img0', 'img1']);
        });

        it('returns error for missing array key with no handles', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInputArray('missing');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MISSING');
        });

        it('returns error for non-array value with no handles', () => {
            const accessor = new NodeIoAccessor({ items: 'not-array' }, 'node-1');
            const result = accessor.requireInputArray('items');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        });
    });

    describe('requireInputBinary', () => {
        const validBinary = {
            kind: 'image' as const,
            mimeType: 'image/png',
            uri: 'https://example.com/img.png'
        };

        it('returns parsed binary value', () => {
            const accessor = new NodeIoAccessor({ image: validBinary }, 'node-1');
            const result = accessor.requireInputBinary('image');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.kind).toBe('image');
        });

        it('returns error for missing key', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInputBinary('missing');
            expect(result.ok).toBe(false);
        });

        it('returns error for invalid binary', () => {
            const accessor = new NodeIoAccessor({ image: 'not-binary' }, 'node-1');
            const result = accessor.requireInputBinary('image');
            expect(result.ok).toBe(false);
        });

        it('validates kind constraint', () => {
            const accessor = new NodeIoAccessor({ image: validBinary }, 'node-1');
            const result = accessor.requireInputBinary('image', 'video');
            expect(result.ok).toBe(false);
        });
    });

    describe('requireInputBinaryList', () => {
        const makeBinary = (kind: string) => ({
            kind,
            mimeType: 'image/png',
            uri: 'https://example.com/img.png'
        });

        it('returns parsed binary list', () => {
            const accessor = new NodeIoAccessor(
                { images: [makeBinary('image'), makeBinary('image')] },
                'node-1'
            );
            const result = accessor.requireInputBinaryList('images', 'image');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value).toHaveLength(2);
        });

        it('returns error when below minItems', () => {
            const accessor = new NodeIoAccessor(
                { images: [makeBinary('image')] },
                'node-1'
            );
            const result = accessor.requireInputBinaryList('images', 'image', { minItems: 2 });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MIN_ITEMS_NOT_SATISFIED');
        });

        it('returns error when above maxItems', () => {
            const accessor = new NodeIoAccessor(
                { images: [makeBinary('image'), makeBinary('image'), makeBinary('image')] },
                'node-1'
            );
            const result = accessor.requireInputBinaryList('images', 'image', { maxItems: 2 });
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_MAX_ITEMS_EXCEEDED');
        });

        it('returns error when individual item is invalid binary', () => {
            const accessor = new NodeIoAccessor(
                { images: ['not-binary', makeBinary('image')] },
                'node-1'
            );
            const result = accessor.requireInputBinaryList('images');
            expect(result.ok).toBe(false);
        });
    });

    describe('requireInputMediaReference', () => {
        it('parses object media reference', () => {
            const accessor = new NodeIoAccessor(
                { ref: { referenceType: 'uri', uri: 'https://example.com' } },
                'node-1'
            );
            const result = accessor.requireInputMediaReference('ref');
            expect(result.ok).toBe(true);
        });

        it('parses string URI when allowStringUri is true', () => {
            const accessor = new NodeIoAccessor(
                { ref: 'https://example.com' },
                'node-1'
            );
            const result = accessor.requireInputMediaReference('ref', { allowStringUri: true });
            expect(result.ok).toBe(true);
        });

        it('parses asset:// string when allowStringAssetUri is true', () => {
            const accessor = new NodeIoAccessor(
                { ref: 'asset://my-asset' },
                'node-1'
            );
            const result = accessor.requireInputMediaReference('ref', { allowStringAssetUri: true });
            expect(result.ok).toBe(true);
        });

        it('returns error for string without allowStringUri option', () => {
            const accessor = new NodeIoAccessor(
                { ref: 'https://example.com' },
                'node-1'
            );
            const result = accessor.requireInputMediaReference('ref');
            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('DAG_VALIDATION_NODE_INPUT_TYPE_MISMATCH');
        });

        it('returns error for null value', () => {
            const accessor = new NodeIoAccessor({ ref: null }, 'node-1');
            const result = accessor.requireInputMediaReference('ref');
            expect(result.ok).toBe(false);
        });

        it('returns error for array value', () => {
            const accessor = new NodeIoAccessor({ ref: [] }, 'node-1');
            const result = accessor.requireInputMediaReference('ref');
            expect(result.ok).toBe(false);
        });

        it('returns error for missing key', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInputMediaReference('missing');
            expect(result.ok).toBe(false);
        });
    });

    describe('requireInputBinaryReference', () => {
        const validBinary = {
            kind: 'image' as const,
            mimeType: 'image/png',
            uri: 'https://example.com/img.png'
        };

        it('parses binary value into MediaReference', () => {
            const accessor = new NodeIoAccessor({ image: validBinary }, 'node-1');
            const result = accessor.requireInputBinaryReference('image', 'image');
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            expect(result.value.isUri()).toBe(true);
        });

        it('returns error for missing input', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            const result = accessor.requireInputBinaryReference('missing');
            expect(result.ok).toBe(false);
        });
    });

    describe('setOutput / toOutput', () => {
        it('builds output payload from setOutput calls', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            accessor.setOutput('result', 'done');
            accessor.setOutput('count', 42);
            const output = accessor.toOutput();
            expect(output).toEqual({ result: 'done', count: 42 });
        });

        it('toOutput returns a copy', () => {
            const accessor = new NodeIoAccessor({}, 'node-1');
            accessor.setOutput('a', 1);
            const out1 = accessor.toOutput();
            accessor.setOutput('b', 2);
            const out2 = accessor.toOutput();
            expect(out1).not.toEqual(out2);
        });
    });
});
