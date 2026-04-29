import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkSettingsFile } from '../settings-check.js';

const TMP_BASE = join(tmpdir(), `robota-settings-check-test-${process.pid}`);

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

describe('checkSettingsFile', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('returns missing when the file does not exist', () => {
    expect(checkSettingsFile(join(TMP_BASE, 'missing.json'))).toBe('missing');
  });

  it('returns incomplete for an empty file', () => {
    mkdirSync(TMP_BASE, { recursive: true });
    const path = join(TMP_BASE, 'settings.json');
    writeFileSync(path, '', 'utf8');

    expect(checkSettingsFile(path)).toBe('incomplete');
  });

  it('returns corrupt for invalid JSON', () => {
    mkdirSync(TMP_BASE, { recursive: true });
    const path = join(TMP_BASE, 'settings.json');
    writeFileSync(path, '{', 'utf8');

    expect(checkSettingsFile(path)).toBe('corrupt');
  });

  it('accepts legacy provider config with an apiKey', () => {
    mkdirSync(TMP_BASE, { recursive: true });
    const path = join(TMP_BASE, 'settings.json');
    writeJson(path, {
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: '$ENV:ANTHROPIC_API_KEY',
      },
    });

    expect(checkSettingsFile(path)).toBe('valid');
  });

  it('accepts an OpenAI-compatible profile without a real API key', () => {
    mkdirSync(TMP_BASE, { recursive: true });
    const path = join(TMP_BASE, 'settings.json');
    writeJson(path, {
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    });

    expect(checkSettingsFile(path)).toBe('valid');
  });

  it('returns incomplete when currentProvider points to a profile without usable provider data', () => {
    mkdirSync(TMP_BASE, { recursive: true });
    const path = join(TMP_BASE, 'settings.json');
    writeJson(path, {
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
        },
      },
    });

    expect(checkSettingsFile(path)).toBe('incomplete');
  });
});
