import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createFileTransportSettingsRepository,
  createMemoryTransportSettingsRepository,
} from '../transport-settings-repository.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('transport settings repositories before STRUCT-012 S2 ownership move', () => {
  it('merges memory patches without dropping sibling transports or prior options', () => {
    const repository = createMemoryTransportSettingsRepository({
      first: { enabled: true, options: { port: 1000 } },
      second: { enabled: false },
    });
    repository.write('first', { enabled: false });
    expect(repository.readAll()).toEqual({
      first: { enabled: false, options: { port: 1000 } },
      second: { enabled: false },
    });
    const snapshot = repository.readAll();
    delete snapshot.second;
    expect(repository.readAll().second).toEqual({ enabled: false });
  });

  it('preserves unrelated file settings and sibling entries while normalizing the read projection', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'struct012-settings-'));
    temporaryDirectories.push(directory);
    const file = path.join(directory, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        language: 'ko',
        transports: {
          first: { enabled: true, options: { port: 1000 }, extra: 'retained' },
          malformed: null,
          wrongShape: { enabled: 'yes', options: [] },
        },
      }),
    );
    const repository = createFileTransportSettingsRepository(file);
    expect(repository.readAll()).toEqual({
      first: { enabled: true, options: { port: 1000 } },
      malformed: {},
      wrongShape: {},
    });
    repository.write('first', { enabled: false });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.language).toBe('ko');
    expect(saved.transports.first).toEqual({
      enabled: false,
      options: { port: 1000 },
      extra: 'retained',
    });
    expect(saved.transports.malformed).toBeNull();
  });
});
