import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * The first interactive start asks once about a web search MCP server. A chosen server is written to
 * the user's settings and approved BEFORE the session's MCP definitions are resolved — resolution
 * happens once per start — so it connects in that same session.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { offerWebSearchMcpServer } from '../first-run-web-search.js';
import { createFileMcpApprovalStore } from '../mcp-approval-file-store.js';
import { composeMcpClientForStartup } from '../mcp-startup.js';
import { createProductUserSettingsSources } from '../../product/user-settings.js';
import { createCapturingTerminal } from './test-terminal.js';

import type { IWebSearchOfferInput } from '../first-run-web-search.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(settings?: unknown) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-first-run-search-')));
  roots.push(home);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  if (settings !== undefined) {
    mkdirSync(join(home, '.test-product'), { recursive: true });
    writeFileSync(runtime.layout.userPaths.settings, JSON.stringify(settings));
  }
  const { terminal, lines, errors } = createCapturingTerminal();
  const asked: string[] = [];
  const answers: string[] = [];
  const input = (overrides: Partial<IWebSearchOfferInput> = {}): IWebSearchOfferInput => ({
    firstRun: true,
    interactive: true,
    terminal,
    productRuntime: runtime,
    settingsSources: createProductUserSettingsSources(runtime),
    env: {},
    approvalStore: createFileMcpApprovalStore(runtime.layout.userPaths.mcpApprovals),
    read: async (label) => {
      asked.push(label);
      return answers.shift() ?? '';
    },
    ...overrides,
  });
  return { runtime, input, lines, errors, asked, answers };
}

function storedServers(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  return (JSON.parse(readFileSync(path, 'utf8')) as { mcpServers?: Record<string, unknown> })
    .mcpServers;
}

describe('offerWebSearchMcpServer', () => {
  it('says queries go to the chosen service and that no key is needed, with Skip last', async () => {
    const s = setup();

    await offerWebSearchMcpServer(s.input());

    const question = s.asked[0] ?? '';
    expect(question).toContain('queries are sent to the service you choose');
    expect(question).toContain('no API key is needed');
    expect(question).toContain('1. Exa');
    expect(question).toContain('https://mcp.exa.ai/mcp');
    expect(question).toContain('2. Parallel');
    expect(question).toContain('https://mcp.parallel.ai/mcp');
    expect(question).toContain('3. Skip');
  });

  it.each([
    ['1', 'exa', 'https://mcp.exa.ai/mcp'],
    ['2', 'parallel', 'https://mcp.parallel.ai/mcp'],
    ['Exa', 'exa', 'https://mcp.exa.ai/mcp'],
  ])('answer %j writes and approves %s, connecting in this session', async (answer, name, url) => {
    const s = setup({ language: 'ko' });
    s.answers.push(answer);

    await offerWebSearchMcpServer(s.input());

    expect(storedServers(s.runtime.layout.userPaths.settings)).toEqual({
      [name]: { type: 'http', url },
    });
    expect(JSON.parse(readFileSync(s.runtime.layout.userPaths.settings, 'utf8'))).toMatchObject({
      language: 'ko',
    });
    expect(s.errors).toEqual([]);
    const said = s.lines.join('\n');
    expect(said).toContain(`Added MCP server "${name}"`);
    expect(said).toContain('connects in this session');
  });

  it.each([[''], ['3'], ['skip'], ['0'], ['9'], ['yes please'], ['1e0']])(
    'answer %j adds nothing',
    async (answer) => {
      const s = setup();
      s.answers.push(answer);

      await offerWebSearchMcpServer(s.input());

      expect(existsSync(s.runtime.layout.userPaths.settings)).toBe(false);
      expect(existsSync(s.runtime.layout.userPaths.mcpApprovals)).toBe(false);
      expect(s.lines.join('\n')).toContain('mcp add <exa|parallel>');
    },
  );

  it('never prompts when the start is not an interactive terminal session', async () => {
    const s = setup();
    s.answers.push('1');

    await offerWebSearchMcpServer(s.input({ interactive: false }));

    expect(s.asked).toEqual([]);
    expect(existsSync(s.runtime.layout.userPaths.settings)).toBe(false);
    expect(s.lines).toEqual([]);
  });

  it('never prompts after the first start', async () => {
    const s = setup();
    s.answers.push('1');

    await offerWebSearchMcpServer(s.input({ firstRun: false }));

    expect(s.asked).toEqual([]);
    expect(existsSync(s.runtime.layout.userPaths.settings)).toBe(false);
  });

  it('reports a name already taken by another definition and starts anyway', async () => {
    const taken = { mcpServers: { exa: { type: 'http', url: 'https://elsewhere.example/mcp' } } };
    const s = setup(taken);
    s.answers.push('1');

    await expect(offerWebSearchMcpServer(s.input())).resolves.toBeUndefined();

    expect(s.errors.join('\n')).toContain('"exa" was not added');
    expect(storedServers(s.runtime.layout.userPaths.settings)).toEqual(taken.mcpServers);
  });

  it('reports a settings file it cannot read and starts anyway', async () => {
    const s = setup();
    mkdirSync(join(s.runtime.layout.userRoot), { recursive: true });
    writeFileSync(s.runtime.layout.userPaths.settings, '{ not json');
    s.answers.push('2');

    await expect(offerWebSearchMcpServer(s.input())).resolves.toBeUndefined();

    expect(s.errors.join('\n')).toContain('invalid JSON');
    expect(readFileSync(s.runtime.layout.userPaths.settings, 'utf8')).toBe('{ not json');
  });

  it('treats an unreadable answer as a skip', async () => {
    const s = setup();

    await offerWebSearchMcpServer(
      s.input({
        read: async () => {
          throw new Error('input closed');
        },
      }),
    );

    expect(existsSync(s.runtime.layout.userPaths.settings)).toBe(false);
    expect(s.errors.join('\n')).toContain('input closed');
  });

  // MCP definitions are resolved once per start. A composition made before the step never sees the
  // server it adds; one made after sees it approved — which is why the CLI runs the step first.
  it('is seen as approved by an MCP composition made after it, and not by one made before', async () => {
    const s = setup();
    s.answers.push('1');
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-first-run-search-cwd-')));
    roots.push(cwd);
    const compose = () =>
      composeMcpClientForStartup({
        productRuntime: s.runtime,
        settingsSources: createProductUserSettingsSources(s.runtime),
        projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', cwd),
        cwd,
        env: {},
        mode: 'interactive',
        approvalStore: createFileMcpApprovalStore(s.runtime.layout.userPaths.mcpApprovals),
        reportDiagnostic: () => undefined,
      });

    const before = await compose();
    await offerWebSearchMcpServer(s.input());
    const after = await compose();

    expect(before.activationAdapter.list()).toEqual([]);
    expect(after.activationAdapter.list()).toMatchObject([
      { serverId: 'exa', source: 'user', status: 'approved', allowed: true },
    ]);
    await Promise.all([before.shutdown(), after.shutdown()]);
  });
});
