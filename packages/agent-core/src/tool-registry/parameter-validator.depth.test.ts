import { describe, it, expect } from 'vitest';

import { getValidationErrors } from './parameter-validator';

import type { IParameterSchema } from '../interfaces/provider';

/**
 * CORE-039 — the tool-INPUT walk enforces the depth the tool schema advertises.
 *
 * Before this, `case 'object'` stopped at `typeof`: a schema could declare a nested object's fields
 * and requirements and nothing on the input path would ever look at them. The depth now belongs to
 * `validateAgainstJsonSchema`, the one complete walk, so the two cannot disagree about the same
 * payload. These tests also pin the ROOT messages callers depend on, because delegating depth must
 * not change what a caller already reads.
 */
const reportSchema: Record<string, IParameterSchema> = {
  report: {
    type: 'object',
    properties: { score: { type: 'number' }, notes: { type: 'array', items: { type: 'string' } } },
    required: ['score'],
  },
};

describe('tool-input validation — nested depth', () => {
  it('accepts a conforming nested payload', () => {
    const errors = getValidationErrors(
      { report: { score: 4, notes: ['a'] } },
      ['report'],
      reportSchema,
    );
    expect(errors).toEqual([]);
  });

  it('rejects a payload missing a NESTED required field, naming it', () => {
    const errors = getValidationErrors({ report: { notes: ['a'] } }, ['report'], reportSchema);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('score');
  });

  it('rejects a wrongly typed nested field', () => {
    const errors = getValidationErrors({ report: { score: 'four' } }, ['report'], reportSchema);
    expect(errors.join(' ')).toContain('score');
  });

  it('reports a non-object payload once, in the caller-facing dialect', () => {
    // The typeof failure returns before delegating: the deep walk would otherwise report the same
    // defect a second time in its own dialect, inside one ValidationError message.
    const errors = getValidationErrors({ report: 'nope' }, ['report'], reportSchema);
    expect(errors).toEqual(['Parameter "report" must be an object, got string']);
  });

  it('enters objects inside an array', () => {
    const errors = getValidationErrors({ points: [{ x: 1 }, { y: 2 }] }, [], {
      points: {
        type: 'array',
        items: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
      },
    });
    expect(errors.join(' ')).toContain('x');
  });

  it('leaves a nested object that declares no properties alone', () => {
    // No properties declared means nothing to check below the type — the node is still governed by
    // the subset's additionalProperties convention, which an author states explicitly.
    const errors = getValidationErrors({ blob: { anything: 1 } }, [], {
      blob: { type: 'object', additionalProperties: true },
    });
    expect(errors).toEqual([]);
  });
});

describe('tool-input validation — union nodes', () => {
  const choiceSchema: Record<string, IParameterSchema> = {
    choice: {
      anyOf: [
        { type: 'string' },
        { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] },
      ],
    },
  };

  it('accepts either branch', () => {
    expect(getValidationErrors({ choice: 'yes' }, [], choiceSchema)).toEqual([]);
    expect(getValidationErrors({ choice: { label: 'yes' } }, [], choiceSchema)).toEqual([]);
  });

  it('rejects a value matching no branch, saying how many shapes were allowed', () => {
    const errors = getValidationErrors({ choice: 42 }, [], choiceSchema);
    expect(errors.join(' ')).toContain('matches none of the 2 allowed shapes');
  });
});

describe('tool-input validation — root messages are unchanged', () => {
  const flat: Record<string, IParameterSchema> = { known: { type: 'string' } };

  it('still reports a missing required parameter in the original wording', () => {
    expect(getValidationErrors({}, ['known'], flat)).toEqual(['Missing required parameter: known']);
  });

  it('still reports an unknown parameter when additionalProperties is omitted', () => {
    expect(getValidationErrors({ known: 'a', extra: 1 }, [], flat)).toEqual([
      'Unknown parameter: extra',
    ]);
  });

  it('still reports a wrong leaf type in the original wording', () => {
    expect(getValidationErrors({ known: 1 }, [], flat)).toEqual([
      'Parameter "known" must be a string, got number',
    ]);
  });
});

describe('tool-input validation — nodes the subset cannot interpret', () => {
  it('refuses a node declaring neither a type nor anyOf instead of accepting it', () => {
    // Making `type` optional (for union nodes) made this reachable. A silently accepted node is the
    // failure this item exists to remove, so it is an error rather than a fallthrough.
    const errors = getValidationErrors({ odd: 1 }, [], { odd: {} });
    expect(errors).toEqual(['Parameter "odd" declares neither a type nor anyOf']);
  });
});
