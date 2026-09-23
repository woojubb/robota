import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashToolSchema } from './project-tool-schema';
import { sha256Hex } from './sha256';

describe('browser-safe SHA-256', () => {
  it('matches the known abc vector', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  const inputs = [
    '',
    'abc',
    '안녕하세요 🌍',
    ...[55, 56, 63, 64, 65, 119, 120, 128, 1024].map((length) => 'a'.repeat(length)),
  ];
  it.each(inputs.map((input) => ({ input, byteLength: new TextEncoder().encode(input).length })))(
    'matches the Node digest for $byteLength bytes',
    ({ input }) => {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input).digest('hex'));
    },
  );

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
