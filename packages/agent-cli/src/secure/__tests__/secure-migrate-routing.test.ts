/**
 * `secure migrate` and `secure compact` are a person's own commands: reached only from this process's
 * command line through the pre-parse router, never as a slash command or skill a model could run and
 * never through a transport; and a program the model starts through its shell, which has no terminal,
 * is turned away before anything is asked or written.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { SECURE_MODE_OFF } from '../secure-command.js';

let home: string;
const exitCode = process.exitCode;
const PACKAGES = fileURLToPath(new URL('../../../../', import.meta.url));

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-migrate-routing-')));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = exitCode;
  rmSync(home, { recursive: true, force: true });
});

async function route(
  args: readonly string[],
  secureMode: boolean,
): Promise<{ handled: boolean; out: string; err: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  overrideProductSecureMode(runtime, secureMode);
  const handled = await runPreparsedCliCommand(
    { productRuntime: runtime, providerDefinitions: [] },
    ['node', 'test-product', ...args],
    // A directory that does not exist: nothing about a workspace may be needed, or composed.
    '/nonexistent-test-product-secure-cwd',
  );
  return {
    handled,
    out: stdout.mock.calls.flat().join(''),
    err: stderr.mock.calls.flat().join(''),
  };
}

/** Every non-test TypeScript source under `packages/*\/src`, relative to the packages directory. */
function productSources(): string[] {
  const sources: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(path);
      } else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name)) {
        sources.push(relative(PACKAGES, path).split(sep).join('/'));
      }
    }
  };
  for (const name of readdirSync(PACKAGES)) {
    const src = join(PACKAGES, name, 'src');
    if (existsSync(src)) walk(src);
  }
  return sources;
}

function sourcesMatching(pattern: RegExp): string[] {
  return productSources().filter((path) =>
    pattern.test(readFileSync(join(PACKAGES, path), 'utf8')),
  );
}

describe('secure migrate and secure compact through the pre-parse router', () => {
  it.each([[['secure', 'migrate']], [['secure', 'migrate', '--dry-run']], [['secure', 'compact']]])(
    '%j is handled before any workspace composition and refuses while secure mode is off',
    async (args) => {
      const { handled, out, err } = await route(args, false);

      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(err).toBe(SECURE_MODE_OFF('test-product', args[1] as 'migrate' | 'compact'));
      expect(out).toBe('');
      expect(existsSync(join(home, '.test-product', 'presence'))).toBe(false);
    },
  );

  it.each([[['secure', 'migrate']], [['secure', 'compact']]])(
    '%j turns away a run with no terminal, as the shell a model starts has none, writing nothing',
    async (args) => {
      // The test runner's stdin is no terminal, as the shell a model starts has none.
      expect(process.stdin.isTTY).not.toBe(true);

      const { handled, err } = await route(args, true);

      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(err).toMatch(/needs an interactive terminal/u);
      expect(existsSync(join(home, '.test-product'))).toBe(false);
    },
  );
});

describe('secure migrate and secure compact are reachable from the command line only', () => {
  it('are dispatched by the secure command alone, which only the pre-parse router imports', () => {
    expect(
      sourcesMatching(/from '\.\/secure-migrate\.js'|from '\.\.\/secure\/secure-migrate\.js'/u),
    ).toEqual(['agent-cli/src/secure/secure-command.ts']);
    expect(sourcesMatching(/secure\/secure-command\.js'/u)).toEqual([
      'agent-cli/src/startup/preparsed-command-routing.ts',
    ]);
  });

  it('take their arguments from the process command line, through the one caller of the router', () => {
    const callers = sourcesMatching(/\brunPreparsedCliCommand\(/u).filter(
      (path) => path !== 'agent-cli/src/startup/preparsed-command-routing.ts',
    );
    expect(callers).toEqual(['agent-cli/src/cli-core.ts']);
    const core = readFileSync(join(PACKAGES, 'agent-cli/src/cli-core.ts'), 'utf8');
    expect(core).toMatch(/runPreparsedCliCommand\(\s*startupOptions,\s*process\.argv,/u);
  });

  it('are no slash command or skill of any package, so neither a model nor a transport can name them', () => {
    expect(sourcesMatching(/\bname:\s*['"](?:secure|secure-migrate|migrate)['"]/u)).toEqual([]);
    expect(sourcesMatching(/runSecureCommand|runSecureMigrate|runSecureCompact/u).sort()).toEqual([
      'agent-cli/src/secure/secure-command.ts',
      'agent-cli/src/secure/secure-migrate.ts',
      'agent-cli/src/startup/preparsed-command-routing.ts',
    ]);
  });
});
