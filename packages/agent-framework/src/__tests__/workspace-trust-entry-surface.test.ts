import { describe, expect, it } from 'vitest';

import * as MainEntry from '../index.js';
import * as NodeEntry from '../node.js';

/**
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"): workspace trust there is
 * the service, the authority brand and the facets minted from it, all of which take the host's file
 * operations as `projectFiles`. What touches a Node file system or process is on `./node`. The
 * platform gate bundles the main entry and fails on a Node reach; this pins which side each export
 * is on, so a move back is a visible test failure.
 */
describe('workspace trust entry surfaces', () => {
  const nodeOnly = [
    'createNodeWorkspaceIdentityResolver',
    'createNodeWorkspaceTrustService',
    'createNodeWorkspaceTrustStore',
    'createNodeWorkspaceProjectFiles',
    'inspectPreTrustProjectPaths',
    'supportsWorkspaceProjectMutation',
  ];

  it.each(nodeOnly)('%s is on ./node and not on the main entry', (name) => {
    expect(Object.keys(NodeEntry)).toContain(name);
    expect(Object.keys(MainEntry)).not.toContain(name);
  });

  /** The names the bundled `@robota-sdk/workflows` 0.0.3 imports from the main entry. */
  const bundledWorkflowsNames = [
    'WorkspaceAuthorityRequiredError',
    'assertWorkspaceProjectAuthority',
    'assertWorkspaceProjectMutationForAuthority',
    'getWorkspaceProjectIdentity',
    'getWorkspaceProjectReader',
  ];

  it.each([
    ...bundledWorkflowsNames,
    'WorkspaceTrustService',
    'createRestrictedWorkspaceProjectAccess',
    'assertWorkspaceProjectReader',
    'assertWorkspaceProjectMutation',
    'assertWorkspaceProjectStateStorage',
    'assertWorkspaceProjectSettingsWriter',
    'createWorkspaceProjectMutation',
    'createWorkspaceProjectSettingsWriter',
    'getWorkspaceProjectStateStorage',
    'prepareWorkflowJsonMutation',
  ])('%s stays on the main entry', (name) => {
    expect(Object.keys(MainEntry)).toContain(name);
    expect(Object.keys(NodeEntry)).not.toContain(name);
  });

  it('keeps the issuer and the facet factories on no entry', () => {
    for (const entry of [MainEntry, NodeEntry]) {
      for (const name of [
        'mintWorkspaceProjectAuthority',
        'createWorkspaceProjectReader',
        'getWorkspaceProjectMutationBoundary',
        'openWorkspaceProjectStableWriter',
        'getWorkspaceProjectIdentityResolver',
        'getWorkspaceProjectStateDirectories',
        'createWorkspaceProjectMutationBoundary',
      ]) {
        expect(Object.keys(entry)).not.toContain(name);
      }
    }
  });
});
