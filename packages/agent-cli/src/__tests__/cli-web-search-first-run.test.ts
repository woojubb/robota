import { createTestProductRuntime } from './helpers/product-runtime.js';
/**
 * The CLI asks about a web search MCP server on a first interactive start only, and asks BEFORE the
 * start composes MCP: definitions are resolved once, so a server chosen after that could not connect
 * in the same session. The step and the composition are both replaced here; what is asserted is what
 * the CLI hands the step and the order it calls the two in.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

import type { ICliPresentation } from '../cli-core.js';

const testHost = createTestFrameworkHost();

const calls = vi.hoisted(() => ({
  order: [] as string[],
  offers: [] as Record<string, unknown>[],
}));
vi.mock('../startup/first-run-web-search.js', () => ({
  offerWebSearchMcpServer: vi.fn(async (input: Record<string, unknown>) => {
    calls.order.push('offer');
    calls.offers.push(input);
  }),
}));
vi.mock('../startup/mcp-startup.js', async (original) => ({
  ...(await original<typeof import('../startup/mcp-startup.js')>()),
  composeMcpClientForStartup: vi.fn(async () => {
    calls.order.push('compose');
    throw new Error('composition inspected');
  }),
}));
const { startCliCore } = await import('../cli-core.js');

const roots: string[] = [];
const argv = process.argv;
const ttyDescriptors = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
};
function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}
afterEach(() => {
  process.argv = argv;
  for (const stream of ['stdin', 'stdout'] as const) {
    const original = ttyDescriptors[stream];
    if (original === undefined) delete (process[stream] as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process[stream], 'isTTY', original);
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  calls.order.length = 0;
  calls.offers.length = 0;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The factories are never reached: the composition is replaced and stops the start. */
const presentation = {
  createThemeSurface: () => ({ skipped: [], cataloguePort: undefined }),
  createNodeKeybindingsSource: () => ({}),
} as unknown as ICliPresentation;

async function start(
  args: string[],
  options: { tty: boolean; onboarded?: boolean; presentation?: ICliPresentation },
): Promise<Record<string, unknown> | undefined> {
  const home = mkdtempSync(join(tmpdir(), 'test-product-cli-search-first-run-'));
  roots.push(home);
  mkdirSync(join(home, 'project'));
  if (options.onboarded === true) {
    mkdirSync(join(home, '.test-product'), { recursive: true });
    writeFileSync(join(home, '.test-product', 'onboarded'), new Date().toISOString());
  }
  vi.stubEnv('HOME', home);
  vi.spyOn(process, 'cwd').mockReturnValue(join(home, 'project'));
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  setTty(options.tty);
  process.argv = ['node', 'test-product', ...args, '--restricted-workspace', '--disable-update-check'];
  await expect(
    startCliCore(
      {
        productRuntime: createTestProductRuntime('test-product', { HOME: home }),
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted'),
      },
      testHost,
      () => [],
      options.presentation,
    ),
  ).rejects.toThrow('composition inspected');
  return calls.offers[0];
}

describe('CLI first-start web search step', () => {
  it('runs before MCP is composed, on a first interactive terminal start', async () => {
    const offer = await start([], { tty: true, presentation });

    expect(calls.order).toEqual(['offer', 'compose']);
    expect(offer).toMatchObject({ firstRun: true, interactive: true });
  });

  it('hands the step the settings sources, approval store and environment startup uses', async () => {
    const offer = await start([], { tty: true, presentation });

    expect(offer).toMatchObject({
      terminal: expect.anything(),
      settingsSources: expect.any(Array),
      approvalStore: expect.objectContaining({ list: expect.any(Function) }),
      env: expect.any(Object),
    });
  });

  // Each mode runs on a terminal WITH a TUI presentation, as `cli.ts` passes one, so only the mode
  // check can make it non-interactive.
  it.each([
    ['print mode', ['-p', 'hello']],
    ['goal mode', ['--goal', 'ship it']],
    ['serve mode', ['--serve']],
    ['mcp serve', ['mcp', 'serve']],
    ['ACP', ['acp']],
  ])('is not interactive for %s', async (_label, args) => {
    const offer = await start(args, { tty: true, presentation });

    expect(offer).toMatchObject({ interactive: false });
    expect(calls.order).toEqual(['offer', 'compose']);
  });

  it('is not interactive for a terminal start with no TUI presentation', async () => {
    const offer = await start([], { tty: true });

    expect(offer).toMatchObject({ interactive: false });
  });

  it('is not interactive without a terminal', async () => {
    const offer = await start([], { tty: false, presentation });

    expect(offer).toMatchObject({ interactive: false });
  });

  it('is not a first run once the welcome marker exists', async () => {
    const offer = await start([], { tty: true, onboarded: true, presentation });

    expect(offer).toMatchObject({ firstRun: false });
  });
});
