// The platform-neutral workspace trust surface. What touches a Node file system or process (the
// stable file operations, the git identity resolver, the persistent trust store, the pre-trust
// metadata walk) is exported from `../node.ts`.
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
  prepareWorkflowJsonMutation,
} from './project-mutation.js';
export { assertWorkspaceProjectReader } from './project-reader.js';
export { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
export {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
} from './workspace-trust-service.js';

export type {
  IRestrictedWorkspaceProjectAccess,
  IWorkspaceTrustCause,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceAncestorTextEntry,
  IWorkspaceDirectoryEntry,
  IWorkspaceDirectoryRemovalOptions,
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectFiles,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectReader,
  IWorkspaceProjectSettingsWriter,
  IWorkspaceProjectMutation,
  IWorkspaceProjectStableWriter,
  IWorkspaceProjectStateStorage,
  IWorkspaceTrustGrant,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceContributionKind,
  TWorkspaceDirectoryRemoval,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectAccess,
  IWorkspacePolicy,
  TWorkspaceProjectSettingsTarget,
  TWorkspaceProjectSettingsWriteDecision,
  TWorkspaceProjectMutationDecision,
  TWorkspaceProjectStateNamespace,
  TWorkspaceProjectStateDirectories,
  TWorkspaceTrustState,
} from './types.js';
export type { IWorkspaceTrustServiceOptions } from './workspace-trust-service.js';
