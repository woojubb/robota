/**
 * Issue #3268 — an interactive start in an untrusted repository asks whether to trust it, on the
 * BUILT binary in a real PTY. A yes records the grant and starts Trusted, so the next start does not
 * ask; a no starts Restricted and records nothing, so the next start asks again.
 *
 * Runs under `test:pty` against the built CLI (`pnpm --filter @robota-sdk/agent-cli build` first).
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { spawnTui } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const WAIT_MS = 20_000;
const CASE_TIMEOUT_MS = 120_000;
const QUESTION = /Trust this folder\? \[y\/N\]/;
const READY = /Type a message or \/help/;

interface IFixture {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
}

function makeFixture(): IFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-trust-prompt-')));
  const home = join(root, 'home');
  const repo = join(root, 'repo');
  mkdirSync(join(home, 'state'), { recursive: true });
  // Skip the first-run welcome and provider setup: neither is what this scenario observes.
  writeFileSync(join(home, 'state', 'onboarded'), new Date().toISOString(), 'utf8');
  writeFileSync(
    join(home, 'state', 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'pty-dummy-key' },
      },
    }),
    'utf8',
  );
  execFileSync('git', ['init', '-q', repo]);
  return { root, home, repo };
}

function trustedGrants(fixture: IFixture): number {
  const store = join(fixture.home, 'state', 'workspace-trust.json');
  if (!existsSync(store)) return 0;
  const parsed = JSON.parse(readFileSync(store, 'utf8')) as { grants: { state: string }[] };
  return parsed.grants.filter((grant) => grant.state === 'trusted').length;
}

async function answerAndExit(session: IPtySession, answer: 'y' | 'n'): Promise<void> {
  await session.waitFor(QUESTION, WAIT_MS);
  await session.sendKeys(answer);
  await session.pressEnter();
  await session.waitFor(READY, WAIT_MS);
  await session.sendKeys('/exit');
  await session.pressEnter();
  await session.waitFor(/Exit the session\?/, WAIT_MS);
  await session.pressEnter();
  await session.expectExit(WAIT_MS);
}

describe('the trust question at an interactive start (issue #3268)', () => {
  let fixture: IFixture | undefined;
  let session: IPtySession | undefined;

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    if (fixture) rmSync(fixture.root, { recursive: true, force: true });
    fixture = undefined;
  });

  it(
    'a yes records the grant, and the next start is Trusted without asking',
    async () => {
      fixture = makeFixture();
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await answerAndExit(session, 'y');
      expect(trustedGrants(fixture)).toBe(1);

      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await session.waitFor(READY, WAIT_MS);
      expect(session.snapshot()).not.toMatch(QUESTION);
    },
    CASE_TIMEOUT_MS,
  );

  it.each([
    ['--safe-mode', ['--safe-mode']],
    // A resumed or continued session keeps the store it was saved in, so it is not asked.
    ['--continue', ['--continue']],
  ])(
    'does not ask with %s',
    async (_case, args) => {
      fixture = makeFixture();
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home, args: [...args] });
      await session.waitFor(READY, WAIT_MS);
      expect(session.snapshot()).not.toMatch(QUESTION);
      expect(trustedGrants(fixture)).toBe(0);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'a no starts Restricted, records nothing, and the next start asks again',
    async () => {
      fixture = makeFixture();
      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await answerAndExit(session, 'n');
      expect(trustedGrants(fixture)).toBe(0);

      session = spawnTui({ projectDir: fixture.repo, homeDir: fixture.home });
      await session.waitFor(QUESTION, WAIT_MS);
    },
    CASE_TIMEOUT_MS,
  );
});
