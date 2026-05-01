import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyStatusLineSettings, readStatusLineSettings } from '../statusline-settings.js';

const TMP_BASE = join(tmpdir(), `robota-statusline-settings-test-${process.pid}`);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('statusline settings', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('returns default enabled settings when missing', () => {
    const settings = readStatusLineSettings({});

    expect(settings).toEqual({
      enabled: true,
      gitBranch: true,
    });
  });

  it('merges a patch into existing statusline settings', () => {
    const settingsPath = join(TMP_BASE, '.robota', 'settings.json');
    mkdirSync(join(TMP_BASE, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        language: 'ko',
        statusline: {
          enabled: true,
          gitBranch: true,
        },
      }),
      'utf8',
    );

    applyStatusLineSettings(settingsPath, { gitBranch: false });

    expect(readJson(settingsPath)).toEqual({
      language: 'ko',
      statusline: {
        enabled: true,
        gitBranch: false,
      },
    });
  });
});
