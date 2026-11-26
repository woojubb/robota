/**
 * `session list` in secure mode opens no saved conversation: the process is no conversation surface,
 * so it holds no key holder and no session store may be built for it. It reports the saved sessions
 * as sealed — in text and in json, where the flag keeps "sealed" apart from "none" — and still lists
 * the live processes and supervised sessions, which come from registrations. In plain mode the output
 * is what it always was.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode, productKeyHolder } from '../../product/session-sealing.js';
import { executeSessionListCommand, runSessionListCommand } from '../session-list-command.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const NO_PEERS = () => ({ status: 'available', peers: [] }) as const;
const SEALED =
  'Saved sessions are sealed in secure mode and are not listed here; run /unlock in the terminal, then /resume.';

/** A store that fails the test the moment anything reads it. */
function unreadableStore(): IInteractiveSessionStore {
  const fail = (): never => {
    throw new Error('a store was read');
  };
  return {
    save: fail,
    load: fail,
    list: fail,
    scan: fail,
    delete: fail,
  } as unknown as IInteractiveSessionStore;
}

const homes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestProductRuntimes();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe('the listing built without a session store', () => {
  it('says the saved sessions are sealed and lists nothing of them, whatever store it is handed', () => {
    const result = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: undefined,
      projectSessionStore: unreadableStore(),
      readPeers: NO_PEERS,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      [
        'Live processes (not linked to saved sessions):',
        '  (none)',
        'Saved sessions (not linked to live processes):',
        `  ${SEALED}`,
        '',
      ].join('\n'),
    );
  });

  it('marks the saved sessions of the json listing as sealed, apart from none', () => {
    const result = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: undefined,
      readPeers: NO_PEERS,
    });

    expect(JSON.parse(result.stdout)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      savedSealed: true,
    });
  });

  it('is not what a listing with a store says: no sealed flag, and none saved reads as none', () => {
    const empty = { save: vi.fn(), load: vi.fn(), list: () => [], delete: vi.fn() };
    const json = executeSessionListCommand(['--format', 'json'], {
      cliName: 'test-product',
      userSessionStore: empty as unknown as IInteractiveSessionStore,
      readPeers: NO_PEERS,
    });
    const text = executeSessionListCommand([], {
      cliName: 'test-product',
      userSessionStore: empty as unknown as IInteractiveSessionStore,
      readPeers: NO_PEERS,
    });

    expect(JSON.parse(json.stdout)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
    });
    expect(text.stdout).toContain('Saved sessions (not linked to live processes):\n  (none)');
    expect(text.stdout).not.toContain('sealed');
  });
});

describe('the command in secure mode', () => {
  function secureRuntime() {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'session-list-sealed-')));
    homes.push(home);
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    overrideProductSecureMode(runtime, true);
    return runtime;
  }

  it('builds no store and asks for no project store: the sealed note, the registrations, exit 0', async () => {
    const runtime = secureRuntime();
    const project = vi.fn(() => unreadableStore());
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runSessionListCommand([], runtime, project);

    expect(code).toBe(0);
    expect(project).not.toHaveBeenCalled();
    expect(productKeyHolder(runtime)).toBeUndefined();
    expect(out).toContain(`Saved sessions (not linked to live processes):\n  ${SEALED}`);
    expect(out).toContain(
      'Supervised sessions (owned, not linked to peers or saved records):\n  (none)',
    );
  });

  it('keeps the sealed flag in the json listing next to the registrations', async () => {
    const runtime = secureRuntime();
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runSessionListCommand(['--format', 'json'], runtime);

    expect(code).toBe(0);
    expect(JSON.parse(out)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      savedSealed: true,
      supervised: { status: 'available', sessions: [] },
    });
  });
});

describe('the command in plain mode', () => {
  it('asks for the project store and lists as before, with no sealed flag', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'session-list-plain-')));
    homes.push(home);
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const project = vi.fn(() => undefined);
    let out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((text) => ((out += String(text)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const code = await runSessionListCommand(['--format', 'json'], runtime, project);

    expect(code).toBe(0);
    expect(project).toHaveBeenCalledTimes(1);
    expect(JSON.parse(out)).toEqual({
      live: { status: 'available', processes: [] },
      saved: [],
      supervised: { status: 'available', sessions: [] },
    });
  });
});
