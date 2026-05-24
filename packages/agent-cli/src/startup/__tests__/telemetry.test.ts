/**
 * PM-030: unit tests for opt-in telemetry system.
 *
 * Strategy: vi.mock('node:os') to make homedir() return a tmp directory,
 * so telemetry.ts reads/writes settings.json in an isolated location.
 * vi.mock is hoisted to the top of the file by vitest, so it runs before any imports.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';

const TMP_HOME = join(tmpdir(), `robota-telemetry-test-${process.pid}`);

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => TMP_HOME,
  };
});

// Import AFTER vi.mock so the mocked homedir is in effect.
import { isTelemetryEnabled, setTelemetryEnabled, sendTelemetryEvent } from '../telemetry.js';

function settingsPath(): string {
  return join(TMP_HOME, '.robota', 'settings.json');
}

function readSettings(): Record<string, unknown> {
  const p = settingsPath();
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

function writeSettings(data: unknown): void {
  const dir = join(TMP_HOME, '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2) + '\n');
}

beforeAll(() => {
  mkdirSync(join(TMP_HOME, '.robota'), { recursive: true });
});

afterAll(() => {
  rmSync(TMP_HOME, { recursive: true, force: true });
});

describe('PM-030: telemetry module', () => {
  // TC-02: opt-out (N/false) → settings.json saved with telemetry: false, no event
  it('TC-02: setTelemetryEnabled(false) saves telemetry: false to settings.json', () => {
    setTelemetryEnabled(false);

    const settings = readSettings();
    expect(settings['telemetry']).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  // TC-03: opt-in (Y/true) → settings.json saved with telemetry: true
  it('TC-03: setTelemetryEnabled(true) saves telemetry: true; sendTelemetryEvent does not throw', () => {
    setTelemetryEnabled(true);

    const settings = readSettings();
    expect(settings['telemetry']).toBe(true);
    expect(isTelemetryEnabled()).toBe(true);

    expect(() => sendTelemetryEvent('session_start')).not.toThrow();
  });

  // TC-04: when telemetry is disabled, sendTelemetryEvent is a no-op
  it('TC-04: sendTelemetryEvent is a no-op when telemetry is disabled', () => {
    setTelemetryEnabled(false);

    expect(() => sendTelemetryEvent('session_start')).not.toThrow();
  });

  it('isTelemetryEnabled returns false when settings.json does not exist', () => {
    // Remove the settings file
    const p = settingsPath();
    if (existsSync(p)) rmSync(p);

    expect(isTelemetryEnabled()).toBe(false);

    // Restore dir for subsequent tests
    mkdirSync(join(TMP_HOME, '.robota'), { recursive: true });
  });

  it('isTelemetryEnabled returns false when settings.json is corrupt', () => {
    writeFileSync(settingsPath(), 'NOT VALID JSON');

    expect(isTelemetryEnabled()).toBe(false);
  });

  it('setTelemetryEnabled preserves existing settings keys', () => {
    writeSettings({ currentProvider: 'anthropic', telemetry: false });

    setTelemetryEnabled(true);

    const settings = readSettings();
    expect(settings['currentProvider']).toBe('anthropic');
    expect(settings['telemetry']).toBe(true);
  });
});

describe('PM-030: promptTelemetryOptIn', () => {
  // Each test must reset modules so vi.doMock is re-applied with fresh imports.
  // vi.doMock only takes effect on the NEXT dynamic import of that module.

  // TC-01: first run → promptInput is called with a consent message
  it('TC-01: promptTelemetryOptIn calls promptInput to display the telemetry consent prompt', async () => {
    vi.resetModules();
    const mockPromptInput = vi.fn().mockResolvedValue('n');
    vi.doMock('@robota-sdk/agent-transport/headless', () => ({
      promptInput: mockPromptInput,
      PrintTerminal: vi.fn(),
    }));

    const { promptTelemetryOptIn } = await import('../first-run.js');
    await promptTelemetryOptIn();

    expect(mockPromptInput).toHaveBeenCalledOnce();
    const prompt = mockPromptInput.mock.calls[0][0] as string;
    expect(prompt.toLowerCase()).toMatch(/telemetry|usage|anonymous/);
  });

  // TC-02: answering N → settings.json has telemetry: false
  it('TC-02: answering N sets telemetry: false in settings.json', async () => {
    vi.resetModules();
    vi.doMock('@robota-sdk/agent-transport/headless', () => ({
      promptInput: vi.fn().mockResolvedValue('n'),
      PrintTerminal: vi.fn(),
    }));

    const { promptTelemetryOptIn } = await import('../first-run.js');
    await promptTelemetryOptIn();

    const settings = readSettings();
    expect(settings['telemetry']).toBe(false);
  });

  // TC-03: answering Y → settings.json has telemetry: true
  it('TC-03: answering Y sets telemetry: true in settings.json', async () => {
    vi.resetModules();
    vi.doMock('@robota-sdk/agent-transport/headless', () => ({
      promptInput: vi.fn().mockResolvedValue('y'),
      PrintTerminal: vi.fn(),
    }));

    const { promptTelemetryOptIn } = await import('../first-run.js');
    await promptTelemetryOptIn();

    const settings = readSettings();
    expect(settings['telemetry']).toBe(true);
  });
});
