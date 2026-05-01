import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleProviderCommand } from '../provider-command.js';

const TMP_BASE = join(tmpdir(), `robota-provider-command-test-${process.pid}`);

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

describe('provider command handler', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('lists current provider profiles from settings', async () => {
    const cwd = join(TMP_BASE, 'list');
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
      },
    });

    const result = await handleProviderCommand(cwd, 'list');

    expect(result.message).toContain('* openai');
    expect(result.message).toContain('anthropic');
  });

  it('returns providerSwitch data for use without writing settings', async () => {
    const cwd = join(TMP_BASE, 'use');
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
      },
    });

    const result = await handleProviderCommand(cwd, 'use openai');

    expect(result.data?.providerSwitch).toEqual({ profile: 'openai' });
    expect(result.message).toContain('Provider change requested');
  });

  it('reports probe failures as non-blocking provider test results', async () => {
    const cwd = join(TMP_BASE, 'test');
    writeJson(join(cwd, '.robota', 'settings.json'), {
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'supergemma4-26b-uncensored-v2',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    });
    const probe = vi.fn().mockResolvedValue({ ok: false, message: 'Connection failed' });

    const result = await handleProviderCommand(cwd, 'test openai', { probe });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Connection failed');
    expect(result.message).toContain('manual configuration can continue');
  });

  it('returns providerSetup data for add commands', async () => {
    const result = await handleProviderCommand(TMP_BASE, 'add openai');

    expect(result.success).toBe(true);
    expect(result.data?.providerSetup).toEqual({ type: 'openai' });
  });

  it('returns providerSetup data without a type when add command omits a provider type', async () => {
    const result = await handleProviderCommand(TMP_BASE, 'add');

    expect(result.success).toBe(true);
    expect(result.data?.providerSetup).toEqual({});
  });
});
