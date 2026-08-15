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

  /**
   * SEC-003 (`js/polynomial-redos`). The argument here is raw model output, so its shape is not
   * under our control. The pre-fix fence regex used `\s*\n`; since `\s` also matches `\n` the two
   * overlapped, and an unterminated fence full of blank lines was rejected in O(n^2) — measured
   * ~3s for the input below, versus ~1ms after the fix.
   */
  it('rejects an unterminated fence full of blank lines in linear time', () => {
    const hostile = '```' + ' \n'.repeat(200_000) + 'x';

    const started = performance.now();
    const result = parseStructuredResponseText(hostile);
    const took = performance.now() - started;

    expect(result.success).toBe(false);
    expect(took).toBeLessThan(250);
  });

  it('still tolerates trailing spaces and CRLF around the fence markers', () => {
    expect(parseStructuredResponseText('```json  \r\n{"a": 1}\r\n```')).toEqual({
      success: true,
      value: { a: 1 },
    });
    expect(parseStructuredResponseText('```\n\n{"a": 1}\n\n```')).toEqual({
      success: true,
      value: { a: 1 },
    });
  });
});

/**
 * CORE-039 — a union node carries `anyOf` INSTEAD of `type`. Before the subset could express one,
 * `switch (schema.type)` fell to `default: unsupported schema type undefined` for every such node,
 * so emitting `anyOf` without teaching this walk to branch on it would have rejected every value of
 * a union-typed field — trading a converter crash for a tool that cannot be called.
 */
describe('validateAgainstJsonSchema — union nodes (CORE-039)', () => {
  const choice = {
    anyOf: [
      { type: 'string' as const },
      {
        type: 'object' as const,
        properties: { label: { type: 'string' as const } },
        required: ['label'],
      },
    ],
  };

  it('accepts a value matching either branch', () => {
    expect(validateAgainstJsonSchema(choice, 'yes', '$')).toEqual([]);
    expect(validateAgainstJsonSchema(choice, { label: 'yes' }, '$')).toEqual([]);
  });

  it('rejects a value matching no branch, reporting how many shapes were allowed', () => {
    const issues = validateAgainstJsonSchema(choice, 42, '$');
    expect(issues[0]).toBe('$: value matches none of the 2 allowed shapes');
  });

  it('reports each branch its own complaint so the near-miss is visible', () => {
    const issues = validateAgainstJsonSchema(choice, { wrong: 1 }, '$');
    expect(issues.join(' ')).toContain('$|anyOf[1].label: required property missing');
  });

  it('validates a union nested inside an array inside an object', () => {
    const schema = {
      type: 'object' as const,
      properties: { options: { type: 'array' as const, items: choice } },
      required: ['options'],
    };
    expect(validateAgainstJsonSchema(schema, { options: ['a', { label: 'b' }] }, '$')).toEqual([]);
    expect(
      validateAgainstJsonSchema(schema, { options: ['a', { nope: 'b' }] }, '$').join(' '),
    ).toContain('options[1]');
  });

  it('refuses a node declaring neither a type nor anyOf rather than accepting it', () => {
    expect(validateAgainstJsonSchema({}, 'anything', '$')).toEqual([
      '$: schema node declares neither a type nor anyOf',
    ]);
  });

  it('refuses an empty anyOf rather than treating it as satisfiable', () => {
    expect(validateAgainstJsonSchema({ anyOf: [] }, 'anything', '$')).toEqual([
      '$: anyOf declares no members',
    ]);
  });
});

/**
 * CORE-039 — `additionalProperties` declares closure RELATIVE TO a declared `properties` set.
 *
 * The convention ("omitted rejects extras") was authored for a tool's `parameters` root, where
 * `properties` is structurally always present. A nested node can omit it, and carrying the root's
 * phrasing there unchanged would give omitted `additionalProperties` a second meaning — "the empty
 * object only" — that contradicts both JSON Schema and the document forwarded to the provider.
 */
describe('validateAgainstJsonSchema — closure is relative to declared properties (CORE-039)', () => {
  it('permits any properties on a node that declares none', () => {
    // This is the shape a hand-written schema uses for a free-form object field, and it is what the
    // provider is told: `{"type":"object"}` with no properties permits any properties.
    expect(validateAgainstJsonSchema({ type: 'object' }, { key: 'val' }, '$')).toEqual([]);
  });

  it('closes a node that declares an EMPTY properties set', () => {
    // Presence of the member, not its emptiness, is what declares closure — a no-argument tool root
    // still rejects every argument.
    expect(
      validateAgainstJsonSchema({ type: 'object', properties: {} }, { key: 'val' }, '$'),
    ).toEqual(['$.key: unexpected additional property']);
  });

  it('closes a node that declares properties, as before', () => {
    expect(
      validateAgainstJsonSchema(
        { type: 'object', properties: { a: { type: 'string' } } },
        { a: 'x', b: 1 },
        '$',
      ),
    ).toEqual(['$.b: unexpected additional property']);
  });

  it('honours an explicit additionalProperties false even with no properties declared', () => {
    expect(
      validateAgainstJsonSchema(
        { type: 'object', additionalProperties: false },
        { key: 'val' },
        '$',
      ),
    ).toEqual(['$.key: unexpected additional property']);
  });

  it('validates extras against a schema-valued additionalProperties (record types)', () => {
    const schema = { type: 'object' as const, additionalProperties: { type: 'number' as const } };
    expect(validateAgainstJsonSchema(schema, { a: 1 }, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { a: 'x' }, '$').join(' ')).toContain('expected number');
  });
});
