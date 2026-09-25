/**
 * The host side of MCP header helpers: the user-settings allowlist, the bounded runner, and the
 * startup wiring that makes an allowed, approved helper authenticate a server's requests.
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
import { fileURLToPath } from 'node:url';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { MCPHeadersHelperError } from '@robota-sdk/agent-mcp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveMcpHeaderHelperAllowlist } from '../mcp-header-helper-allowlist.js';
import { headersHelperEnvironment, runHeadersHelper } from '../mcp-headers-helper-runner.js';
import { composeMcpClientForStartup } from '../mcp-startup.js';
import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';

import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const FIXTURE = fileURLToPath(new URL('./fixtures/headers-helper.mjs', import.meta.url));
const helperFor = (...args: string[]) => ({ command: process.execPath, args: [FIXTURE, ...args] });

const roots: string[] = [];
function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

let home: string;
beforeEach(() => {
  home = tempRoot('robota-headers-helper-home-');
  vi.stubEnv('HOME', home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function settingsFile(dir: string, content: unknown): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'settings.json');
  writeFileSync(path, JSON.stringify(content));
  return path;
}

async function failureOf(promise: Promise<unknown>): Promise<MCPHeadersHelperError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MCPHeadersHelperError);
  expect(String(error)).not.toContain('secret-text');
  return error as MCPHeadersHelperError;
}

describe('the header helper allowlist', () => {
  it('reads exact command lines from user settings only', () => {
    const allowed = [{ command: '/opt/token', args: ['--for', 'mcp'] }];
    const user = settingsFile(join(home, 'user'), { mcpHeaderHelpers: allowed });
    const managed = settingsFile(join(home, 'managed'), {
      mcpHeaderHelpers: [{ command: '/opt/other', args: [] }],
    });
    const result = resolveMcpHeaderHelperAllowlist([
      createNodeHostSettingsSource('user', user),
      createNodeHostSettingsSource('managed', managed),
    ]);
    expect(result.allowed).toEqual(allowed);
    expect(result.diagnostics).toEqual([
      expect.stringContaining('only user settings may allow a header helper'),
    ]);
  });

  it('refuses a malformed list whole, without quoting it', () => {
    const user = settingsFile(join(home, 'user'), {
      mcpHeaderHelpers: [{ command: '/opt/token' }, { command: 'relative-secret' }],
    });
    const result = resolveMcpHeaderHelperAllowlist([createNodeHostSettingsSource('user', user)]);
    expect(result.allowed).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).not.toContain('relative-secret');
  });
});

describe('the helper environment', () => {
  const host = {
    PATH: '/bin',
    NODE_OPTIONS: '--require evil.js',
    LD_PRELOAD: 'evil.so',
    BASH_ENV: 'evil.sh',
    GITHUB_TOKEN: 'ghp',
    AWS_SECRET_ACCESS_KEY: 'aws',
    ROBOTA_MCP_SERVER_NAME: 'spoofed',
  };

  it('drops execution variables and sets the server name and URL', () => {
    const env = headersHelperEnvironment(host, 'user', 'remote', 'https://mcp.example.test/mcp');
    expect(env).toEqual({
      PATH: '/bin',
      GITHUB_TOKEN: 'ghp',
      AWS_SECRET_ACCESS_KEY: 'aws',
      ROBOTA_MCP_SERVER_NAME: 'remote',
      ROBOTA_MCP_SERVER_URL: 'https://mcp.example.test/mcp',
    });
  });

  it('also drops credential-shaped variables for a project or local helper', () => {
    for (const source of ['project', 'local'] as const) {
      const env = headersHelperEnvironment(host, source, 'remote', 'https://mcp.example.test/mcp');
      expect(Object.keys(env).sort()).toEqual([
        'PATH',
        'ROBOTA_MCP_SERVER_NAME',
        'ROBOTA_MCP_SERVER_URL',
      ]);
    }
  });
});

describe('running a helper', () => {
  const signal = new AbortController().signal;

  it('returns stdout, runs in the given cwd with exactly the given environment', async () => {
    const cwd = tempRoot('robota-headers-helper-cwd-');
    const out = await runHeadersHelper({
      helper: helperFor('env'),
      cwd,
      env: { PATH: process.env.PATH ?? '', ONLY_THIS: '1' },
      signal,
    });
    const headers = JSON.parse(out) as Record<string, string>;
    expect(headers['X-Cwd']).toBe(cwd);
    expect(headers['X-Env']?.split(',')).toContain('ONLY_THIS');
    expect(headers['X-Env']?.split(',')).not.toContain('HOME');
  });

  it('discards stderr', async () => {
    const out = await runHeadersHelper({ helper: helperFor('ok'), cwd: home, env: {}, signal });
    expect(out).not.toContain('stderr-secret-text');
  });

  it('refuses a non-zero exit without quoting what it printed', async () => {
    const error = await failureOf(
      runHeadersHelper({ helper: helperFor('fail'), cwd: home, env: {}, signal }),
    );
    expect(error.reason).toBe('exit-status');
  });

  it('refuses output over 64 KiB', async () => {
    const error = await failureOf(
      runHeadersHelper({ helper: helperFor('large'), cwd: home, env: {}, signal }),
    );
    expect(error.reason).toBe('output-too-large');
  });

  it('refuses a missing executable', async () => {
    const error = await failureOf(
      runHeadersHelper({
        helper: { command: join(home, 'missing-secret-text'), args: [] },
        cwd: home,
        env: {},
        signal,
      }),
    );
    expect(error.reason).toBe('spawn-failed');
  });

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    // An unreaped child is gone for every purpose but the process table.
    if (process.platform === 'linux' && existsSync(`/proc/${pid}/stat`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
    }
    return true;
  }

  async function grandchildOf(pidFile: string): Promise<number> {
    await vi.waitFor(() => expect(existsSync(pidFile)).toBe(true), { timeout: 5_000 });
    await vi.waitFor(() => expect(readFileSync(pidFile, 'utf8')).not.toBe(''), { timeout: 5_000 });
    return Number(readFileSync(pidFile, 'utf8'));
  }

  it.skipIf(process.platform === 'win32')(
    'kills the whole process tree on timeout',
    async () => {
      const pidFile = join(home, 'grandchild.pid');
      const running = runHeadersHelper({
        helper: helperFor('hang', pidFile),
        cwd: home,
        env: {},
        signal,
        timeoutMs: 1_500,
      });
      const grandchild = await grandchildOf(pidFile);
      const error = await failureOf(running);
      expect(error.reason).toBe('timeout');
      await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5_000 });
    },
    15_000,
  );

  it.skipIf(process.platform === 'win32')(
    'kills the whole process tree on cancel',
    async () => {
      const pidFile = join(home, 'grandchild.pid');
      const controller = new AbortController();
      const running = runHeadersHelper({
        helper: helperFor('hang', pidFile),
        cwd: home,
        env: {},
        signal: controller.signal,
      });
      const grandchild = await grandchildOf(pidFile);
      controller.abort();
      const error = await failureOf(running);
      expect(error.reason).toBe('cancelled');
      await vi.waitFor(() => expect(alive(grandchild)).toBe(false), { timeout: 5_000 });
    },
    15_000,
  );
});

const restrictedAccess: TWorkspaceProjectAccess = {
  status: 'restricted',
  trustState: 'identity-unavailable',
} as TWorkspaceProjectAccess;

interface IStubbedFetch {
  readonly fetch: typeof globalThis.fetch;
  readonly authorizations: (string | null)[];
  readonly servers: (string | null)[];
}

/** Every request is refused, so a test sees exactly the first attempt and its one retry. */
function refusingFetch(): IStubbedFetch {
  const authorizations: (string | null)[] = [];
  const servers: (string | null)[] = [];
  const fetchStub = (async (_input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    authorizations.push(headers.get('authorization'));
    servers.push(headers.get('x-server'));
    return new Response(null, { status: 401 });
  }) as typeof globalThis.fetch;
  return { fetch: fetchStub, authorizations, servers };
}

