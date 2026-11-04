import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"); the file-backed halves
 * of the settings, contribution-root and transport-settings modules are on `./node`. The platform
 * gate bundles the main entry and fails on a Node reach; this pins which side each export is on, so
 * a move back is a visible test failure.
 */
describe('settings entry surfaces', () => {
  const nodeOnly = [
    'createNodeHostSettingsSource',
    'createNodeHostSettingsStore',
    'readSettings',
    'writeSettings',
    'updateModelInSettings',
    'deleteSettings',
    'resetUserConfig',
    'createNodeHostContributionSource',
    'createDefaultUserContributionSources',
    'createFileTransportSettingsRepository',
    'readPackageVersion',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  it('keeps the settings contracts, the project stores and the in-memory repository on the main entry', () => {
    for (const name of [
      'createWorkspaceProjectSettingsSources',
      'createWorkspaceProjectSettingsStore',
      'readSettingsSourceText',
      'inspectSettingsLayers',
      'createSettingsPermissionRulesAdapter',
      'applyStatusLineSettings',
      'applyAppearanceSettings',
      'createContributionSourcesForProjectAccess',
      'createMemoryTransportSettingsRepository',
      'TransportRegistry',
      'SettingsParseError',
      'NoCurrentProviderProfileError',
    ]) {
      expect(Object.keys(MainEntry)).toContain(name);
    }
  });
});
