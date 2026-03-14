import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildConfigSchema } from '@robota-sdk/dag-core';

describe('buildConfigSchema', () => {
    it('converts a valid Zod schema to JSON Schema', () => {
        const zodSchema = z.object({
            prompt: z.string(),
            temperature: z.number().optional()
        });
        const result = buildConfigSchema(zodSchema);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveProperty('type', 'object');
        expect(result.value).toHaveProperty('properties');
    });

    it('returns validation error for non-Zod input (null)', () => {
        const result = buildConfigSchema(null);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_CONFIG_SCHEMA_INVALID');
    });

    it('returns validation error for non-Zod input (plain object)', () => {
        const result = buildConfigSchema({ type: 'object' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('DAG_VALIDATION_CONFIG_SCHEMA_INVALID');
    });

    it('returns validation error for non-Zod input (string)', () => {
        const result = buildConfigSchema('not-a-schema');
        expect(result.ok).toBe(false);
    });

    it('returns validation error for undefined', () => {
        const result = buildConfigSchema(undefined);
        expect(result.ok).toBe(false);
    });
});
