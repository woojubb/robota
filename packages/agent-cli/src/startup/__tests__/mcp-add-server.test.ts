import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * `mcp add`: a person adds an HTTP MCP server to the product's own user settings and approves it in
 * the same step. The proof is what a later start sees: it resolves the same sources, builds the same
 * activation request and inspects the same approval file — and finds the server `approved`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { MCPActivationAdmissionService, MCPDefinitionRegistry } from '@robota-sdk/agent-mcp';
import { afterEach, describe, expect, it } from 'vitest';

import {
  WEB_SEARCH_MCP_CATALOG,
  addUserMcpServer,
  parseMcpAddArguments,
  runMcpAddCommand,
} from '../mcp-add-server.js';
import { createFileMcpApprovalStore } from '../mcp-approval-file-store.js';
import { resolveMcpDefinitions } from '../mcp-definition-sources.js';
import { createProductUserSettingsSources } from '../../product/user-settings.js';

import type { TSettingsSource } from '@robota-sdk/agent-framework';
import type { IMCPActivationRequest, TMCPActivationStatus } from '@robota-sdk/agent-mcp';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface IFixture {
  readonly home: string;
  readonly settingsPath: string;
  readonly approvalsPath: string;
  readonly runtime: ReturnType<typeof createTestProductRuntime>;
  readonly sources: readonly TSettingsSource[];
  readonly deps: Parameters<typeof addUserMcpServer>[1];
}

/** A temporary HOME with this user settings file (or none); the real home is never read. */
function fixture(settings?: unknown | string, extraSources: readonly TSettingsSource[] = []): IFixture {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-mcp-add-')));
  roots.push(home);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  const settingsPath = runtime.layout.userPaths.settings;
  if (settings !== undefined) {
    mkdirSync(join(home, '.test-product'), { recursive: true });
    writeFileSync(settingsPath, typeof settings === 'string' ? settings : JSON.stringify(settings));
  }
  const sources = [...createProductUserSettingsSources(runtime), ...extraSources];
  const approvalsPath = runtime.layout.userPaths.mcpApprovals;
  return {
    home,
    settingsPath,
    approvalsPath,
    runtime,
    sources,
    deps: {
      productRuntime: runtime,
      settingsSources: sources,
      env: {},
      approvalStore: createFileMcpApprovalStore(approvalsPath),
    },
  };
}

/** What a LATER start does: resolve the same sources, then inspect the persisted approval file. */
function inspectLikeStartup(f: IFixture, name: string): TMCPActivationStatus | undefined {
  const { entries } = resolveMcpDefinitions(f.sources, {});
  const request: IMCPActivationRequest | undefined = new MCPDefinitionRegistry(entries, {})
    .list()
    .find((candidate) => candidate.serverId === name);
  if (request === undefined) return undefined;
  return new MCPActivationAdmissionService(createFileMcpApprovalStore(f.approvalsPath)).inspect(
    request,
  ).status;
}

const EXA = { name: 'exa', url: 'https://mcp.exa.ai/mcp' };

