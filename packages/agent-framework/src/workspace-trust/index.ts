export {
  assertWorkspaceProjectAuthority,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
} from './workspace-authority.js';
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
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
  TWorkspaceContributionKind,
  TWorkspaceProjectAuthorityCandidate,
  TWorkspaceProjectAccess,
  TWorkspaceTrustState,
} from './types.js';
export type { IWorkspaceTrustServiceOptions } from './workspace-trust-service.js';
