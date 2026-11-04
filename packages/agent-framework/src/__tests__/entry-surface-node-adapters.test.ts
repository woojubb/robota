/**
 * The main entry takes the file system as a parameter and names no Node adapter; `./node` exports
 * the adapters a Node composition root passes. The names the bundled workflows package imports stay
 * on the main entry.
 */

import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/** The names `@robota-sdk/workflows` imports from `@robota-sdk/agent-framework`. */
const WORKFLOWS_IMPORTS = [
  'ProviderConfigError',
  'WorkspaceAuthorityRequiredError',
  'assertWorkspaceProjectAuthority',
  'assertWorkspaceProjectMutationForAuthority',
  'createProviderFromSettings',
  'getWorkspaceProjectIdentity',
  'getWorkspaceProjectReader',
  'readCommandPermissionMode',
  'readProviderSettings',
  'createSkillExecutionPort',
] as const;

describe('the Node adapters of the plugin, user-local, provider and org-policy modules', () => {
  const NODE_ONLY = [
    'NodeFileSystem',
    'NodeFileSystemAsync',
    'loadOrgPolicy',
    'checkNodeHostSettingsFile',
  ] as const;

  it('are exported from ./node and not from the main entry', () => {
    for (const name of NODE_ONLY) {
      expect(Object.keys(NodeEntry), name).toContain(name);
      expect(Object.keys(MainEntry), name).not.toContain(name);
    }
  });

  it('leave their neutral halves on the main entry', () => {
    for (const name of [
      'formatOrgPolicyViolationMessage',
      'isApiKeyPlaintext',
      'checkSettingsDocument',
      'resolveProviderEnvironment',
      'BundlePluginLoader',
      'BundlePluginInstaller',
      'MarketplaceClient',
      'NodeHostPluginSettingsStore',
      'inspectUserLocalStorage',
      'listUserLocalMemoryItems',
    ]) {
      expect(typeof (MainEntry as Record<string, unknown>)[name], name).toBe('function');
    }
  });
});

describe('the names the bundled workflows package imports', () => {
  it.each(WORKFLOWS_IMPORTS)('%s is still on the main entry', (name) => {
    expect(typeof (MainEntry as Record<string, unknown>)[name]).toBe('function');
  });
});
