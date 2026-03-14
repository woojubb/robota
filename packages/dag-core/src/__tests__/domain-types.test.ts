import { describe, expect, it } from 'vitest';
import {
    buildListPortHandleKey,
    parseListPortHandleKey
} from '../types/domain.js';

describe('buildListPortHandleKey', () => {
    it('builds handle key for index 0', () => {
        expect(buildListPortHandleKey('images', 0)).toBe('images[0]');
    });

    it('builds handle key for index 5', () => {
        expect(buildListPortHandleKey('items', 5)).toBe('items[5]');
    });
});

describe('parseListPortHandleKey', () => {
    it('parses valid handle key', () => {
        const result = parseListPortHandleKey('images[0]');
        expect(result).toEqual({ portKey: 'images', index: 0 });
    });

    it('parses handle key with larger index', () => {
        const result = parseListPortHandleKey('items[42]');
        expect(result).toEqual({ portKey: 'items', index: 42 });
    });

    it('returns undefined for key without brackets', () => {
        expect(parseListPortHandleKey('images')).toBeUndefined();
    });

    it('returns undefined for key with no opening bracket', () => {
        expect(parseListPortHandleKey('images0]')).toBeUndefined();
    });

    it('returns undefined for key with non-numeric index', () => {
        expect(parseListPortHandleKey('images[abc]')).toBeUndefined();
    });

    it('returns undefined when bracket is at position 0', () => {
        expect(parseListPortHandleKey('[0]')).toBeUndefined();
    });
});
