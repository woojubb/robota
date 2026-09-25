/**
 * Issue #3082 — OS-level confinement of shell commands. The policy builders are checked on every
 * platform; the real bubblewrap cases run where bubblewrap can start a sandbox, and exercise the
 * shell tool end to end so the confinement is what a model's command actually gets.
 */

import {
  existsSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBashTool } from '../../builtins/shell-tool.js';
import { detectOsSandbox, OsSandboxClient } from '../os-sandbox-client.js';
import { bubblewrapArguments, seatbeltProfile } from '../os-sandbox-policy.js';
import { unixSocketSeccompFilter } from '../os-sandbox-seccomp.js';

import type { IToolInvocationResult } from '../../types/tool-result.js';
import type { IOsSandboxPolicy } from '../os-sandbox-policy.js';

const SPAWN_TIMEOUT_MS = 60_000;

const policy: IOsSandboxPolicy = {
  root: '/w/project',
  tempDirectories: ['/tmp'],
  allowWrite: ['/home/me/.cache'],
  denyRead: [
    { path: '/home/me/.ssh', directory: true },
    { path: '/home/me/.netrc', directory: false },
  ],
  network: false,
};

describe('bubblewrap arguments', () => {
  const listDirectory = (path: string): string[] =>
    path === '/w/project/.robota/worktrees' ? ['feature'] : [];
  const exists = (path: string): boolean =>
    [
      '/w/project/.git',
      '/w/project/.robota/worktrees/feature/.git',
      '/w/project/.robota',
      '/w/project/.robota/worktrees',
      '/home/me/.ssh',
      '/home/me/.netrc',
    ].includes(path);

  it('mounts the system read-only, the workspace and temp writable, and cuts the network', () => {
    const args = bubblewrapArguments({
      policy,
      exists,
      listDirectory,
      seccompDescriptor: 3,
      cwd: '/w/project/src',
      command: '/bin/sh',
      args: ['-c', 'ls'],
    });
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args.join(' ')).toContain('--bind-try /w/project /w/project');
    expect(args.join(' ')).toContain('--bind-try /tmp /tmp');
    expect(args.join(' ')).toContain('--bind-try /home/me/.cache /home/me/.cache');
    expect(args.join(' ')).toContain('--unshare-net --seccomp 3');
    expect(args).toContain('--unshare-pid');
    expect(args.slice(-6)).toEqual(['--chdir', '/w/project/src', '--', '/bin/sh', '-c', 'ls']);
  });

  it('keeps existing protected entries read-only and reopens worktrees', () => {
    const joined = bubblewrapArguments({
      policy,
      exists,
      listDirectory,
      seccompDescriptor: 3,
      cwd: '/w/project',
      command: 'sh',
      args: [],
    }).join(' ');
    expect(joined).toContain('--ro-bind /w/project/.robota /w/project/.robota');
    // `.git` is read-only as a whole; a worktree's `.git` file stays put too.
    expect(joined).toContain('--ro-bind /w/project/.git /w/project/.git');
    expect(joined).toContain(
      '--ro-bind /w/project/.robota/worktrees/feature/.git /w/project/.robota/worktrees/feature/.git',
    );
    expect(joined).toContain('--bind /w/project/.robota/worktrees /w/project/.robota/worktrees');
    // A missing entry is not bound: the bind would create it on the host.
    expect(joined).not.toContain('/w/project/.mcp.json');
    expect(joined).toContain('--tmpfs /home/me/.ssh');
    expect(joined).toContain('--ro-bind /dev/null /home/me/.netrc');
  });

  it('leaves the network alone when allowed', () => {
    const args = bubblewrapArguments({
      policy: { ...policy, network: true },
      exists,
      listDirectory,
      cwd: '/w',
      command: 'sh',
      args: [],
    });
    expect(args).not.toContain('--unshare-net');
    expect(args).not.toContain('--seccomp');
  });

  it('refuses to cut the network without the socket filter', () => {
    expect(() =>
      bubblewrapArguments({ policy, exists, listDirectory, cwd: '/w', command: 'sh', args: [] }),
    ).toThrow(/seccomp/);
  });
});