describe('addUserMcpServer', () => {
  it('writes an http entry under mcpServers and keeps every other setting', () => {
    const existing = {
      language: 'ko',
      providers: { openai: { model: 'gpt-x' } },
      mcpServers: { local: { type: 'stdio', command: 'node', args: ['server.js'] } },
      permissions: { allow: ['Read(src/**)'] },
    };
    const f = fixture(existing);

    const result = addUserMcpServer(EXA, f.deps);

    expect(result).toMatchObject({ outcome: 'added', name: 'exa', settingsPath: f.settingsPath });
    expect(JSON.parse(readFileSync(f.settingsPath, 'utf8'))).toEqual({
      ...existing,
      mcpServers: { ...existing.mcpServers, exa: { type: 'http', url: EXA.url } },
    });
  });

  it('creates the settings file owner-only when there is none', () => {
    const f = fixture();

    addUserMcpServer(EXA, f.deps);

    expect(JSON.parse(readFileSync(f.settingsPath, 'utf8'))).toEqual({
      mcpServers: { exa: { type: 'http', url: EXA.url } },
    });
    if (process.platform !== 'win32') {
      expect(statSync(f.settingsPath).mode & 0o077).toBe(0);
    }
  });

  it('records an approval that a later start inspects as approved, not pending', () => {
    const f = fixture({ mcpServers: {} });
    // The same entry written by hand is what `/mcp approve` would still have to approve.
    const written = fixture({ mcpServers: { exa: { type: 'http', url: EXA.url } } });
    expect(inspectLikeStartup(written, 'exa')).toBe('pending');

    addUserMcpServer(EXA, f.deps);

    expect(inspectLikeStartup(f, 'exa')).toBe('approved');
    const approvals = JSON.parse(readFileSync(f.approvalsPath, 'utf8')) as {
      records: { serverId: string; source: string; approvalAuthority: string; decision: string }[];
    };
    expect(approvals.records).toMatchObject([
      { serverId: 'exa', source: 'user', approvalAuthority: 'user', decision: 'approved' },
    ]);
  });

  it('refuses a different entry under the same name and changes nothing', () => {
    const other = { mcpServers: { exa: { type: 'http', url: 'https://elsewhere.example/mcp' } } };
    const f = fixture(other);
    const before = readFileSync(f.settingsPath, 'utf8');

    const result = addUserMcpServer(EXA, f.deps);

    expect(result.outcome).toBe('refused');
    expect(result).toMatchObject({ reason: expect.stringContaining('different definition') });
    expect(readFileSync(f.settingsPath, 'utf8')).toBe(before);
    expect(() => readFileSync(f.approvalsPath, 'utf8')).toThrow();
  });

  it('refuses a same-name entry that carries more than the type and url', () => {
    const f = fixture({
      mcpServers: { exa: { type: 'http', url: EXA.url, headers: { 'x-team': 'a' } } },
    });
    const before = readFileSync(f.settingsPath, 'utf8');

    expect(addUserMcpServer(EXA, f.deps).outcome).toBe('refused');
    expect(readFileSync(f.settingsPath, 'utf8')).toBe(before);
  });

  it('keeps the identical entry as written and approves it', () => {
    const f = fixture({ mcpServers: { exa: { type: 'http', url: EXA.url } } });
    const before = readFileSync(f.settingsPath, 'utf8');
    expect(inspectLikeStartup(f, 'exa')).toBe('pending');

    const result = addUserMcpServer(EXA, f.deps);

    expect(result.outcome).toBe('unchanged');
    expect(readFileSync(f.settingsPath, 'utf8')).toBe(before);
    expect(inspectLikeStartup(f, 'exa')).toBe('approved');
  });

  it('is idempotent: a second add leaves one approval record', () => {
    const f = fixture();

    addUserMcpServer(EXA, f.deps);
    const second = addUserMcpServer(EXA, f.deps);

    expect(second.outcome).toBe('unchanged');
    const approvals = JSON.parse(readFileSync(f.approvalsPath, 'utf8')) as { records: unknown[] };
    expect(approvals.records).toHaveLength(1);
  });

  it('refuses a name a higher-precedence source defines, which approving here could not grant', () => {
    const managedPath = join(realpathSync(mkdtempSync(join(tmpdir(), 'test-product-managed-'))), 'policy.json');
    roots.push(join(managedPath, '..'));
    writeFileSync(
      managedPath,
      JSON.stringify({ mcpServers: { exa: { type: 'http', url: 'https://policy.example/mcp' } } }),
    );
    const f = fixture(undefined, [createNodeHostSettingsSource('managed', managedPath)]);

    const result = addUserMcpServer(EXA, f.deps);

    expect(result).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('managed') });
    expect(() => readFileSync(f.settingsPath, 'utf8')).toThrow();
    expect(() => readFileSync(f.approvalsPath, 'utf8')).toThrow();
  });

  it('refuses a settings file whose mcpServers is not an object', () => {
    const f = fixture({ mcpServers: ['exa'] });
    const before = readFileSync(f.settingsPath, 'utf8');

    expect(addUserMcpServer(EXA, f.deps)).toMatchObject({
      outcome: 'refused',
      reason: expect.stringContaining('not an object'),
    });
    expect(readFileSync(f.settingsPath, 'utf8')).toBe(before);
  });

  it('does not touch a settings file that is not valid JSON', () => {
    const f = fixture('{ not json');

    expect(() => addUserMcpServer(EXA, f.deps)).toThrow(/invalid JSON/u);
    expect(readFileSync(f.settingsPath, 'utf8')).toBe('{ not json');
  });
});

