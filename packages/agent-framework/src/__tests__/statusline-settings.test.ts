import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import {
  applyStatusLineSettings,
  readStatusLineSettings,
} from '../command-api/statusline/statusline-command-api.js';
import { createNodeHostSettingsStore } from '../config/node-host-settings-store.js';

import type { ISettingsDocumentStore, TSettingsData } from '../config/settings-store-types.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'agent-statusline-settings-test-')));

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
    const settingsPath = join(TMP_BASE, '.agent', 'settings.json');
    mkdirSync(join(TMP_BASE, '.agent'), { recursive: true });
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

    applyStatusLineSettings(createNodeHostSettingsStore('user', settingsPath), {
      gitBranch: false,
    });

    expect(readJson(settingsPath)).toEqual({
      language: 'ko',
      statusline: {
        enabled: true,
        gitBranch: false,
      },
    });
  });

  it('applies a patch through a store that is not a file', () => {
    let document: TSettingsData = { language: 'ko' };
    const store: ISettingsDocumentStore = {
      kind: 'host',
      scope: 'user',
      displayName: 'memory',
      source: { kind: 'host', scope: 'user', displayName: 'memory', read: () => undefined },
      read: () => ({ ...document }),
      write: (next) => {
        document = next;
      },
    };

    const next = applyStatusLineSettings(store, { enabled: false });

    expect(next).toEqual({ enabled: false, gitBranch: true });
    expect(document).toEqual({ language: 'ko', statusline: { enabled: false, gitBranch: true } });
  });
});
