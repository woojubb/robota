/**
 * FLOW-2006 TC-09 — the three user-execution scenarios on the BUILT binary.
 *
 * Scenario 1 runs in a real PTY: a link opens the trusted fixture repository with the prompt in the
 * composer, unsent, labelled as external, and only Enter submits it. Scenarios 2 and 3 are process
 * runs: every malformed or configuration-bearing link, and every untrusted or unrecorded target, is
 * refused on stderr with a non-zero exit and no session.
 *
 * Runs under `test:pty` against the built CLI (`pnpm --filter @robota-sdk/agent-cli build` first).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const ROBOTA_BIN = join(REPO_ROOT, 'packages/agent-cli/bin/robota.cjs');
const WAIT_MS = 20_000;
const CASE_TIMEOUT_MS = 120_000;
const PROMPT = 'Summarize the README in one sentence';

interface IFixture {
  root: string;
  home: string;
  trusted: string;
  untrusted: string;
  elsewhere: string;
  env: NodeJS.ProcessEnv;
}

function writeProviderSettings(home: string): void {
  const dir = join(home, '.robota');
  mkdirSync(dir, { recursive: true });
  // Skip the first-run welcome: it is an onboarding screen, not what this scenario observes.
  writeFileSync(join(dir, 'onboarded'), new Date().toISOString(), 'utf8');
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'pty-dummy-key' },
      },
    }),
    'utf8',
  );
}

function initRepo(path: string, env: NodeJS.ProcessEnv): void {
  mkdirSync(path, { recursive: true });
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: path, env, stdio: ['ignore', 'ignore', 'pipe'] });
  };
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Robota Scenario');
  run('config', 'user.email', 'scenario@example.invalid');
  writeFileSync(join(path, 'README.md'), 'fixture\n');
  run('add', '--', 'README.md');
  run('commit', '-q', '-m', 'chore: fixture');
}

function makeFixture(): IFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-flow2006-')));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  writeProviderSettings(home);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    TERM: 'xterm-256color',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(home, 'gitconfig'),
  };
  writeFileSync(join(home, 'gitconfig'), '[commit]\n\tgpgsign = false\n');
  const fixture: IFixture = {
    root,
    home,
    trusted: join(root, 'trusted'),
    untrusted: join(root, 'untrusted'),
    elsewhere: join(root, 'elsewhere'),
    env,
  };
  initRepo(fixture.trusted, env);
  initRepo(fixture.untrusted, env);
  mkdirSync(fixture.elsewhere, { recursive: true });
  // Grant trust to the one repository a link is allowed to open.
  const granted = spawnSync(process.execPath, [ROBOTA_BIN, 'trust', '--yes'], {
    cwd: fixture.trusted,
    env,
    encoding: 'utf8',
  });
  if (granted.status !== 0) throw new Error(`trust --yes failed: ${granted.stderr}`);
  return fixture;
}

function link(fixture: IFixture, extra = ''): string {
  return `robota://open?v=1&prompt=${encodeURIComponent(PROMPT)}&cwd=${fixture.trusted}${extra}`;
}

/** Run `robota open <url>` as a process, headless — used for the refusal scenarios. */
function openHeadless(
  fixture: IFixture,
  url: string,
  cwd = fixture.elsewhere,
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [ROBOTA_BIN, 'open', url], {
    cwd,
    env: { ...fixture.env, TERM: 'dumb' },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/**
 * What an interactive session leaves behind under HOME: one `peers/*.peer.json` per run. A refusal
 * that started no session leaves this listing untouched, which is how the refusal scenarios prove
 * "no session was started" without watching the process.
 */
function sessionRecords(home: string): readonly string[] {
  try {
    return readdirSync(join(home, '.robota', 'peers')).sort();
  } catch {
    return [];
  }
}

/** The trust store's bytes — a refused link must not add, remove or touch a grant. */
function trustStoreDigest(home: string): string {
  return createHash('sha256')
    .update(readFileSync(join(home, '.robota', 'workspace-trust.json')))
    .digest('hex');
}

/**
 * Every malformed or configuration-bearing link, each paired with the word its refusal must name —
 * the FIRST rule it breaks, so a refusal that merely says the link is invalid fails the case.
 */
function malformedLinks(fixture: IFixture): readonly (readonly [string, string])[] {
  return [
    [link(fixture, '&provider=anthropic'), 'provider'],
    [link(fixture, `&prompt=${encodeURIComponent('second')}`), 'more than once'],
    [`robota://open?prompt=hi&cwd=${fixture.trusted}`, 'no `v`'],
    [`robota://open?v=2&prompt=hi&cwd=${fixture.trusted}`, 'version 1'],
    [
      `robota://open?v=1&prompt=${encodeURIComponent('/mode bypassPermissions')}&cwd=${fixture.trusted}`,
      'not a command',
    ],
    ['robota://open?v=1&prompt=hi&cwd=relative/path', 'absolute'],
    [`robota://open?v=1&prompt=hi&cwd=${fixture.trusted}/../untrusted`, '`..`'],
    [`robota://open?v=1&prompt=hi&cwd=${join(fixture.root, 'absent')}`, 'does not exist'],
  ];
}

describe('robota open through the real binary (FLOW-2006 TC-09)', () => {
  let fixture: IFixture | undefined;
  let session: IPtySession | undefined;

  beforeEach(() => {
    fixture = makeFixture();
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    fixture = undefined;
  });

  it(
    'Scenario 1: the link opens the trusted repository with the prompt prefilled, inert and labelled',
    async () => {
      const current = fixture;
      if (!current) throw new Error('fixture');
      session = spawnTui({
        projectDir: current.elsewhere,
        homeDir: current.home,
        args: ['open', link(current), '--name', 'flow2006'],
      });

      // The PREFILLED TEXT is the arrival signal, not the empty-composer placeholder (which never
      // renders once there is text) and not `Idle` or the notice — both of those are already on the
      // screen one frame before the composer itself is drawn.
      await session.waitFor(new RegExp(PROMPT), WAIT_MS);
      await session.waitFor(/Idle/, WAIT_MS);
      const first = session.snapshot();
      // The prompt is in the composer, the provenance is visible, and nothing was sent.
      expect(first).toContain(PROMPT);
      expect(first).toContain('Prompt from an external link');
      expect(first).not.toMatch(/Thinking|Interrupting/);
      // The link changed the directory: the status line names the fixture repository's branch.
      expect(first).toContain('git: main');

      // Enter submits exactly that text: it leaves the composer and becomes the user message.
      const since = session.outputOffset();
      await session.pressEnter();
      await session.waitForSince(since, new RegExp(PROMPT), WAIT_MS);

      const run = spawnSync('git', ['log', '--oneline'], {
        cwd: current.trusted,
        env: current.env,
        encoding: 'utf8',
      });
      expect(run.stdout.trim().split('\n')).toHaveLength(1);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'Scenario 2: every malformed or configuration-bearing link is refused with no session',
    () => {
      const current = fixture;
      if (!current) throw new Error('fixture');
      const recordsBefore = sessionRecords(current.home);
      const settingsBefore = readFileSync(join(current.home, '.robota', 'settings.json'), 'utf8');
      const cases = malformedLinks(current);
      for (const [url, expected] of cases) {
        const result = openHeadless(current, url);
        expect(result.status, url).toBe(1);
        expect(`${result.stderr}`, url).toContain(expected);
        expect(`${result.stdout}`, url).not.toContain('Type a message');
      }
      // A SECOND LINK after the first is refused — the argv-appending shape the platforms document.
      const twoArgs = spawnSync(
        process.execPath,
        [ROBOTA_BIN, 'open', link(current), link(current)],
        {
          cwd: current.elsewhere,
          env: { ...current.env, TERM: 'dumb' },
          encoding: 'utf8',
        },
      );
      expect(twoArgs.status).toBe(1);
      expect(`${twoArgs.stderr}`).toContain('exactly one link');

      // Nothing was started and nothing was configured: no session record appeared, and the
      // settings the `/mode bypassPermissions` link tried to reach are byte-identical.
      expect(sessionRecords(current.home)).toEqual(recordsBefore);
      expect(readFileSync(join(current.home, '.robota', 'settings.json'), 'utf8')).toBe(
        settingsBefore,
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'Scenario 3: an untrusted directory and an unrecorded slug are refused, and nothing is cloned',
    () => {
      const current = fixture;
      if (!current) throw new Error('fixture');
      const digestBefore = trustStoreDigest(current.home);
      const untrusted = openHeadless(
        current,
        `robota://open?v=1&prompt=hi&cwd=${current.untrusted}`,
      );
      expect(untrusted.status).toBe(1);
      expect(`${untrusted.stderr}`).toContain('robota trust --yes');

      const slug = openHeadless(current, 'robota://open?v=1&prompt=hi&repo=nobody/not-a-clone');
      expect(slug.status).toBe(1);
      expect(`${slug.stderr}`).toContain('nobody/not-a-clone');
      expect(`${slug.stderr}`).not.toContain('cloning');

      // A refused link grants nothing and records nothing: the untrusted repository is still
      // untrusted and the store is byte-identical to what it was before the two invocations.
      const status = spawnSync(process.execPath, [ROBOTA_BIN, 'trust', 'status'], {
        cwd: current.untrusted,
        env: current.env,
        encoding: 'utf8',
      });
      expect(`${status.stdout}`).toContain('untrusted');
      expect(trustStoreDigest(current.home)).toBe(digestBefore);
    },
    CASE_TIMEOUT_MS,
  );
});
