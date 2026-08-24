/**
 * Real-PTY organization-policy engineering regression scenario (CLI-083).
 *
 * Drives the built Robota CLI with an isolated HOME. Nothing injects a policy object into the
 * command module: the refusal can only come from the shipped `loadOrgPolicy()` startup path. The
 * update check is disabled so this isolated scenario performs no startup network request.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

function writeOrgPolicyFixture(homeDir: string): void {
  const settingsDir = join(homeDir, '.robota');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'pty-dummy-key' },
        openai: { type: 'openai', model: 'gpt-test-model', apiKey: 'pty-dummy-key' },
      },
    }),
    'utf8',
  );
  writeFileSync(
    join(settingsDir, 'org-policy.json'),
    JSON.stringify({ allowedProviders: ['anthropic'], adminContact: 'ops@example.com' }),
    'utf8',
  );
}

describe('organization policy through the built CLI (CLI-083)', () => {
  let projectDir: string;
  let homeDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-pty-org-policy-'));
    homeDir = join(projectDir, 'home');
    writeOrgPolicyFixture(homeDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('blocks a provider switch forbidden only by the policy loaded from disk', async () => {
    session = spawnTui({ projectDir, homeDir, args: ['--disable-update-check'] });
    await session.waitFor(/Type a message or \/help/);

    const since = session.outputOffset();
    await session.sendKeys('/provider switch openai');
    await session.pressEnter();

    await session.waitForSince(
      since,
      /Provider "openai" is not allowed by your organization policy/,
    );
    expect(session.snapshotSince(since)).toContain('Allowed: anthropic');
  }, 60_000);
});
