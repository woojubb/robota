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
  createWorkspaceProjectMutation,
} from './project-mutation.js';
export { assertWorkspaceProjectReader } from './project-reader.js';
export { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';
export { WorkspaceTrustService } from './workspace-trust-service.js';

export type {
  IRestrictedWorkspaceProjectAccess,
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
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceContributionKind,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectAccess,
  TWorkspaceProjectSettingsTarget,
  TWorkspaceProjectSettingsWriteDecision,
  TWorkspaceProjectMutationDecision,
  TWorkspaceProjectStateNamespace,
  TWorkspaceTrustState,
} from './types.js';
export type { IWorkspaceTrustServiceOptions } from './workspace-trust-service.js';
