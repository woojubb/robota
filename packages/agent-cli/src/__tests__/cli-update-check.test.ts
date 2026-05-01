import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startCli } from '../cli.js';

const TMP_BASE = join(tmpdir(), `robota-cli-update-check-test-${process.pid}`);
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe('CLI update check command', () => {
  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('checks npm metadata and prints the npm global install command without writing settings', async () => {
    const home = join(TMP_BASE, 'home');
    process.env.HOME = home;
    process.argv = ['node', 'robota', '--check-update'];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ 'dist-tags': { latest: '999.0.0-test.0' } }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await startCli();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(stdout.mock.calls.join('\n')).toContain("npm install -g '@robota-sdk/agent-cli@latest'");
    expect(stderr).not.toHaveBeenCalled();
    expect(existsSync(join(home, '.robota', 'settings.json'))).toBe(false);
    expect(existsSync(join(home, '.robota', 'update-check.json'))).toBe(true);
  });
});
