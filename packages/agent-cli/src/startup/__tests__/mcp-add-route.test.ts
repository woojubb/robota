import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * `test-product mcp add …` is routed before the strict global parser, writes the user's settings and
 * approval, and is listed in the command help beside `mcp serve`.
 */

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { WEB_SEARCH_MCP_CATALOG } from '../mcp-add-server.js';
import { runPreparsedCliCommand } from '../preparsed-command-routing.js';
import { printHelp, subcommandHelpFor } from '../../utils/cli-help.js';

const roots: string[] = [];
const exitCode = process.exitCode;
const originalTty = {
  stdin: Object.getOwnPropertyDescriptor(process.stdin, 'isTTY'),
  stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
};
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = exitCode;
  for (const stream of ['stdin', 'stdout'] as const) {
    const original = originalTty[stream];
    if (original === undefined) delete (process[stream] as { isTTY?: boolean }).isTTY;
    else Object.defineProperty(process[stream], 'isTTY', original);
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Run the routed command with stdin/stdout reporting `tty` (a person at the terminal, or not). */
async function routeWith(tty: boolean, ...args: string[]) {
  Object.defineProperty(process.stdin, 'isTTY', { value: tty, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: tty, configurable: true });
  return route(...args);
}

async function route(...args: string[]) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-mcp-add-route-')));
  roots.push(home);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  let out = '';
  let err = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((text) => ((err += String(text)), true));
  process.exitCode = undefined;
  const handled = await runPreparsedCliCommand(
    { productRuntime: runtime, providerDefinitions: [] },
    ['node', 'test-product', 'mcp', 'add', ...args],
    home,
  );
  return { handled, code: process.exitCode, out, err, runtime };
}

describe('test-product mcp add', () => {
  it('is handled by the pre-parse router: writes the entry and the approval, exits 0', async () => {
    const { handled, code, out, err, runtime } = await routeWith(true, 'exa');

    expect(handled).toBe(true);
    expect(code).toBe(0);
    expect(err).toBe('');
    expect(out).toContain('Added MCP server "exa"');
    expect(JSON.parse(readFileSync(runtime.layout.userPaths.settings, 'utf8'))).toEqual({
      mcpServers: { exa: { type: 'http', url: 'https://mcp.exa.ai/mcp' } },
    });
    expect(readFileSync(runtime.layout.userPaths.mcpApprovals, 'utf8')).toContain('"decision": "approved"');
  });

  it('takes <name> <https-url>', async () => {
    const { code, runtime } = await routeWith(true, 'mine', 'https://search.example.com/mcp');

    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(runtime.layout.userPaths.settings, 'utf8'))).toEqual({
      mcpServers: { mine: { type: 'http', url: 'https://search.example.com/mcp' } },
    });
  });

  it('exits 1 with the usage for an unknown bare name', async () => {
    const { handled, code, err } = await routeWith(true, 'unknown');

    expect(handled).toBe(true);
    expect(code).toBe(1);
    expect(err).toContain('Usage: test-product mcp add');
  });
});

describe('test-product mcp add without a person at the terminal', () => {
  it('refuses, names the command to run in a terminal, and writes nothing', async () => {
    const { handled, code, out, err, runtime } = await routeWith(false, 'exa');

    expect(handled).toBe(true);
    expect(code).toBe(1);
    expect(out).toBe('');
    expect(err).toContain('test-product mcp add exa');
    expect(existsSync(runtime.layout.userPaths.settings)).toBe(false);
    expect(existsSync(runtime.layout.userPaths.mcpApprovals)).toBe(false);
  });
});

describe('mcp add in the help', () => {
  it('is listed with every catalog service and in the mcp subcommand help', () => {
    const runtime = createTestProductRuntime();
    const help = printHelp(runtime);
    const entry = subcommandHelpFor(['mcp', 'add', '--help'], runtime) ?? '';

    for (const text of [help, entry]) {
      expect(text).toContain('test-product mcp add <');
      expect(text).toContain('test-product mcp add <name> <https-url>');
      for (const choice of WEB_SEARCH_MCP_CATALOG) expect(text).toContain(choice.id);
    }
    expect(entry).toContain('test-product mcp serve');
  });
});
