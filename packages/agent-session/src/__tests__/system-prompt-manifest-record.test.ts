import { describe, expect, it } from 'vitest';

import { decodeInteractiveSessionRecord } from '../session-record-codec/index.js';

function record(manifest: unknown): unknown {
  return {
    id: 'session-1',
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    messages: [],
    systemPrompt: 'hello',
    ...(manifest === undefined ? {} : { systemPromptManifest: manifest }),
  };
}

const VALID_MANIFEST = {
  harnessVersion: 'none',
  sections: [{ id: 'runtime-cwd', source: 'runtime', characters: 5 }],
};

describe('a session record keeps the sections its system prompt was composed from', () => {
  it('decodes a manifest unchanged', () => {
    const outcome = decodeInteractiveSessionRecord(record(VALID_MANIFEST));
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect(outcome.record.systemPromptManifest).toStrictEqual(VALID_MANIFEST);
  });

  it('accepts a record written without one and does not invent one', () => {
    const outcome = decodeInteractiveSessionRecord(record(undefined));
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect('systemPromptManifest' in outcome.record).toBe(false);
  });

  it.each([
    ['a manifest that is not an object', 'none'],
    ['a manifest without a harness version', { sections: [] }],
    ['a manifest whose sections are not a list', { harnessVersion: 'none', sections: 'x' }],
    [
      'a section with a non-numeric length',
      { harnessVersion: 'none', sections: [{ id: 'a', source: 'runtime', characters: '5' }] },
    ],
    [
      'a section with a key the contract does not declare',
      {
        harnessVersion: 'none',
        sections: [{ id: 'a', source: 'runtime', characters: 5, text: 'leak' }],
      },
    ],
  ])('reports %s as corrupt', (_label, manifest) => {
    expect(decodeInteractiveSessionRecord(record(manifest)).status).toBe('corrupt');
  });
});
