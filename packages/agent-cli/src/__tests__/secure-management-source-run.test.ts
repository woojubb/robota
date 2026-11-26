/**
 * Help, version and the session listing, run from source as a person would start them, in a state
 * root where secure conversations are on and a sealed session is saved. None of them is a
 * conversation surface, so each runs with no key holder and builds no store: they print and exit 0
 * without asking for a passphrase, and the sealed record is neither listed nor touched. `usage` is
 * the counter-case: it reads saved conversations, so with no key holder it still refuses.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createBuiltInBinaryEnvironment,
  createBuiltInBinaryRuntime,
} from './helpers/product-runtime.js';
import { enableSecureConversations } from './helpers/secure-product-state.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const replayLog = fileURLToPath(new URL('./e2e/fixtures/cross-fidelity.jsonl', import.meta.url));
const PROMPT = 'PROMPT-CANARY-secure-management-run-7c1e';
const REFUSAL =
  'Secure conversation sealing key holder is unavailable; no conversation store may open.';

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'robota-secure-mgmt-')));
const home = path.join(scratch, 'home');
const repo = path.join(scratch, 'repo');
const state = path.join(home, '.robota');
const sessions = path.join(state, 'secure-v1', 'sessions');

beforeAll(async () => {
  mkdirSync(state, { recursive: true });
  writeFileSync(
    path.join(state, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      // Boots the CLI; --session-log swaps in the replay provider so the key is never used.
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'dummy-key' },
      },
    }),
  );
  execFileSync('git', ['init', '--quiet', repo], { env: { ...process.env, HOME: home } });
  await enableSecureConversations(createBuiltInBinaryRuntime(home));
  // One saved session, sealed by print mode, which the commands below must leave alone.
  const seed = spawnSync(
    launcher,
    ['-p', PROMPT, '--session-log', replayLog, '--restricted-workspace', '--disable-update-check'],
    { cwd: repo, env: createBuiltInBinaryEnvironment(home), encoding: 'utf8', timeout: 90_000 },
  );
  if (seed.status !== 0) throw new Error(`seeding the sealed session failed: ${seed.stderr}`);
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(args: readonly string[]) {
  return spawnSync(launcher, args, {
    cwd: repo,
    env: createBuiltInBinaryEnvironment(home),
    encoding: 'utf8',
    timeout: 90_000,
  });
}

/** The sealed records and their bytes. */
function records(): Map<string, Buffer> {
  if (!existsSync(sessions)) return new Map();
  return new Map(
    readdirSync(sessions)
      .filter((name) => /^session_.*\.json$/u.test(name))
      .map((name) => [name, readFileSync(path.join(sessions, name))] as const),
  );
}

describe('commands that read no conversation, from source, in secure conversations', () => {
  it('has a sealed session saved to leave alone', () => {
    const saved = records();
    expect(saved.size).toBe(1);
    for (const bytes of saved.values())
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RSL1');
  });

  it('prints its version and exits 0', () => {
    const result = run(['--version']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^robota \S+\n$/u);
    expect(result.stderr).toBe('');
  }, 120_000);

  it.each([['--help'], ['-h']])(
    'prints its help for %s and exits 0',
    (flag) => {
      const result = run([flag]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: robota [options]');
      expect(result.stderr).toBe('');
    },
    120_000,
  );

  it('lists no saved session, says they are sealed, and never asks for a passphrase', () => {
    const before = records();
    const result = run(['session', 'list']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Live processes (not linked to saved sessions):');
    expect(result.stdout).toContain(
      'Saved sessions are sealed in secure mode and are not listed here',
    );
    expect(result.stdout).toContain('Supervised sessions');
    for (const name of before.keys()) {
      expect(result.stdout).not.toContain(name.replace(/\.json$/u, ''));
    }
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/passphrase/iu);
    expect(result.stderr).toBe('');
    expect(records()).toEqual(before);
  }, 120_000);

  it('marks the saved sessions of the JSON listing as sealed', () => {
    const result = run(['session', 'list', '--format', 'json']);

    expect(result.status, result.stderr).toBe(0);
    const listing = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(listing['saved']).toEqual([]);
    expect(listing['savedSealed']).toBe(true);
    expect(listing['live']).toEqual({ status: 'available', processes: [] });
    expect(listing['supervised']).toEqual({ status: 'available', sessions: [] });
  }, 120_000);
});

describe('commands that read saved conversations, from source, in secure conversations', () => {
  it('still refuses `usage` without a key holder, and leaves the sealed record alone', () => {
    const before = records();
    const result = run(['usage']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(REFUSAL);
    expect(records()).toEqual(before);
  }, 120_000);
});
