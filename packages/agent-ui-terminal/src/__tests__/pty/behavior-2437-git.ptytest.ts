/**
 * BEHAVIOR-2437 TC-07 — `/git status`, `/git diff` and `/git commit` on the BUILT robota binary, in
 * a real PTY, over a throwaway git repository. The four User Execution scenarios of the spec, as a
 * machine runs them: read path (S1), commit path (S2), nothing staged (S3), headless cancel (S4).
 *
 * Runs under `test:pty` against the built CLI (`pnpm --filter @robota-sdk/agent-cli build` first).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
const DOWN = '\x1b[B';
const UP = '\x1b[A';

interface IFixture {
  root: string;
  repo: string;
  home: string;
  env: NodeJS.ProcessEnv;
}

/** A hermetic git environment: isolated HOME, no system config, signing off. */
function gitEnv(home: string): NodeJS.ProcessEnv {
  const globalConfig = join(home, 'gitconfig');
  writeFileSync(globalConfig, '[commit]\n\tgpgsign = false\n');
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
  };
}

function git(fixture: IFixture, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: fixture.repo,
    env: fixture.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The dummy provider profile under the isolated HOME — boot/slash/exit make zero model calls. */
function writeProviderSettings(home: string): void {
  const dir = join(home, '.robota');
  mkdirSync(dir, { recursive: true });
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

/**
 * One commit holding `greeting.txt` and `notes.txt`; then `greeting.txt` edited and STAGED (when
 * `stage`), `notes.txt` edited and left unstaged, `scratch.log` created untracked.
 */
function makeFixture(stage: boolean): IFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-git-pty-')));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(home, { recursive: true });
  mkdirSync(repo, { recursive: true });
  writeProviderSettings(home);
  const fixture: IFixture = { root, repo, home, env: gitEnv(home) };
  git(fixture, 'init', '-q', '-b', 'main');
  git(fixture, 'config', 'user.name', 'Robota Scenario');
  git(fixture, 'config', 'user.email', 'scenario@example.com');
  git(fixture, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(repo, 'greeting.txt'), 'hello\n');
  writeFileSync(join(repo, 'notes.txt'), 'note one\n');
  git(fixture, 'add', '--', 'greeting.txt', 'notes.txt');
  git(fixture, 'commit', '-q', '-m', 'chore: base');
  if (stage) {
    writeFileSync(join(repo, 'greeting.txt'), 'hello\nhello world\n');
    git(fixture, 'add', '--', 'greeting.txt');
  }
  writeFileSync(join(repo, 'notes.txt'), 'note one\nnote two\n');
  writeFileSync(join(repo, 'scratch.log'), 'scratch\n');
  return fixture;
}

function commitCount(fixture: IFixture): number {
  return git(fixture, 'log', '--oneline').trim().split('\n').length;
}

function porcelain(fixture: IFixture): string[] {
  return git(fixture, 'status', '--porcelain')
    .split('\n')
    .filter((line) => line.length > 0);
}

/** Type a slash command, press Enter, and return the transcript offset taken BEFORE typing. */
async function run(session: IPtySession, command: string): Promise<number> {
  const since = session.outputOffset();
  await session.sendKeys(command);
  await session.pressEnter();
  return since;
}

/** The confirmation's current highlight, from the newest `> Yes` / `> No` in the transcript. */
function currentHighlight(session: IPtySession): string | undefined {
  const matches = session.snapshot().match(/> (Yes|No)\b/g);
  return matches?.at(-1)?.slice(2);
}

/**
 * Move the highlight to `label` by the rendered label, not by an assumed starting index — the
 * options are `Yes` then `No`, so `No` is one Down away and `Yes` one Up.
 */
async function highlightOption(session: IPtySession, label: 'Yes' | 'No'): Promise<void> {
  if (currentHighlight(session) === label) return;
  const since = session.outputOffset();
  session.writeRaw(label === 'No' ? DOWN : UP);
  await session.waitForSince(since, new RegExp(`> ${label}\\b`), WAIT_MS);
}

/** Scenario 1's read steps: /help lists /git, /status stays unclaimed, /git status reads the fixture. */
async function expectReadSteps(session: IPtySession): Promise<void> {
  let since = await run(session, '/help');
  await session.waitForSince(since, /\/git/, WAIT_MS);
  await session.waitForSince(since, /Type a message or \/help/, WAIT_MS);
  expect(session.snapshotSince(since)).toMatch(/\/git\b/);

  // The autocomplete popup runs its highlighted entry on Enter — `/status` alone would execute
  // `/statusline`. A trailing space closes the popup, so the literal `/status` is what submits.
  since = await run(session, '/status ');
  await session.waitForSince(since, /Unknown command "\/status"/, WAIT_MS);

  since = await run(session, '/git status');
  await session.waitForSince(since, /untracked \(1\): scratch\.log/, WAIT_MS);
  const status = session.snapshotSince(since);
  expect(status).toContain('On branch main');
  expect(status).toMatch(/staged \(1\): greeting\.txt/);
  expect(status).toMatch(/unstaged \(1\): notes\.txt/);
}

/** Scenario 1's diff forms: each reads the fixture, none changes it. */
async function expectDiffForms(session: IPtySession, fixture: IFixture): Promise<void> {
  let since = await run(session, '/git diff');
  await session.waitForSince(since, /\+note two/, WAIT_MS);
  expect(session.snapshotSince(since)).not.toContain('+hello world');

  since = await run(session, '/git diff --staged');
  await session.waitForSince(since, /\+hello world/, WAIT_MS);
  expect(session.snapshotSince(since)).not.toContain('+note two');

  since = await run(session, '/git diff -- notes.txt');
  await session.waitForSince(since, /\+note two/, WAIT_MS);
  expect(session.snapshotSince(since)).not.toMatch(/diff --git a\/greeting/);

  since = await run(session, '/git diff HEAD~1');
  await session.waitForSince(since, /Unknown revision: HEAD~1/, WAIT_MS);
  expect(session.snapshotSince(since)).not.toContain('diff --git');

  since = await run(session, '/git diff nosuchrev');
  await session.waitForSince(since, /Unknown revision: nosuchrev/, WAIT_MS);
  expect(session.snapshotSince(since)).not.toContain('diff --git');

  // A short relative path: a long token wraps in the PTY and splits the line under test.
  const outputPath = join(fixture.repo, 'x');
  since = await run(session, '/git diff --output=x');
  await session.waitForSince(since, /is not accepted/, WAIT_MS);
  const usage = session.snapshotSince(since);
  for (const form of ['--staged', '<rev>', '<a>..<b>', '-- <path>']) expect(usage).toContain(form);
  expect(usage).not.toContain('diff --git');
  expect(existsSync(outputPath)).toBe(false);
}

/** Scenario 2, step 1: a MUST-rule violation is refused before any dialog. */
async function expectSubjectRefusal(session: IPtySession, fixture: IFixture): Promise<void> {
  const since = await run(session, '/git commit add greeting');
  await session.waitForSince(since, /Commit refused/, WAIT_MS);
  const refusal = session.snapshotSince(since);
  expect(refusal).toContain('`: `');
  expect(refusal).not.toContain('staged file(s)?');
  expect(commitCount(fixture)).toBe(1);
}

/** Scenario 2, step 2: the confirmation lists exactly the staged file; No commits nothing. */
async function expectCancelOnNo(session: IPtySession, fixture: IFixture): Promise<void> {
  const since = await run(session, '/git commit feat: add greeting');
  await session.waitForSince(since, /Commit 1 staged file\(s\)\?/, WAIT_MS);
  const dialog = session.snapshotSince(since);
  expect(dialog).toContain('Message: feat: add greeting');
  expect(dialog).toContain('M greeting.txt');
  expect(dialog).not.toContain('notes.txt');
  expect(dialog).not.toContain('scratch.log');
  await highlightOption(session, 'No');
  await session.pressEnter();
  await session.waitForSince(since, /Commit cancelled\./, WAIT_MS);
  expect(commitCount(fixture)).toBe(1);
}

/** Scenario 2, step 3: outer quotes stripped; Yes commits with the short hash reported. */
async function expectCommitOnYes(session: IPtySession): Promise<void> {
  const since = await run(session, '/git commit "feat: add greeting"');
  await session.waitForSince(since, /Commit 1 staged file\(s\)\?/, WAIT_MS);
  const quoted = session.snapshotSince(since);
  expect(quoted).toContain('Message: feat: add greeting');
  expect(quoted).not.toContain('Message: "feat: add greeting"');
  expect(quoted).toContain('M greeting.txt');
  await highlightOption(session, 'Yes');
  await session.pressEnter();
  await session.waitForSince(since, /Committed: \[main [0-9a-f]{7}\] feat: add greeting/, WAIT_MS);
}

async function exitTui(session: IPtySession): Promise<number> {
  await run(session, '/exit');
  await session.waitFor(/Exit the session\?/, WAIT_MS);
  await session.pressEnter();
  return session.expectExit(WAIT_MS);
}

describe('/git through the real binary (BEHAVIOR-2437 TC-07)', () => {
  let fixture: IFixture | undefined;
  let session: IPtySession | undefined;

  beforeEach(() => {
    fixture = undefined;
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    fixture = undefined;
  });

  it(
    'Scenario 1: /help lists /git, /status stays unclaimed, status and every diff form read the fixture',
    async () => {
      fixture = makeFixture(true);
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await session.waitFor(/Type a message or \/help/, WAIT_MS);
      await session.waitFor(/Idle/, WAIT_MS);

      await expectReadSteps(session);

      await expectDiffForms(session, fixture);

      expect(await exitTui(session)).toBe(0);
      expect(commitCount(fixture)).toBe(1);
      expect(porcelain(fixture).sort()).toEqual(
        ['M  greeting.txt', ' M notes.txt', '?? scratch.log'].sort(),
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'Scenario 2: /git commit refuses a bad subject, commits nothing on No, and on Yes commits exactly the staged file',
    async () => {
      fixture = makeFixture(true);
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await session.waitFor(/Type a message or \/help/, WAIT_MS);
      await session.waitFor(/Idle/, WAIT_MS);

      await expectSubjectRefusal(session, fixture);
      await expectCancelOnNo(session, fixture);
      await expectCommitOnYes(session);

      expect(await exitTui(session)).toBe(0);
      expect(commitCount(fixture)).toBe(2);
      expect(git(fixture, 'log', '-1', '--format=%s').trim()).toBe('feat: add greeting');
      const stat = git(fixture, 'show', '--stat', '--format=%s', 'HEAD');
      expect(stat).toContain('greeting.txt');
      expect(stat).toContain('1 file changed');
      expect(stat).not.toContain('notes.txt');
      expect(porcelain(fixture).sort()).toEqual([' M notes.txt', '?? scratch.log'].sort());
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'Scenario 3: with nothing staged, /git commit prints guidance with the counts and commits nothing',
    async () => {
      fixture = makeFixture(false);
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await session.waitFor(/Type a message or \/help/, WAIT_MS);
      await session.waitFor(/Idle/, WAIT_MS);

      const since = await run(session, '/git commit feat: nothing to commit');
      await session.waitForSince(since, /Nothing is staged \(1 unstaged, 1 untracked\)/, WAIT_MS);
      const guidance = session.snapshotSince(since);
      expect(guidance).toContain('git add');
      expect(guidance).toContain('/shell git add');
      expect(guidance).not.toContain('staged file(s)?');

      expect(await exitTui(session)).toBe(0);
      expect(commitCount(fixture)).toBe(1);
      expect(porcelain(fixture).sort()).toEqual([' M notes.txt', '?? scratch.log'].sort());
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'Scenario 4: headless /git commit cancels (no confirmation can be asked), exits 1, commits nothing',
    () => {
      fixture = makeFixture(true);
      const env: NodeJS.ProcessEnv = { ...fixture.env, TERM: 'dumb' };
      const trust = spawnSync(process.execPath, [ROBOTA_BIN, 'trust', '--yes'], {
        cwd: fixture.repo,
        env,
        encoding: 'utf8',
      });
      expect(trust.status).toBe(0);
      const result = spawnSync(
        process.execPath,
        [ROBOTA_BIN, '-p', '/git commit feat: add greeting', '--bare', '--no-session-persistence'],
        { cwd: fixture.repo, env, encoding: 'utf8', timeout: 60_000 },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status).toBe(1);
      expect(output).toContain('cancelled');
      expect(output).toContain('confirmation');
      expect(output).not.toMatch(/\bYes\b/);
      expect(commitCount(fixture)).toBe(1);
      expect(porcelain(fixture)).toContain('M  greeting.txt');
    },
    CASE_TIMEOUT_MS,
  );
});
