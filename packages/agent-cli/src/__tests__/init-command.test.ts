/**
 * CLI-041: init-command.test.ts
 * CLI-039 TC-02: malformed .claude/settings.json — no crash, warning emitted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock('@robota-sdk/agent-transport/headless', () => ({
  promptInput: vi.fn(),
}));

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promptInput } from '@robota-sdk/agent-transport/headless';
import { runInitCommand } from '../init/init-command.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedPromptInput = vi.mocked(promptInput);

function makeTerminal(): ITerminalOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    write: (msg: string) => lines.push(msg),
    writeLine: (msg: string) => lines.push(msg),
    writeMarkdown: (msg: string) => lines.push(msg),
    writeError: (msg: string) => lines.push(msg),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no files exist
  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue('');
  mockedMkdirSync.mockReturnValue(undefined as unknown as ReturnType<typeof mkdirSync>);
  mockedWriteFileSync.mockReturnValue(undefined);
  // Default answer "n" so no overwrite/migration prompts proceed
  mockedPromptInput.mockResolvedValue('n');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runInitCommand', () => {
  it('creates .robota/settings.json when it does not exist', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    const settingsWrite = mockedWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith('settings.json'),
    );
    expect(settingsWrite).toBeDefined();
  });

  it('creates AGENTS.md when it does not exist', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    const agentsWrite = mockedWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith('AGENTS.md'),
    );
    expect(agentsWrite).toBeDefined();
  });

  it('cancels init when both files exist and user answers no to overwrite', async () => {
    // Both settings.json and AGENTS.md exist
    mockedExistsSync.mockImplementation((p) => {
      const ps = String(p);
      return ps.endsWith('settings.json') || ps.endsWith('AGENTS.md');
    });
    mockedPromptInput.mockResolvedValue('n');
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
    const output = terminal.lines.join('\n');
    expect(output).toContain('cancelled');
  });

  it('detects .claude/ directory and prompts for migration', async () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith('.claude'));
    mockedPromptInput.mockResolvedValue('n'); // decline migration
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    const migrationPrompt = mockedPromptInput.mock.calls.find(([q]) =>
      String(q).toLowerCase().includes('migrate'),
    );
    expect(migrationPrompt).toBeDefined();
  });

  it('merges .claude/settings.json permissions when user agrees to migrate', async () => {
    mockedExistsSync.mockImplementation((p) => {
      const ps = String(p);
      return ps.endsWith('.claude') || ps.endsWith('settings.json');
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).includes('.claude') && String(p).endsWith('settings.json')) {
        return JSON.stringify({ permissions: { allow: ['Read(src/**)'], deny: [] } });
      }
      return '';
    });
    // Answer "y" to migration prompt only
    mockedPromptInput.mockResolvedValue('y');
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    const settingsCall = mockedWriteFileSync.mock.calls.find(
      ([p]) => String(p).endsWith('.robota/settings.json') || String(p).endsWith('settings.json'),
    );
    expect(settingsCall).toBeDefined();
    const written = JSON.parse(String(settingsCall![1])) as {
      permissions: { allow: string[]; deny: string[] };
    };
    // Merged: template allow list + claude allow list
    expect(written.permissions.allow).toContain('Read(src/**)');
    expect(written.permissions.allow).toContain('Read(.robota/**)');
    const output = terminal.lines.join('\n');
    expect(output).toContain('imported from .claude');
  });

  // CLI-039 TC-01: no crash on malformed JSON
  it('handles malformed .claude/settings.json gracefully (CLI-039 TC-01)', async () => {
    mockedExistsSync.mockImplementation((p) => {
      const ps = String(p);
      return ps.endsWith('.claude') || ps.endsWith('settings.json');
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).includes('.claude') && String(p).endsWith('settings.json')) {
        return '{not valid json}';
      }
      return '';
    });
    mockedPromptInput.mockResolvedValue('y'); // agree to migrate

    const terminal = makeTerminal();

    // Must not throw
    await expect(runInitCommand('/project', terminal)).resolves.toBeUndefined();

    // Initialization should still complete (writeFileSync called for settings.json)
    const settingsCall = mockedWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith('settings.json'),
    );
    expect(settingsCall).toBeDefined();
  });

  // CLI-039 TC-02: "could not be parsed" warning is emitted
  it('outputs "could not be parsed" warning when .claude/settings.json is malformed (CLI-039 TC-02)', async () => {
    mockedExistsSync.mockImplementation((p) => {
      const ps = String(p);
      return ps.endsWith('.claude') || ps.endsWith('settings.json');
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).includes('.claude') && String(p).endsWith('settings.json')) {
        return '{not valid json}';
      }
      return '';
    });
    mockedPromptInput.mockResolvedValue('y');

    const terminal = makeTerminal();
    await runInitCommand('/project', terminal);

    const output = terminal.lines.join('\n');
    expect(output).toContain('could not be parsed');
  });

  it('outputs initialization complete message on success', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();

    await runInitCommand('/project', terminal);

    const output = terminal.lines.join('\n');
    expect(output).toContain('complete');
  });

  // PM-033 TC-01: provider setup prompt is shown after init
  it('shows provider setup prompt after init completes (PM-033 TC-01)', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();
    const onProviderSetup = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);

    // Answer "n" to provider prompt so we just verify it was shown
    mockedPromptInput.mockResolvedValue('n');

    await runInitCommand('/project', terminal, { onProviderSetup });

    const promptCall = mockedPromptInput.mock.calls.find(([q]) =>
      String(q).toLowerCase().includes('provider'),
    );
    expect(promptCall).toBeDefined();
  });

  // PM-033 TC-02: Y answer calls onProviderSetup
  it('calls onProviderSetup when user answers Y (PM-033 TC-02)', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();
    const onProviderSetup = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);

    mockedPromptInput.mockResolvedValue('y');

    await runInitCommand('/project', terminal, { onProviderSetup });

    expect(onProviderSetup).toHaveBeenCalledOnce();
  });

  // PM-033 TC-03: CI=true skips the prompt
  it('skips provider setup prompt when CI=true (PM-033 TC-03)', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();
    const onProviderSetup = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);

    const originalCI = process.env['CI'];
    process.env['CI'] = 'true';

    try {
      await runInitCommand('/project', terminal, { onProviderSetup });
    } finally {
      if (originalCI === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = originalCI;
      }
    }

    expect(onProviderSetup).not.toHaveBeenCalled();
    // Ensure no provider-related prompt was issued
    const providerPrompt = mockedPromptInput.mock.calls.find(([q]) =>
      String(q).toLowerCase().includes('provider'),
    );
    expect(providerPrompt).toBeUndefined();
  });

  // PM-033 TC-04: --yes flag skips the prompt
  it('skips provider setup prompt when yes=true (PM-033 TC-04)', async () => {
    mockedExistsSync.mockReturnValue(false);
    const terminal = makeTerminal();
    const onProviderSetup = vi.fn<[], Promise<void>>().mockResolvedValue(undefined);

    await runInitCommand('/project', terminal, { yes: true, onProviderSetup });

    expect(onProviderSetup).not.toHaveBeenCalled();
    const providerPrompt = mockedPromptInput.mock.calls.find(([q]) =>
      String(q).toLowerCase().includes('provider'),
    );
    expect(providerPrompt).toBeUndefined();
  });
});
