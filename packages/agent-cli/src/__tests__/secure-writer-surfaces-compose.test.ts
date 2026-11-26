/**
 * The startup of print mode, `acp` and `mcp serve` over stdio in secure conversations, stopped where
 * the MCP client is composed, which is after every workspace composition that builds a session
 * store: each got past them on a locked key holder, which no read key or unlock reaches, and the
 * terminal started the same way is still refused before it gets that far.
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

const startup = vi.hoisted(() => ({ compose: vi.fn() }));
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

describe('the startup of the surfaces that only write what they seal, in secure conversations', () => {
  it.each([
    ['print mode', ['-p', 'hello']],
    ['--goal', ['--goal', 'finish']],
    ['acp', ['acp']],
    ['MCP over stdio', ['mcp', 'serve']],
  ])('gets %s past every store it builds on a locked key holder', async (_surface, argv) => {
    const { runtime, outcome, composed } = await started(argv);

    expect(outcome).toBe('composition inspected');
    expect(composed).toBe(1);
    const holder = productKeyHolder(runtime);
    expect(holder).toBeDefined();
    expect(holder?.isUnlocked).toBe(false);
  });

  it('still refuses the terminal before the MCP client is composed, with no holder', async () => {
    const { runtime, outcome, composed } = await started([]);

    expect(outcome).toBe(
      'Secure conversation sealing key holder is unavailable; no conversation store may open.',
    );
    expect(composed).toBe(0);
    expect(productKeyHolder(runtime)).toBeUndefined();
  });
});
