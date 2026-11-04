import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashToolSchema } from '../project-tool-schema';

describe('hashToolSchema', () => {
  it('preserves canonical tool-schema hashes across authored key order', () => {
    const first = {
      type: 'object',
      properties: { z: { type: 'string' }, a: { type: 'number' } },
    } as const;
    const second = {
      properties: { a: { type: 'number' }, z: { type: 'string' } },
      type: 'object',
    } as const;
    const canonical =
      '{"properties":{"a":{"type":"number"},"z":{"type":"string"}},"type":"object"}';
    const expected = createHash('sha256').update(canonical).digest('hex');
    expect(hashToolSchema(first)).toBe(expected);
    expect(hashToolSchema(second)).toBe(expected);
  });
});
