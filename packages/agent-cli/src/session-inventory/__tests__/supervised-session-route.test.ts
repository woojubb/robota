import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('refuses an invalid grant file before starting anything, naming no configured value', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-supervised-grant-'));
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const file = join(cwd, 'grant.json');
      writeFileSync(file, JSON.stringify({
        grantId: 'ci', issuer: 'http://issuer.example', resource: 'https://robota.example/events/ci',
        client: 'ci-bot', scopes: ['robota.events.submit'],
      }));
      const handled = await runPreparsedCliCommand(
        { providerDefinitions: [], projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd) },
        ['node', 'robota', 'session', 'start', '--background', '--external-event-grant', file],
        cwd,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1);
      const written = stderr.mock.calls.map(([text]) => String(text)).join('');
      expect(written).toBe('grant ci: invalid issuer\n');
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('shows usage for a malformed events command and refuses a malformed session id', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-supervised-events-'));
    const previousExitCode = process.exitCode;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const options = {
      providerDefinitions: [],
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
    };
    try {
      for (const argv of [['session', 'events'], ['session', 'events', 'list'], ['session', 'events', 'revoke', 'x']]) {
        process.exitCode = 0;
        expect(await runPreparsedCliCommand(options, ['node', 'robota', ...argv], cwd)).toBe(true);
        expect(process.exitCode).toBe(1);
      }
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toMatch(
        /Usage: robota session events list <supervised-id> \[--json\]/,
      );
      stderr.mockClear();
      await runPreparsedCliCommand(options, ['node', 'robota', 'session', 'events', 'revoke', '../escape', 'ci'], cwd);
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
      stderr.mockClear();
      const named = await runPreparsedCliCommand(
        {
          providerDefinitions: [],
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        },
        ['node', 'robota', 'session', 'start', '--background', '--name', 'Morning review'],
        cwd,
      );
      expect(named).toBe(true);
      expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toMatch(/trust|untrusted/i);
    } finally {
      stderr.mockRestore();
      process.exitCode = previousExitCode;
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