describe('parseMcpAddArguments', () => {
  it.each(WEB_SEARCH_MCP_CATALOG)('fills in the catalog URL for "$id"', (choice) => {
    expect(parseMcpAddArguments([choice.id])).toEqual({
      ok: true,
      request: { name: choice.id, url: choice.url },
    });
  });

  it('takes any name with an https URL', () => {
    expect(parseMcpAddArguments(['my-search', 'https://search.example.com/mcp'])).toEqual({
      ok: true,
      request: { name: 'my-search', url: 'https://search.example.com/mcp' },
    });
  });

  it('uses the URL given even for a catalog name', () => {
    expect(parseMcpAddArguments(['exa', 'https://proxy.example.com/exa'])).toMatchObject({
      ok: true,
      request: { name: 'exa', url: 'https://proxy.example.com/exa' },
    });
  });

  it.each([
    [[], 'expected'],
    [['custom'], 'needs a URL'],
    [['exa', 'https://a.example/mcp', 'extra'], 'expected'],
    [['custom', 'http://search.example.com/mcp'], 'https'],
    [['custom', 'not a url'], 'not a valid'],
    [['has space', 'https://a.example/mcp'], 'server name'],
    [['__proto__', 'https://a.example/mcp'], 'server name'],
    [['a'.repeat(33), 'https://a.example/mcp'], 'server name'],
    [['exa', '--force'], 'expected'],
  ] as const)('refuses %j', (args, reason) => {
    const parsed = parseMcpAddArguments(args);
    expect(parsed.ok).toBe(false);
    expect(parsed).toMatchObject({ reason: expect.stringContaining(reason) });
  });
});

describe('runMcpAddCommand', () => {
  function run(
    f: IFixture,
    args: readonly string[],
    interactive = true,
  ): { code: number; out: string; err: string } {
    let out = '';
    let err = '';
    const code = runMcpAddCommand(args, {
      ...f.deps,
      interactive,
      stdout: (text) => (out += text),
      stderr: (text) => (err += text),
    });
    return { code, out, err };
  }

  it('prints what was written and that it is approved, and connects on the next start', () => {
    const f = fixture();

    const { code, out, err } = run(f, ['parallel']);

    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain('Added MCP server "parallel" (https://mcp.parallel.ai/mcp)');
    expect(out).toContain(f.settingsPath);
    expect(out).toContain('approved');
    expect(out).toContain('next time test-product starts');
    expect(inspectLikeStartup(f, 'parallel')).toBe('approved');
  });

  it('adds a custom https server and prints no query string', () => {
    const f = fixture();

    const { code, out } = run(f, ['mine', 'https://search.example.com/mcp?token=secret-value']);

    expect(code).toBe(0);
    expect(out).not.toContain('secret-value');
    expect(JSON.parse(readFileSync(f.settingsPath, 'utf8'))).toEqual({
      mcpServers: {
        mine: { type: 'http', url: 'https://search.example.com/mcp?token=secret-value' },
      },
    });
    expect(inspectLikeStartup(f, 'mine')).toBe('approved');
  });

  it('refuses without a person at the terminal and writes nothing', () => {
    const f = fixture();

    const { code, out, err } = run(f, ['exa'], false);

    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toContain('runs only in an interactive terminal');
    expect(err).toContain('test-product mcp add exa');
    expect(existsSync(f.settingsPath)).toBe(false);
    expect(inspectLikeStartup(f, 'exa')).not.toBe('approved');
  });

  it('names the usage and writes nothing for a wrong invocation', () => {
    const f = fixture();

    const { code, out, err } = run(f, ['custom']);

    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toContain('Usage: test-product mcp add <exa|parallel>');
    expect(() => readFileSync(f.settingsPath, 'utf8')).toThrow();
  });

  it('exits 1 with the reason when the name is taken by another definition', () => {
    const f = fixture({ mcpServers: { exa: { type: 'http', url: 'https://elsewhere.example/mcp' } } });

    const { code, out, err } = run(f, ['exa']);

    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toContain('different definition');
  });

  it('exits 1 and says so for a settings file it cannot parse', () => {
    const f = fixture('{ not json');

    const { code, err } = run(f, ['exa']);

    expect(code).toBe(1);
    expect(err).toContain('invalid JSON');
  });
});
