import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

import { runPreparsedCliCommand } from '../../startup/preparsed-command-routing.js';
import { executeSessionListCommand, readLocalPeersForInventory, runSessionListCommand } from '../session-list-command.js';
import {
  linkSupervisedPr, parseSupervisedPr, resolveSupervisedDirectory, startSupervisedControl,
} from '../supervised-session-control.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  ISessionListEntry,
} from '@robota-sdk/agent-interface-session';

function store(entries: readonly ISessionListEntry[]): IInteractiveSessionStore {
  return {
    list: () => entries,
    load: () => ({ status: 'missing' }),
    save: () => undefined,
    delete: () => undefined,
  };
}

function valid(id: string): ISessionListEntry {
  const record: IInteractiveSessionRecord = {
    id,
    cwd: '/private/project',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    messages: [
      {
        id: 'private-message',
        role: 'user',
        content: 'PRIVATE PROMPT',
        timestamp: new Date(),
        state: 'complete',
      },
    ],
    history: [],
  };
  return { id, outcome: { status: 'valid', record } };
}

describe('read-only local session inventory', () => {
  it('shows verified supervised activity in both list formats without exposing session content', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rs-'));
    const previousHome = process.env['HOME'];
    const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const id = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';
    let pr = parseSupervisedPr('https://github.com/team/repo/pull/123');
    let control: Awaited<ReturnType<typeof startSupervisedControl>> | undefined;
    try {
      process.env['HOME'] = home;
      process.env['XDG_RUNTIME_DIR'] = home;
      control = await startSupervisedControl(
        id, () => undefined, resolveSupervisedDirectory(), () => 'needs-input',
        undefined, undefined, () => 'Private session name',
        undefined, { get: () => pr, set: (value) => { pr = value; } },
      );
      await linkSupervisedPr(id, 'https://github.com/team/repo/pull/456');
      expect(await runSessionListCommand(['--format', 'text'])).toBe(0);
      const text = output.mock.calls.map(([value]) => String(value)).join('');
      expect(text).toContain(`${id}  liveness alive  control available  activity needs-input`);
      expect(text).not.toContain('Private session name');
      expect(text).not.toContain('github.com');
      expect(text).not.toMatch(/prompt|token|transcript/i);
      output.mockClear();
      expect(await runSessionListCommand(['--format', 'json'])).toBe(0);
      const json = output.mock.calls.map(([value]) => String(value)).join('');
      expect(JSON.parse(json).supervised.sessions).toEqual([
        { id, liveness: 'alive', control: 'available', activity: 'needs-input' },
      ]);
      expect(json).not.toContain('Private session name');
      expect(json).not.toContain('github.com');
      expect(json).not.toMatch(/prompt|token|transcript/i);
    } finally {
      await control?.close();
      output.mockRestore();
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      if (previousRuntimeDirectory === undefined) delete process.env['XDG_RUNTIME_DIR'];
      else process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps live peers separate from saved records and hides transcript content', () => {
    const result = executeSessionListCommand(['--format', 'json'], {
      userSessionStore: store([
        valid('same-id'),
        valid('user-only'),
        { id: 'broken', outcome: { status: 'corrupt', issues: [] } },
        { id: 'future', outcome: { status: 'unsupported', schemaVersion: 99 } },
      ]),
      projectSessionStore: store([
        valid('same-id'),
        { id: 'user-only', outcome: { status: 'missing' } },
      ]),
      readPeers: () => ({
        status: 'available',
        peers: [
          { sessionId: 'same-id', liveness: 'alive', status: 'working' },
          { sessionId: 'uncertain', liveness: 'unknown', status: 'unknown' },
          { sessionId: 'gone', liveness: 'dead', status: 'unknown' },
        ],
      }),
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.live.processes).toEqual([
      { id: 'same-id', liveness: 'alive', activity: 'working' },
      { id: 'uncertain', liveness: 'unknown', activity: 'unknown' },
    ]);
    expect(parsed.saved).toEqual([
      { id: 'broken', availability: 'corrupt', source: 'user' },
      { id: 'future', availability: 'unsupported', source: 'user' },
      { id: 'same-id', availability: 'valid', source: 'project' },
      { id: 'user-only', availability: 'valid', source: 'user' },
    ]);
    expect(result.stdout).not.toMatch(/PRIVATE PROMPT|private\/project|messages/);
  });

  it('makes unavailable peer discovery visible without hiding saved sessions', () => {
    const result = executeSessionListCommand([], {
      userSessionStore: store([valid('saved')]),
      readPeers: () => ({ status: 'unavailable' }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/Live processes.*unavailable/s);
    expect(result.stdout).toContain('saved');
    expect(result.stderr).toMatch(/peer discovery is unavailable/i);
  });

  it('rejects invalid flags before touching stores or peer discovery', () => {
    const list = vi.fn(() => []);
    const readPeers = vi.fn(() => ({ status: 'available' as const, peers: [] }));
    const result = executeSessionListCommand(['--format', 'yaml'], {
      userSessionStore: { ...store([]), list },
      readPeers,
    });
    expect(result.exitCode).toBe(1);
    expect(list).not.toHaveBeenCalled();
    expect(readPeers).not.toHaveBeenCalled();
  });

  it('does not create a missing peer directory or read an unsafe or linked one', () => {
    const root = mkdtempSync(join(tmpdir(), 'robota-session-list-'));
    try {
      const absent = join(root, 'absent');
      expect(readLocalPeersForInventory(absent)).toEqual({ status: 'available', peers: [] });
      expect(existsSync(absent)).toBe(false);

      const unsafe = join(root, 'unsafe');
      mkdirSync(unsafe);
      chmodSync(unsafe, 0o755);
      expect(readLocalPeersForInventory(unsafe)).toEqual({ status: 'unavailable' });

      const linked = join(root, 'linked');
      symlinkSync(root, linked);
      expect(readLocalPeersForInventory(linked)).toEqual({ status: 'unavailable' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('routes session list before the interactive shell is assembled', async () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-session-list-route-'));
    const previousHome = process.env['HOME'];
    const previousRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
    const previousExit = process.exitCode;
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      process.env['HOME'] = home;
      process.env['XDG_RUNTIME_DIR'] = join(home, 'runtime');
      const handled = await runPreparsedCliCommand(
        {
          providerDefinitions: [],
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
        },
        ['node', 'robota', 'session', 'list', '--format', 'json'],
        home,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(0);
      const text = output.mock.calls.map(([value]) => String(value)).join('');
      expect(JSON.parse(text)).toEqual({
        live: { status: 'available', processes: [] },
        saved: [],
        supervised: { status: 'available', sessions: [] },
      });
    } finally {
      output.mockRestore();
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      if (previousRuntimeDirectory === undefined) delete process.env['XDG_RUNTIME_DIR'];
      else process.env['XDG_RUNTIME_DIR'] = previousRuntimeDirectory;
      process.exitCode = previousExit;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
