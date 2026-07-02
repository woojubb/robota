import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  normalizeStructuredOutput,
  parseStructuredResponseText,
  validateAgainstJsonSchema,
} from './structured-output';

import type { IToolSchema } from '../interfaces/provider';

const reportJsonSchema: IToolSchema['parameters'] = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    score: { type: 'number', minimum: 0, maximum: 100 },
    tags: { type: 'array', items: { type: 'string' } },
    level: { type: 'string', enum: ['low', 'high'] },
  },
  required: ['title', 'score'],
};

describe('normalizeStructuredOutput', () => {
  it('normalizes a Zod schema: converts to JSON schema and validates via safeParse', () => {
    const spec = normalizeStructuredOutput(z.object({ title: z.string(), score: z.number() }));

    expect(spec.jsonSchema.type).toBe('object');
    expect(spec.jsonSchema.properties.title).toEqual({ type: 'string' });
    expect(spec.jsonSchema.required).toEqual(['title', 'score']);

    expect(spec.validate({ title: 'ok', score: 1 })).toEqual({
      success: true,
      value: { title: 'ok', score: 1 },
    });

    const failed = spec.validate({ title: 'ok' });
    expect(failed.success).toBe(false);
    if (!failed.success) {
      expect(failed.issues.join('\n')).toContain('score');
    }
  });

  it('normalizes an explicit JSON-schema wrapper and validates structurally', () => {
    const spec = normalizeStructuredOutput({ jsonSchema: reportJsonSchema, name: 'report' });

    expect(spec.name).toBe('report');
    expect(spec.validate({ title: 't', score: 10 }).success).toBe(true);

    const failed = spec.validate({ title: 't', score: 'not-a-number' });
    expect(failed.success).toBe(false);
    if (!failed.success) {
      expect(failed.issues[0]).toContain('expected number');
    }
  });
});

describe('validateAgainstJsonSchema', () => {
  it('reports missing required properties', () => {
    expect(validateAgainstJsonSchema(reportJsonSchema, { score: 1 }, '$')).toEqual([
      '$.title: required property missing',
    ]);
  });

  it('reports unexpected additional properties when additionalProperties is unset', () => {
    const issues = validateAgainstJsonSchema(
      reportJsonSchema,
      { title: 't', score: 1, extra: true },
      '$',
    );
    expect(issues).toEqual(['$.extra: unexpected additional property']);
  });

  it('validates nested arrays, enums, and numeric bounds', () => {
    const issues = validateAgainstJsonSchema(
      reportJsonSchema,
      { title: 't', score: 101, tags: ['a', 5], level: 'medium' },
      '$',
    );
    expect(issues).toEqual([
      '$.score: value 101 is above maximum 100',
      '$.tags[1]: expected string, got number',
      '$.level: value "medium" is not one of the allowed enum values',
    ]);
  });

  it('rejects non-object roots', () => {
    expect(validateAgainstJsonSchema(reportJsonSchema, [1, 2], '$')).toEqual([
      '$: expected object, got array',
    ]);
  });
});

describe('parseStructuredResponseText', () => {
  it('parses plain JSON', () => {
    expect(parseStructuredResponseText('{"a": 1}')).toEqual({ success: true, value: { a: 1 } });
  });

  it('parses a fenced ```json block but still returns the raw value for validation', () => {
    expect(parseStructuredResponseText('```json\n{"a": 1}\n```')).toEqual({
      success: true,
      value: { a: 1 },
    });
  });

  it('returns a typed failure for non-JSON text', () => {
    const result = parseStructuredResponseText('The answer is 42.');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issue).toContain('not valid JSON');
    }
  });
});
