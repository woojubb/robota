export {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from './workspace-authority.js';
export {
  assertWorkspaceProjectStateStorage,
  getWorkspaceProjectStateStorage,
} from './project-state-storage.js';
export {
  assertWorkspaceProjectSettingsWriter,
  createWorkspaceProjectSettingsWriter,
} from './project-settings-writer.js';
export {
  assertWorkspaceProjectMutation,
  assertWorkspaceProjectMutationForAuthority,
  createWorkspaceProjectMutation,
} from './project-mutation.js';
export { assertWorkspaceProjectReader } from './project-reader.js';
export { inspectPreTrustProjectPaths } from './pretrust-contribution-inspector.js';
export type {
  IPreTrustProjectPathInspection,
  TPreTrustProjectPathKind,
} from './pretrust-contribution-inspector.js';
export { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
export {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
} from './workspace-trust-service.js';
export {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceTrustService,
  createNodeWorkspaceTrustStore,
} from './node-host-workspace-trust.js';

export type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceTrustCause,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectReader,
  IWorkspaceProjectSettingsWriter,
  IWorkspaceProjectMutation,
  IWorkspaceProjectStateStorage,
  IWorkspaceTrustGrant,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceContributionKind,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectAccess,
  TWorkspaceProjectSettingsTarget,
  TWorkspaceProjectSettingsWriteDecision,
  TWorkspaceProjectMutationDecision,
  TWorkspaceProjectStateNamespace,
  TWorkspaceProjectStateDirectories,
  TWorkspaceTrustState,
} from './types.js';
export type { IWorkspaceTrustServiceOptions } from './workspace-trust-service.js';
