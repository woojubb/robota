/**
 * The children the CLI starts itself — skill `!` expansion, `secure migrate`'s git probe, the
 * remote-control git read, worktree and plugin git — run in their own session in secure mode and
 * exactly as before in plain mode. The browser opener is started and let go in both modes. The terminal handover's re-exec keeps the terminal
 * in both.
 *
 * Programs found on `PATH` are replaced by stubs that report their own pid and process group, so the
 * session is observed, not assumed.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit as runPluginGit } from '../plugins/default-plugin-command-adapter.js';
import { createProductSessionPrOpener } from '../session-inventory/session-view-command.js';
import { runLocalGit } from '../remote-control/local-peer-workspace.js';
import { probeWithGit } from '../secure/migration-roots.js';
import { openInBrowser } from '../startup/browser-opener.js';
import { runShellCommand } from '../startup/shell-exec.js';
import { createGitWorktreeIsolationAdapter } from '../subagents/git-worktree-isolation-adapter.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const POSIX = process.platform !== 'win32';
let bin: string;
let report: string;
let originalPath: string | undefined;

/** A stub on `PATH` that writes `<pid> <group>` to the report file and prints it too. */
function stub(name: string): void {
  writeFileSync(
    join(bin, name),
    `#!/bin/sh\nline="$$ $(/bin/ps -o pgid= -p $$ | tr -d ' ')"\necho "$line" > ${report}\necho "$line"\n`,
  );
  chmodSync(join(bin, name), 0o755);
}

beforeEach(() => {
  bin = realpathSync(mkdtempSync(join(tmpdir(), 'cli-stub-')));
  report = join(bin, 'report');
  for (const name of ['git', 'xdg-open']) stub(name);
  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ''}`;
});

afterEach(() => {
  resetChildSessionsForTesting();
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
  vi.mocked(execFileSync).mockClear();
});

function ownGroup(): number {
  return Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim(),
  );
}

function parse(line: string): { pid: number; group: number } {
  const [pid, group] = line.trim().split(/\s+/u).map(Number);
  return { pid: pid!, group: group! };
}

function reported(): { pid: number; group: number } {
  return parse(readFileSync(report, 'utf8'));
}

/** Each site, run once; each reports the pid and group its child had. */
const sites: Record<string, () => Promise<{ pid: number; group: number }>> = {
  'skill ! expansion': async () =>
    parse(runShellCommand('echo $$ $(/bin/ps -o pgid= -p $$)', process.env)),
  'the secure migrate git probe': async () => {
    await probeWithGit(bin, new AbortController().signal);
    return reported();
  },
  'the remote-control git read': async () => {
    await runLocalGit(bin, ['status']);
    return reported();
  },
};

async function openerReport(): Promise<{ pid: number; group: number }> {
  await openInBrowser(new URL('https://example.test/'), { platform: 'linux' });
  // Settled once the opener started; its report comes a moment later.
  const deadline = Date.now() + 5000;
  while (!existsSync(report) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  return reported();
}

describe.skipIf(!POSIX)('children the CLI starts', () => {
  // Started and let go in both modes, like the monitor opener, so it leads its own group in both.
  it('the browser opener leads its own session in plain and in secure mode', async () => {
    const plain = await openerReport();
    rmSync(report, { force: true });
    enableOwnChildSessions();
    const secure = await openerReport();

    expect(plain.group).toBe(plain.pid);
    expect(secure.group).toBe(secure.pid);
  });

  for (const [name, run] of Object.entries(sites)) {
    it(`${name} runs in this process group in plain mode (guard)`, async () => {
      expect((await run()).group).toBe(ownGroup());
    });

    it(`${name} runs in its own session in secure mode`, async () => {
      enableOwnChildSessions();
      const { pid, group } = await run();

      expect(group).toBe(pid);
    });
  }

  it('worktree git starts with the options it always had in plain mode, and in its own session in secure mode', () => {
    const remove = (): void => {
      try {
        createGitWorktreeIsolationAdapter({
          worktreeDir: bin,
          branchPrefix: 'p',
          environment: {},
        }).remove({
          repoRoot: bin,
          worktreePath: join(bin, 'w'),
          branchName: 'p/x',
        });
      } catch {
        // the stub is not a repository; only the options git was started with matter here
      }
    };
    remove();
    const plain = vi.mocked(execFileSync).mock.calls.at(-1)?.[2];
    enableOwnChildSessions();
    remove();
    const secure = vi.mocked(execFileSync).mock.calls.at(-1)?.[2];

    expect(plain).toMatchObject({ cwd: bin, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(plain).not.toHaveProperty('detached');
    expect(secure).toEqual({ ...(plain as object), detached: true });
  });

  it('plugin git starts with the options it always had in plain mode, and in its own session in secure mode', () => {
    runPluginGit('git', ['status'], { timeout: 5000 }, process.env);
    const plain = vi.mocked(execFileSync).mock.calls.at(-1)?.[2];
    enableOwnChildSessions();
    runPluginGit('git', ['status'], { timeout: 5000 }, process.env);
    const secure = vi.mocked(execFileSync).mock.calls.at(-1)?.[2];

    expect(plain).toMatchObject({ timeout: 5000, stdio: 'pipe', shell: false });
    expect(plain).not.toHaveProperty('detached');
    expect(secure).toEqual({ ...(plain as object), detached: true });
  });

  it('plugin git may not hand a child the terminal in secure mode', () => {
    enableOwnChildSessions();

    expect(() =>
      runPluginGit('git', ['status'], { timeout: 5000, stdio: 'inherit' }, process.env),
    ).toThrow(/terminal handover/u);
    expect(existsSync(report)).toBe(false);
  });
});

/**
 * The session view's pull-request link used to go through the `open` package. It now goes through
 * the product's own opener, whose command and arguments are pinned here per platform: macOS runs
 * `open <url>` as before; Linux runs the `xdg-open` on `PATH` (the package preferred its bundled
 * copy); Windows runs `rundll32 url.dll,FileProtocolHandler <url>` (the package ran PowerShell's
 * `Start`); and only an https link opens.
 */
describe('the session view pull-request opener', () => {
  const url = 'https://github.com/team/repo/pull/124';

  for (const [platform, expected] of [
    ['darwin', ['open', [url]]],
    ['linux', ['xdg-open', [url]]],
    ['win32', ['rundll32', ['url.dll,FileProtocolHandler', url]]],
  ] as const) {
    it(`runs ${expected[0]} on ${platform}`, async () => {
      const calls: Array<readonly [string, readonly string[]]> = [];
      await createProductSessionPrOpener({
        platform,
        start: (command, args, callback) => {
          calls.push([command, args]);
          callback(null);
        },
      })(url);

      expect(calls).toEqual([expected]);
    });
  }

  it('opens only an https link', async () => {
    const start = vi.fn();

    await expect(
      createProductSessionPrOpener({ platform: 'linux', start })(
        'http://github.com/team/repo/pull/1',
      ),
    ).rejects.toThrow(/https/u);
    expect(start).not.toHaveBeenCalled();
  });
});