describe('the Unix-socket seccomp filter', () => {
  it('is a filter for x64 and arm64 and nothing else', () => {
    expect(unixSocketSeccompFilter('x64')?.length).toBe(13 * 8);
    expect(unixSocketSeccompFilter('arm64')?.length).toBe(13 * 8);
    expect(unixSocketSeccompFilter('ia32')).toBeUndefined();
  });
});

describe('Seatbelt profile', () => {
  it('denies writes, reopens the writable places, then re-denies protected entries', () => {
    const profile = seatbeltProfile(policy);
    const lines = profile.split('\n');
    expect(lines.slice(0, 3)).toEqual(['(version 1)', '(allow default)', '(deny file-write*)']);
    expect(lines[3]).toContain('(subpath "/w/project")');
    expect(lines[4]).toContain('(subpath "/w/project/.robota")');
    expect(lines[4]).toContain('(literal "/w/project/.mcp.json")');
    expect(lines[5]).toContain('(subpath "/w/project/.robota/worktrees")');
    expect(lines[6]).toContain('(literal "/w/project/.git")');
    expect(lines[6]).toContain('/w/project/\\.robota/worktrees/[^/]+/\\.git$');
    expect(profile).toContain(
      '(deny file-read* (subpath "/home/me/.ssh") (literal "/home/me/.netrc"))',
    );
    expect(profile).toContain('(deny network*)');
    expect(seatbeltProfile({ ...policy, network: true })).not.toContain('network');
  });

  it('escapes quotes in paths', () => {
    expect(seatbeltProfile({ ...policy, root: '/w/a"b' })).toContain('(subpath "/w/a\\"b")');
  });
});

describe('OsSandboxClient', () => {
  const available = { backend: 'bubblewrap' as const, executable: 'bwrap', missing: [] };

  it('confines nothing until enabled, and nothing an exclusion names', () => {
    const client = new OsSandboxClient({ root: '/w', availability: available });
    expect(client.confines('ls')).toBe(false);
    client.configure({ enabled: true, excludedCommands: ['docker'] });
    expect(client.confines('ls')).toBe(true);
    expect(client.confines('docker ps')).toBe(false);
    const invocation = { command: 'sh', args: ['-c', 'docker ps'], cwd: '/w' };
    expect(client.wrapCommand(invocation, 'docker ps')).toBe(invocation);
  });

  it('auto-approves a confined command unless auto-allow is off', () => {
    const client = new OsSandboxClient({
      root: '/w',
      availability: available,
      settings: { enabled: true },
    });
    expect(client.autoApproves('npm test')).toBe(true);
    client.configure({ autoAllowBashIfSandboxed: false });
    expect(client.autoApproves('npm test')).toBe(false);
  });

  it('keeps a line that runs more than an excluded program confined', () => {
    const client = new OsSandboxClient({
      root: '/w',
      availability: available,
      settings: { enabled: true, excludedCommands: ['docker'] },
    });
    expect(client.confines('docker ps')).toBe(false);
    expect(client.confines('docker ps; rm -rf ~')).toBe(true);
  });

  it('is inactive where the backend cannot run, and says what is missing', () => {
    const client = new OsSandboxClient({
      root: '/w',
      availability: {
        backend: 'bubblewrap',
        missing: ['bubblewrap (install the `bubblewrap` package)'],
      },
      settings: { enabled: true },
    });
    expect(client.status().active).toBe(false);
    expect(client.autoApproves('ls')).toBe(false);
  });
});

