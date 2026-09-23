import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { afterEach, expect, it } from 'vitest';

import { createDefaultTuiCliAdapter } from '../create-default-tui-cli-adapter.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('updates the host-selected settings file when changing the active model', () => {
  const root = mkdtempSync(join(tmpdir(), 'tui-host-settings-'));
  roots.push(root);
  const settingsPath = join(root, 'product-settings.json');
  writeFileSync(settingsPath, JSON.stringify({ currentProvider: 'custom', providers: { custom: {} } }));

  const adapter = createDefaultTuiCliAdapter({
    providerDefinitions: [],
    reloadPluginCommandSource: () => undefined,
    userSettingsPath: settingsPath,
    settingsSources: [createNodeHostSettingsSource('user', settingsPath)],
  });

  adapter.applyActiveModelChange(root, 'custom-model', {});

  expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({
    providers: { custom: { model: 'custom-model' } },
  });
});
