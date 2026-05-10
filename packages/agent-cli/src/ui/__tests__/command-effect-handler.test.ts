import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCommandEffects } from '../hooks/command-effect-handler.js';

function createDeps() {
  return {
    addEntry: vi.fn(),
    requestShutdown: vi.fn(),
    requestModelChange: vi.fn(),
    openPluginTUI: vi.fn(),
    openSessionPicker: vi.fn(),
    renameSession: vi.fn(),
    applyStatusLinePatch: vi.fn(),
  };
}

describe('applyCommandEffects', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies session rename effects through the UI dependency boundary', () => {
    const deps = createDeps();

    const handled = applyCommandEffects([{ type: 'session-renamed', name: 'my-session' }], deps);

    expect(handled).toBe(true);
    expect(deps.renameSession).toHaveBeenCalledWith('my-session');
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });

  it('applies session picker effects through the UI dependency boundary', () => {
    const deps = createDeps();

    const handled = applyCommandEffects([{ type: 'session-picker-requested' }], deps);

    expect(handled).toBe(true);
    expect(deps.openSessionPicker).toHaveBeenCalledTimes(1);
    expect(deps.requestShutdown).not.toHaveBeenCalled();
  });

  it('deletes user settings and requests shutdown for settings reset effects', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-reset-effect-'));
    const settingsDir = join(home, '.robota');
    const settingsPath = join(settingsDir, 'settings.json');
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(settingsPath, '{}\n', 'utf8');
    vi.stubEnv('HOME', home);
    const deps = createDeps();

    const handled = applyCommandEffects([{ type: 'settings-reset-requested' }], deps);

    expect(handled).toBe(true);
    expect(existsSync(settingsPath)).toBe(false);
    expect(deps.addEntry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.addEntry.mock.calls[0])).toContain(`Deleted ${settingsPath}`);
    expect(deps.requestShutdown).toHaveBeenCalledWith('other', 'Reset settings restart');
  });

  it('reports no-op settings reset when no user settings file exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-reset-effect-missing-'));
    vi.stubEnv('HOME', home);
    const deps = createDeps();

    const handled = applyCommandEffects([{ type: 'settings-reset-requested' }], deps);

    expect(handled).toBe(true);
    expect(deps.addEntry).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(deps.addEntry.mock.calls[0])).toContain('No user settings found.');
    expect(deps.requestShutdown).toHaveBeenCalledWith('other', 'Reset settings restart');
  });
});
