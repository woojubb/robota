/**
 * The startup of print mode, `acp`, `mcp serve` over stdio and the terminal in secure conversations,
 * stopped where the MCP client is composed, which is after every workspace composition that builds a
 * session store: each got past them on a locked key holder. The first three never unlock, so none of
 * them builds the unlock gate; the terminal is the one a person unlocks.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { productKeyHolder } from '../product/session-sealing.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';
import { enableSecureConversations, resolveSecureRuntime } from './helpers/secure-product-state.js';

const testHost = createTestFrameworkHost();

const startup = vi.hoisted(() => ({ compose: vi.fn(), custodies: 0 }));
vi.mock('../product/key-custody.js', async (original) => {
  const actual = await original<typeof import('../product/key-custody.js')>();
  return {
    ...actual,
    productKeyCustody: (...args: Parameters<typeof actual.productKeyCustody>) => {
      startup.custodies += 1;
      return actual.productKeyCustody(...args);
    },
  };
});
vi.mock('../startup/mcp-startup.js', async (original) => ({
  ...(await original<typeof import('../startup/mcp-startup.js')>()),
  composeMcpClientForStartup: startup.compose,
}));
const { startCliCore } = await import('../cli-core.js');

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function started(argv: readonly string[]) {
  const home = mkdtempSync(join(tmpdir(), 'test-product-secure-compose-'));
  roots.push(home);
  mkdirSync(join(home, 'project'));
  vi.stubEnv('HOME', home);
  vi.spyOn(process, 'cwd').mockReturnValue(join(home, 'project'));
  const plain = createTestProductRuntime('test-product', { HOME: home });
  await enableSecureConversations(plain);
  const runtime = resolveSecureRuntime(plain);
  const previous = process.argv;
  process.argv = [
    'node',
    'test-product',
    ...argv,
    '--restricted-workspace',
    '--disable-update-check',
  ];
  startup.compose.mockReset();
  startup.custodies = 0;
  startup.compose.mockImplementation(() => {
    throw new Error('composition inspected');
  });
  try {
    const outcome = await startCliCore(
      {
        productRuntime: runtime,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted'),
      },
      testHost,
      () => [],
    ).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    return { runtime, outcome, composed: startup.compose.mock.calls.length };
  } finally {
    process.argv = previous;
  }
}

describe('the startup of the surfaces that run as their own process, in secure conversations', () => {
  it.each([
    ['print mode', ['-p', 'hello']],
    ['--goal', ['--goal', 'finish']],
    ['acp', ['acp']],
    ['MCP over stdio', ['mcp', 'serve']],
  ])(
    'gets %s past every store it builds on a locked key holder, and builds no unlock gate',
    async (_surface, argv) => {
      const { runtime, outcome, composed } = await started(argv);

      expect(outcome).toBe('composition inspected');
      expect(composed).toBe(1);
      const holder = productKeyHolder(runtime);
      expect(holder).toBeDefined();
      expect(holder?.isUnlocked).toBe(false);
      expect(startup.custodies).toBe(0);
    },
  );

  it.each([
    ['the terminal', []],
    ['a continued terminal session', ['--continue']],
  ])('gets %s past every store it builds on a locked key holder', async (_surface, argv) => {
    const { runtime, outcome, composed } = await started(argv);

    expect(outcome).toBe('composition inspected');
    expect(composed).toBe(1);
    const holder = productKeyHolder(runtime);
    expect(holder).toBeDefined();
    expect(holder?.isUnlocked).toBe(false);
  });
});
