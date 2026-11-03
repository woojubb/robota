import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { SECURE_USAGE } from '../secure-command.js';

let home: string;
const exitCode = process.exitCode;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-routing-')));
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = exitCode;
  rmSync(home, { recursive: true, force: true });
});

async function route(
  args: readonly string[],
): Promise<{ handled: boolean; out: string; err: string }> {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const runtime = createTestProductRuntime('test-product', { HOME: home });
  const handled = await runPreparsedCliCommand(
    { productRuntime: runtime, providerDefinitions: [] },
    ['node', 'test-product', ...args],
    // A directory that does not exist: the keyring belongs to the user, so nothing about the
    // workspace may be needed to run it.
    '/nonexistent-test-product-secure-cwd',
  );
  return {
    handled,
    out: stdout.mock.calls.flat().join(''),
    err: stderr.mock.calls.flat().join(''),
  };
}

describe('secure through the pre-parse router', () => {
  it('handles `secure status` before any workspace composition, with the user-owned keyring path', async () => {
    const { handled, out, err } = await route(['secure', 'status']);

    expect(handled).toBe(true);
    expect(process.exitCode).toBe(0);
    expect(out).toContain(
      `No keyring exists at ${join(home, '.test-product', 'secure', 'keyring.json')}`,
    );
    expect(err).toBe('');
  });

  it('handles an unknown secure subcommand with the usage and exit code 1', async () => {
    const { handled, err } = await route(['secure', 'unlock']);

    expect(handled).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(err).toBe(SECURE_USAGE('test-product'));
  });

  it('is not claimed by a command that merely starts with the same letters', async () => {
    // `secure` is matched exactly; a prompt that happens to begin with it is not the command.
    const { handled } = await route(['securely']);
    expect(handled).toBe(false);
  });
});
