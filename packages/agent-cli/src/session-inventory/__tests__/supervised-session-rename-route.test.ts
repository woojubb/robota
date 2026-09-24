import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { renameSupervisedSession } from '../supervised-session-control.js';

vi.mock('../supervised-session-control.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../supervised-session-control.js')>(),
  renameSupervisedSession: vi.fn(),
}));

const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

describe('supervised session rename command', () => {
  it('routes an owned rename before unrelated workspace startup and rejects malformed names', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rs-rename-route-'));
    const previousExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const options = {
      providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    };
    vi.mocked(renameSupervisedSession).mockResolvedValue(undefined);
    try {
      expect(await runPreparsedCliCommand(
        options, ['node', 'robota', 'session', 'rename', ID, 'Evening review'], cwd,
      )).toBe(true);
      expect(process.exitCode).toBe(0);
      expect(renameSupervisedSession).toHaveBeenCalledExactlyOnceWith(ID, 'Evening review');
      expect(await runPreparsedCliCommand(
        options, ['node', 'robota', 'session', 'rename', ID, 'bad\nname'], cwd,
      )).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(renameSupervisedSession).toHaveBeenCalledTimes(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).not.toContain('bad\nname');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      vi.clearAllMocks();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
