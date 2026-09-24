import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';

describe('supervised background session command', () => {
  it('routes the cross-project view before shell startup and terminates on non-TTY input', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'rs-view-'));
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const handled = await runPreparsedCliCommand(
        {
          providerDefinitions: [],
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        },
        ['node', 'robota', 'session', 'view'],
        cwd,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toMatch(/TTY|session list/i);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a malformed stop target before looking for a control socket', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-supervised-stop-'));
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const handled = await runPreparsedCliCommand(
        {
          providerDefinitions: [],
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        },
        ['node', 'robota', 'session', 'stop', '../escape'],
        cwd,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toMatch(/invalid supervised session id/i);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses an untrusted project before starting a background session', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-supervised-route-'));
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const handled = await runPreparsedCliCommand(
        {
          providerDefinitions: [],
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        },
        ['node', 'robota', 'session', 'start', '--background'],
        cwd,
      );

      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toMatch(/trust|untrusted/i);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
