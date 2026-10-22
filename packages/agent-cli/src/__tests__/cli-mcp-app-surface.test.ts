/**
 * Which invocations the CLI tells the MCP composition can host an app view: only the plain `--serve`
 * host. The composition is stubbed to throw once it has been handed its input, so what is inspected
 * is exactly what `startCliCore` derived from the command line.
 */
import { createTestProductRuntime } from './helpers/product-runtime.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

async function composedWith(argv: readonly string[]): Promise<{
  readonly mode: string;
  readonly appSurface: boolean | undefined;
}> {
  const home = mkdtempSync(join(tmpdir(), 'test-product-cli-app-surface-'));
  roots.push(home);
  mkdirSync(join(home, 'project'));
  vi.stubEnv('HOME', home);
  vi.spyOn(process, 'cwd').mockReturnValue(join(home, 'project'));
  const previous = process.argv;
  process.argv = ['node', 'test-product', ...argv, '--restricted-workspace', '--disable-update-check'];
  startup.compose.mockReset();
  startup.compose.mockImplementation(() => {
    throw new Error('composition inspected');
  });
  try {
    await expect(
      startCliCore(
        {
          productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted'),
        },
        () => [],
      ),
    ).rejects.toThrow('composition inspected');
  } finally {
    process.argv = previous;
  }
  expect(startup.compose).toHaveBeenCalledOnce();
  const input = startup.compose.mock.calls[0]?.[0] as { mode: string; appSurface?: boolean };
  return { mode: input.mode, appSurface: input.appSurface };
}

describe('the MCP app surface the CLI reports', () => {
  it('is the plain serve host, which the desktop app and web GUI drive', async () => {
    expect(await composedWith(['--serve'])).toEqual({ mode: 'serve', appSurface: true });
  });

  it('is not a print run', async () => {
    expect(await composedWith(['-p', 'hello'])).toEqual({ mode: 'print', appSurface: false });
  });

  it('is not the interactive terminal', async () => {
    expect(await composedWith([])).toEqual({ mode: 'interactive', appSurface: false });
  });

  it('is neither Robota served as an MCP server nor the ACP editor agent', async () => {
    expect(await composedWith(['mcp', 'serve'])).toEqual({ mode: 'serve', appSurface: false });
    expect(await composedWith(['acp'])).toEqual({ mode: 'serve', appSurface: false });
  });
});
