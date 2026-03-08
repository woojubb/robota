import { describe, expect, it } from 'vitest';
import {
    parseOptionalPositiveIntegerQuery,
    parseTaskRunPayloadSnapshot
} from '../dag-server-bootstrap.js';

describe('dag-server-bootstrap helpers', () => {
    describe('parseTaskRunPayloadSnapshot', () => {
        it('returns undefined for invalid JSON payload snapshots', () => {
            expect(parseTaskRunPayloadSnapshot('not-json')).toBeUndefined();
            expect(parseTaskRunPayloadSnapshot('"string"')).toBeUndefined();
            expect(parseTaskRunPayloadSnapshot('[]')).toBeUndefined();
            expect(parseTaskRunPayloadSnapshot(undefined)).toBeUndefined();
        });

        it('returns parsed object payload for valid JSON object snapshots', () => {
            expect(parseTaskRunPayloadSnapshot('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
        });
    });

    describe('parseOptionalPositiveIntegerQuery', () => {
        it('returns undefined when query is omitted', () => {
            const parsed = parseOptionalPositiveIntegerQuery(undefined);
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) {
                return;
            }
            expect(parsed.value).toBeUndefined();
        });

        it('parses a valid positive integer value', () => {
            const parsed = parseOptionalPositiveIntegerQuery('42');
            expect(parsed.ok).toBe(true);
            if (!parsed.ok) {
                return;
            }
            expect(parsed.value).toBe(42);
        });

        it('rejects malformed or non-positive values', () => {
            const malformed = parseOptionalPositiveIntegerQuery('1abc');
            expect(malformed.ok).toBe(false);
            if (malformed.ok) {
                return;
            }
            expect(malformed.error.code).toBe('DAG_VALIDATION_VERSION_QUERY_INVALID');

            const zero = parseOptionalPositiveIntegerQuery('0');
            expect(zero.ok).toBe(false);
            if (zero.ok) {
                return;
            }
            expect(zero.error.code).toBe('DAG_VALIDATION_VERSION_QUERY_INVALID');
        });
    });
});