describe('detectOsSandbox', () => {
  it('names the backend per platform and what is missing', () => {
    expect(detectOsSandbox({ platform: 'win32' })).toEqual({
      missing: [],
      unsupportedPlatform: 'win32',
    });
    expect(detectOsSandbox({ platform: 'linux', probe: () => ({ ok: true }) }).executable).toBe(
      'bwrap',
    );
    expect(
      detectOsSandbox({
        platform: 'linux',
        probe: () => ({ ok: false, detail: 'spawnSync bwrap ENOENT' }),
      }).missing,
    ).toEqual(['bubblewrap (install the `bubblewrap` package)']);
    expect(detectOsSandbox({ platform: 'darwin', probe: () => ({ ok: true }) }).backend).toBe(
      'seatbelt',
    );
  });
});

const bubblewrap = detectOsSandbox();
const canConfine = bubblewrap.executable !== undefined && process.platform === 'linux';

describe.runIf(canConfine)('a confined Bash command (real bubblewrap)', () => {
  let root: string;
  let outside: string;
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-os-sandbox-home-')));
    root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-os-sandbox-')));
    mkdirSync(join(root, '.robota'));
    writeFileSync(join(root, '.robota', 'settings.json'), '{}');
    // Outside the workspace and outside every temp directory.
    outside = mkdtempSync(join(process.cwd(), '.os-sandbox-outside-'));
    writeFileSync(join(outside, 'secret'), 'SECRET');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  async function bash(client: OsSandboxClient, command: string): Promise<IToolInvocationResult> {
    const tool = createBashTool({ cwd: root, sandboxClient: client });
    const raw = await tool.execute({ command }, { toolName: 'Bash', parameters: { command } });
    return JSON.parse(raw.data as string) as IToolInvocationResult;
  }

  it(
    'writes inside the workspace, not outside it or to protected files, and has no network',
    async () => {
      const client = new OsSandboxClient({
        root,
        homeDirectory: home,
        availability: bubblewrap,
        settings: { enabled: true },
      });
      await bash(client, 'echo ok > inside.txt');
      expect(readFileSync(join(root, 'inside.txt'), 'utf8')).toBe('ok\n');

      await bash(client, `echo pwned > ${outside}/written`);
      expect(existsSync(join(outside, 'written'))).toBe(false);

      await bash(client, 'echo pwned > .robota/settings.json');
      expect(readFileSync(join(root, '.robota', 'settings.json'), 'utf8')).toBe('{}');

      // The command's own network namespace holds only the loopback device.
      const net = await bash(client, "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '");
      expect(net.output.trim()).toBe('lo');
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'cannot reach a host daemon over a Unix socket or see host processes when the network is off',
    async () => {
      const socketPath = join(outside, 'daemon.sock');
      const received: string[] = [];
      const server = createServer((connection) => {
        connection.on('data', (chunk) => received.push(chunk.toString()));
      });
      await new Promise<void>((resolveListen) => server.listen(socketPath, resolveListen));
      try {
        const client = new OsSandboxClient({
          root,
          availability: bubblewrap,
          settings: { enabled: true },
        });
        const script = `require('net').connect(${JSON.stringify(socketPath)}).on('connect', function () { this.end('escaped') }).on('error', (e) => console.log(e.code))`;
        const result = await bash(client, `${process.execPath} -e ${JSON.stringify(script)}`);
        await new Promise((resolveWait) => setTimeout(resolveWait, 200));
        expect(received).toEqual([]);
        expect(result.output).toContain('EAFNOSUPPORT');

        const kill = await bash(client, `kill -0 ${process.pid} && echo visible || echo hidden`);
        expect(kill.output).toContain('hidden');
      } finally {
        server.close();
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'removes protected configuration a command creates, and cannot rename .git away',
    async () => {
      execFileSync('git', ['init', '-q', root]);
      const client = new OsSandboxClient({
        root,
        homeDirectory: home,
        availability: bubblewrap,
        settings: { enabled: true },
      });
      const created = await bash(client, 'F=.mc; echo {} > "${F}p.json"; echo done');
      expect(existsSync(join(root, '.mcp.json'))).toBe(false);
      expect(created.output).toContain('moved');
      // Moved aside, not deleted.
      // Outside the workspace, where the command cannot reach it.
      const quarantine = join(home, '.robota', 'sandbox-quarantine');
      expect(readdirSync(quarantine).length).toBe(1);

      // `.git` is read-only whole: git cannot be pointed at another config through `commondir`.
      await bash(client, 'echo /tmp/evil > .git/commondir');
      expect(existsSync(join(root, '.git', 'commondir'))).toBe(false);

      await bash(
        client,
        'D=.g; mv ${D}it ${D}old; git init -q . && git config core.hooksPath /tmp/evil',
      );
      expect(existsSync(join(root, '.gold'))).toBe(false);
      // Unset: `git config --get` exits non-zero.
      expect(() =>
        execFileSync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], { stdio: 'pipe' }),
      ).toThrow();
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    'restores a protected symlink the command replaced, and keeps its target read-only',
    async () => {
      mkdirSync(join(root, 'shared-claude'));
      writeFileSync(join(root, 'shared-claude', 'settings.json'), '{}');
      symlinkSync('shared-claude', join(root, '.claude'));
      const client = new OsSandboxClient({
        root,
        homeDirectory: home,
        availability: bubblewrap,
        settings: { enabled: true },
      });
      await bash(client, 'echo pwn > .claude/settings.json');
      expect(readFileSync(join(root, 'shared-claude', 'settings.json'), 'utf8')).toBe('{}');
      await bash(client, 'rm .claude && mkdir .claude && echo pwn > .claude/settings.json');
      expect(readlinkSync(join(root, '.claude'))).toBe('shared-claude');
      expect(readFileSync(join(root, '.claude', 'settings.json'), 'utf8')).toBe('{}');
    },
    SPAWN_TIMEOUT_MS,
  );

  it('does not auto-approve while a protected entry is a symlink into the workspace', () => {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'mcp.json'), '{}');
    symlinkSync('config/mcp.json', join(root, '.mcp.json'));
    const client = new OsSandboxClient({
      root,
      homeDirectory: home,
      availability: bubblewrap,
      settings: { enabled: true },
    });
    expect(client.autoApproves('ls')).toBe(false);
  });

  it(
    'restores a replaced robota symlink without crashing, even into itself',
    async () => {
      mkdirSync(join(root, 'robota-real'));
      rmSync(join(root, '.robota'), { recursive: true, force: true });
      symlinkSync('robota-real', join(root, '.robota'));
      const client = new OsSandboxClient({
        root,
        homeDirectory: home,
        availability: bubblewrap,
        settings: { enabled: true },
      });
      const result = await bash(
        client,
        `rm .robota && mkdir .robota && echo '{"hooks":1}' > .robota/settings.json`,
      );
      expect(result.output).toContain('[sandbox]');
      expect(readlinkSync(join(root, '.robota'))).toBe('robota-real');
      expect(existsSync(join(root, 'robota-real', 'settings.json'))).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it('does not auto-approve while a protected entry is a dangling symlink', () => {
    symlinkSync('missing-target', join(root, '.agents'));
    const client = new OsSandboxClient({
      root,
      availability: bubblewrap,
      settings: { enabled: true },
    });
    expect(client.confines('ls')).toBe(true);
    expect(client.autoApproves('ls')).toBe(false);
  });

  it(
    'hides denyRead paths and runs excluded commands on the host',
    async () => {
      const client = new OsSandboxClient({
        root,
        homeDirectory: home,
        availability: bubblewrap,
        settings: { enabled: true, denyRead: [outside] },
      });
      expect((await bash(client, `cat ${outside}/secret`)).output).not.toContain('SECRET');
      client.configure({ excludedCommands: ['cat'] });
      expect((await bash(client, `cat ${outside}/secret`)).output).toContain('SECRET');
    },
    SPAWN_TIMEOUT_MS,
  );
});
