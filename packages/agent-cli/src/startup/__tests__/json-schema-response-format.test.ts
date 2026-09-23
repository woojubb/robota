import { describe, expect, it } from 'vitest';

import { buildAppendSystemPrompt } from '../append-system-prompt.js';
import { buildJsonSchemaResponseFormat } from '../json-schema-response-format.js';

import type { IParsedCliArgs } from '../../utils/cli-args.js';

/**
 * Issue #2056 (CLI-081): `--json-schema` is structured-output POLICY, not prompt prose.
 */
const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

function args(over: Partial<IParsedCliArgs>): IParsedCliArgs {
  return {
    appendSystemPrompt: undefined,
    taskFile: undefined,
    jsonSchema: undefined,
    ...over,
  } as IParsedCliArgs;
}

describe('buildJsonSchemaResponseFormat', () => {
  it('routes the flag as a json_schema responseFormat carrying the parsed schema', () => {
    expect(buildJsonSchemaResponseFormat(JSON.stringify(SCHEMA))).toEqual({
      type: 'json_schema',
      schema: SCHEMA,
    });
  });

  it('is absent when the flag is absent', () => {
    expect(buildJsonSchemaResponseFormat(undefined)).toBeUndefined();
  });

  it.each([
    ['invalid JSON', '{not json', /not valid JSON/],
    ['a primitive', '"string"', /must be a JSON object/],
    ['an array', '[1]', /must be a JSON object/],
    ['null', 'null', /must be a JSON object/],
  ])('rejects %s as a terminal startup error, never as prose', (_label, raw, message) => {
    expect(() => buildJsonSchemaResponseFormat(raw)).toThrow(message);
  });
});

describe('buildAppendSystemPrompt (issue #2056)', () => {
  it('no longer authors a JSON-only behavioral instruction from --json-schema', () => {
    const prompt = buildAppendSystemPrompt('/tmp', args({ jsonSchema: JSON.stringify(SCHEMA) }));
    expect(prompt).toBeUndefined();
  });

  it('still carries an explicit --append-system-prompt', () => {
    expect(buildAppendSystemPrompt('/tmp', args({ appendSystemPrompt: 'hello' }))).toBe('hello');
  });
});
