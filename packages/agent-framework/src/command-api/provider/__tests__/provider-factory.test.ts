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
      // Issue #1929: `cwd` isolates the PROJECT settings and nothing else — the default list also
      // reads the developer's real `~/.robota/settings.json`, so "no configuration exists" has to be
      // stated rather than assumed of the host. `env: {}` closes the other environment-shaped input.
      readProviderSettings(cwd, {
        env: {},
        settingsPaths: [
          join(cwd, '.robota', 'settings.json'),
          join(cwd, '.robota', 'settings.local.json'),
          join(cwd, '.claude', 'settings.json'),
          join(cwd, '.claude', 'settings.local.json'),
        ],
      });
      expect.unreachable('readProviderSettings must throw without configuration');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderConfigError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('No provider configuration found');
    }
  });
});
