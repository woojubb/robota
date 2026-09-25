/**
 * Issue #3082 — OS-level confinement of shell commands. The policy builders are checked on every
 * platform; the real bubblewrap cases run where bubblewrap can start a sandbox, and exercise the
 * shell tool end to end so the confinement is what a model's command actually gets.
 */

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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBashTool } from '../../builtins/shell-tool.js';
import { detectOsSandbox, OsSandboxClient } from '../os-sandbox-client.js';
import { bubblewrapArguments, seatbeltProfile } from '../os-sandbox-policy.js';

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
  const exists = (path: string): boolean =>
    [
      '/w/project/.robota',
      '/w/project/.git/hooks',
      '/w/project/.robota/worktrees',
      '/home/me/.ssh',
      '/home/me/.netrc',
    ].includes(path);

  it('mounts the system read-only, the workspace and temp writable, and cuts the network', () => {
    const args = bubblewrapArguments({
      policy,
      exists,
      cwd: '/w/project/src',
      command: '/bin/sh',
      args: ['-c', 'ls'],
    });
    expect(args.slice(0, 3)).toEqual(['--ro-bind', '/', '/']);
    expect(args.join(' ')).toContain('--bind-try /w/project /w/project');
    expect(args.join(' ')).toContain('--bind-try /tmp /tmp');
    expect(args.join(' ')).toContain('--bind-try /home/me/.cache /home/me/.cache');
    expect(args).toContain('--unshare-net');
    expect(args.slice(-6)).toEqual(['--chdir', '/w/project/src', '--', '/bin/sh', '-c', 'ls']);
  });

  it('keeps existing protected entries read-only and reopens worktrees', () => {
    const joined = bubblewrapArguments({
      policy,
      exists,
      cwd: '/w/project',
      command: 'sh',
      args: [],
    }).join(' ');
    expect(joined).toContain('--ro-bind /w/project/.robota /w/project/.robota');
    expect(joined).toContain('--ro-bind /w/project/.git/hooks /w/project/.git/hooks');
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
      cwd: '/w',
      command: 'sh',
      args: [],
    });
    expect(args).not.toContain('--unshare-net');
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

  it('auto-approves a confined command unless auto-allow is off or it names a protected file', () => {
    const client = new OsSandboxClient({
      root: '/w',
      availability: available,
      settings: { enabled: true },
    });
    expect(client.autoApproves('npm test')).toBe(true);
    expect(client.autoApproves('echo {} > .mcp.json')).toBe(false);
    expect(client.autoApproves('cp x .robota/settings.json')).toBe(false);
    client.configure({ autoAllowBashIfSandboxed: false });
    expect(client.autoApproves('npm test')).toBe(false);
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

  beforeEach(() => {
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
    'hides denyRead paths and runs excluded commands on the host',
    async () => {
      const client = new OsSandboxClient({
        root,
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
