/**
 * Provider factory error typing tests (CLI-064).
 *
 * Missing provider configuration must be a typed, catchable error class so the CLI can
 * map it to the documented exit code 3 without message matching.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProviderConfigError, readProviderSettings } from '../provider-factory.js';

describe('readProviderSettings error typing (CLI-064)', () => {
  let cwd: string | undefined;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('TC-04: throws ProviderConfigError when no provider configuration exists', () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-provider-factory-'));
    try {
      readProviderSettings(cwd);
      expect.unreachable('readProviderSettings must throw without configuration');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('No provider configuration found');
    }
  });
});
