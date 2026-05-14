import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommandEffects } from '../hooks/command-effect-handler.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';

function readSettingsFile(path: string): Record<string, TUniversalValue> {
  if (!existsSync(path)) return {};
  try {
    // allow-fallback: test helper; corrupt settings return empty object
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, TUniversalValue>;
  } catch {
    // allow-fallback: test helper; corrupt settings return empty object
    return {};
  }
}

function writeSettingsFile(path: string, settings: Record<string, TUniversalValue>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function deleteSettingsFile(path: string): boolean {
  if (existsSync(path)) {
    unlinkSync(path);
    return true;
  }
  return false;
}

function createCliAdapter(settingsPath: string): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => settingsPath,
    readSettings: readSettingsFile,
    writeSettings: writeSettingsFile,
    deleteSettings: deleteSettingsFile,
    applyStatusLineSettings: vi.fn(),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  };
}

function createDeps(settingsPath: string) {
  return {
    addEntry: vi.fn(),
    requestShutdown: vi.fn(),
    requestModelChange: vi.fn(),
    openPluginTUI: vi.fn(),
    openTransportTUI: vi.fn(),
    openSessionPicker: vi.fn(),
    openAgentSwitcher: vi.fn(),
    renameSession: vi.fn(),
    applyStatusLinePatch: vi.fn(),
    cliAdapter: createCliAdapter(settingsPath),
  };
}

describe('applyCommandEffects', () => {
  let tempHome: string;
  let settingsPath: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    tempHome = mkdtempSync(join(tmpdir(), 'robota-effect-'));
    settingsPath = join(tempHome, '.robota', 'settings.json');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies session rename effects through the UI dependency boundary', () => {
    const deps = createDeps(settingsPath);

    const handled = applyCommandEffects([{ type: 'session-renamed', name: 'my-session' }], deps);

    expect(handled).toBe(true);
    expect(deps.renameSession).toHaveBeenCalledWith('my-session');
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });

  it('applies session picker effects through the UI dependency boundary', () => {
    const deps = createDeps(settingsPath);

    const handled = applyCommandEffects([{ type: 'session-picker-requested' }], deps);

    expect(handled).toBe(true);
    expect(deps.openSessionPicker).toHaveBeenCalledTimes(1);
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });

  it('deletes user settings and requests shutdown for settings reset effects', () => {
    const settingsDir = join(tempHome, '.robota');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(settingsPath, '{}\n', 'utf8');
    const deps = createDeps(settingsPath);

    const handled = applyCommandEffects([{ type: 'settings-reset-requested' }], deps);

    expect(handled).toBe(true);
    expect(existsSync(settingsPath)).toBe(false);
    expect(deps.addEntry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.addEntry.mock.calls[0])).toContain(`Deleted ${settingsPath}`);
    expect(deps.requestShutdown).toHaveBeenCalledWith('other', 'Reset settings restart');
  });

  it('reports no-op settings reset when no user settings file exists', () => {
    const deps = createDeps(settingsPath);

    const handled = applyCommandEffects([{ type: 'settings-reset-requested' }], deps);

    expect(handled).toBe(true);
    expect(deps.addEntry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.addEntry.mock.calls[0])).toContain('No user settings found.');
    expect(deps.requestShutdown).toHaveBeenCalledWith('other', 'Reset settings restart');
  });
});
