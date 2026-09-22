import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { owningTests } from '../test-owning.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('test-owning', () => {
  it('selects the matching focused suite for a harness module', () => {
    expect(owningTests('scripts/harness/scan-hook-registration.mjs', ROOT)).toContain(
      'scripts/harness/__tests__/scan-hook-registration.test.mjs',
    );
  });
});