async function startWith(settings: Record<string, unknown>, stub: IStubbedFetch) {
  mkdirSync(join(home, '.robota'), { recursive: true });
  writeFileSync(join(home, '.robota', 'settings.json'), JSON.stringify(settings));
  const messages: string[] = [];
  const mcp = await composeMcpClientForStartup({
    settingsSources: createRobotaUserSettingsSources(home),
    projectAccess: restrictedAccess,
    cwd: home,
    env: { PATH: process.env.PATH ?? '', HOME: home },
    mode: 'print',
    reportDiagnostic: (message) => messages.push(message),
    httpTransportDeps: { fetch: stub.fetch, lookup: async () => ['203.0.113.9'] },
  });
  return { mcp, messages };
}

const REMOTE = {
  type: 'http',
  url: 'https://mcp.example.test/mcp',
  headers: { Authorization: 'Bearer static-only' },
  headersHelper: helperFor('ok'),
};

describe('a header helper at startup', () => {
  it('authenticates an allowed, approved server with the helper, and runs it again once on 401', async () => {
    const stub = refusingFetch();
    const { mcp, messages } = await startWith(
      { mcpServers: { remote: REMOTE }, mcpHeaderHelpers: [helperFor('ok')] },
      stub,
    );
    const summary = await mcp.activationAdapter.approve('remote');
    expect(summary.allowed).toBe(true);
    try {
      expect(await mcp.connect()).toEqual([]);
    } finally {
      await mcp.shutdown();
    }
    expect(stub.authorizations).toEqual(['Bearer helper-run-1', 'Bearer helper-run-2']);
    expect(stub.servers).toEqual(['remote', 'remote']);
    // The helper ran in the user's Robota home, not the process cwd.
    expect(readFileSync(join(home, '.robota', 'runs'), 'utf8')).toBe('2');
    const printed = messages.join('\n');
    expect(printed).not.toContain('helper-run');
    expect(printed).not.toContain('stderr-secret-text');
  });

  it('refuses a helper the user did not allow, and never connects with the static headers', async () => {
    const stub = refusingFetch();
    const { mcp, messages } = await startWith({ mcpServers: { remote: REMOTE } }, stub);
    await mcp.activationAdapter.approve('remote');
    try {
      expect(await mcp.connect()).toEqual([]);
    } finally {
      await mcp.shutdown();
    }
    expect(stub.authorizations).toEqual([]);
    expect(messages.join('\n')).toContain('headers-helper-not-allowed');
    expect(existsSync(join(home, '.robota', 'runs'))).toBe(false);
  });

  it('refuses a helper allowed only for other arguments', async () => {
    const stub = refusingFetch();
    const { mcp, messages } = await startWith(
      { mcpServers: { remote: REMOTE }, mcpHeaderHelpers: [helperFor('env')] },
      stub,
    );
    await mcp.activationAdapter.approve('remote');
    try {
      await mcp.connect();
    } finally {
      await mcp.shutdown();
    }
    expect(stub.authorizations).toEqual([]);
    expect(messages.join('\n')).toContain('headers-helper-not-allowed');
  });

  it('does not run the helper before the server is approved', async () => {
    const stub = refusingFetch();
    const { mcp } = await startWith(
      { mcpServers: { remote: REMOTE }, mcpHeaderHelpers: [helperFor('ok')] },
      stub,
    );
    try {
      await mcp.connect();
    } finally {
      await mcp.shutdown();
    }
    expect(stub.authorizations).toEqual([]);
    expect(existsSync(join(home, '.robota', 'runs'))).toBe(false);
  });
});
