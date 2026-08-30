import { appendFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readJson } from '../work-run-json-store.mjs';
import { makeTemp } from './make-temp.mjs';

describe('bounded work-run JSON reads', () => {
  it('caps allocation when a regular file grows after its initial size check', () => {
    const root = makeTemp('work-run-growing-json-');
    const file = join(root, 'state.json');
    const requestedLengths = [];
    writeFileSync(file, '{"value":1}\n');

    expect(() =>
      readJson(file, root, {
        afterInitialStat: () => appendFileSync(file, 'x'.repeat(1_048_577)),
        read: (descriptor, buffer, offset, length, position) => {
          requestedLengths.push(length);
          return readSync(descriptor, buffer, offset, length, position);
        },
      }),
    ).toThrow(/exceeds 1 MiB/i);
    expect(requestedLengths.length).toBeGreaterThan(0);
    expect(Math.max(...requestedLengths)).toBeLessThanOrEqual(1_048_577);
  });
});
