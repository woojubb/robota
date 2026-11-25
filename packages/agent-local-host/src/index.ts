export { KeyringStoreError, createKeyringFileStore } from './keyring-store.js';
export type { IKeyringFileState, IKeyringFileStoreOptions, IKeyringStore, IMachineIdentity, TKeyringLoadResult, TKeyringStoreErrorCode } from './keyring-store.js';
export { createWorkspaceDaemonProver } from './workspace-daemon-proof.js';
export type { IProvenWorkspaceDaemon, IWorkspaceDaemonCandidate, IWorkspaceDaemonProofAttempt, IWorkspaceDaemonProofLink } from './workspace-daemon-proof.js';
export { MAX_CONTROL_FRAME_BYTES, SUPERVISED_ID_PATTERN, SupervisedControlPathTooLongError, connectControlSocket, controlSocketPath, ensurePrivateDirectory, isGeneration, openRegisteredControlStream, readOwnedFile, readRegistration, sessionDirectory, verifyExistingDirectory, verifyLiveOwner } from './supervised-control-carrier.js';
export type { IRegistration } from './supervised-control-carrier.js';
export { WindowsControlPipeServer, connectWindowsControlPipe, windowsControlPipePath } from './windows-control-pipe.js';
export type { IControlChannel } from './windows-control-pipe.js';
export { assertWindowsPrivatePath, createWindowsPrivateDirectory, currentWindowsSid, isPrivateWindowsSddl, readWindowsProcessIdentity, readWindowsProcessStartTime, withWindowsPrivateDescriptor } from './windows-security.js';
export { listRegisteredCandidates } from './registered-candidates.js';
export type { IRegisteredCandidate } from './registered-candidates.js';
export { probeRegisteredPid, readRegisteredProcessStartTime } from './supervised-control-carrier.js';
export { DEFAULT_IDLE_LOCK_MS, KeyHolder, OPENED_DATA_KEY_LIMIT, OpenedDataKeys, SealingKeyMismatchError, createNodeTimers } from './key-holder.js';
export type { IKeyHolderOptions, IKeyHolderPolicy, IKeyHolderTimer, IKeyHolderTimers, IOpenBlobOptions, TGrantSealingKeyOutcome, TLockReason, TSealingKeyOutcome } from './key-holder.js';
export { KeyHolderArtifactSealer, ProcessLocalArtifactSealer, ProcessLocalSealerDisposedError, SealingKeyUnavailableError, WRITER_EPOCH_LIMITS, WriteOnlyArtifactSealer, WriterEpochs, formatWriteGrant, parseWriteGrant } from './artifact-sealer.js';
export type { IWriterEpochKeys, IWriterEpochLimits } from './artifact-sealer.js';
export { MIN_PASSPHRASE_CHARACTERS, PASSPHRASE_RULE_EXPLANATION, passphraseProblem } from './passphrase-policy.js';
export { SyncWorkspaceRootBrokerClient } from './workspace-root-broker-sync.js';
export { requestWorkspaceRootBroker, startWorkspaceRootBroker } from './workspace-root-broker.js';
export type { TWorkspaceRootBrokerMutation, TWorkspaceRootBrokerRequest, TWorkspaceRootBrokerResponse } from './workspace-root-broker.js';
export { ensureWorkspaceRootBroker, workspaceRootBrokerEndpoint } from './workspace-root-broker-process.js';
export type { IWorkspaceRootBrokerLaunch, IWorkspaceRootBrokerServe, IWorkspaceRootBrokerStart, TWorkspaceRootBrokerLauncher } from './workspace-root-broker-process.js';
export { BrokeredWorkspaceTrustService } from './brokered-workspace-trust.js';
export type { IBrokeredWorkspaceTrustOptions, TStaleBrokerMessage } from './brokered-workspace-trust.js';
export { SecureWorkspaceRootFence } from './workspace-root-fence.js';
export { secureWorkspaceRoot } from './workspace-root-selection.js';
export { LOOPBACK_GUI_API_HEADER, startLoopbackGuiServer } from './loopback-gui-server.js';
export type {
  ILoopbackGuiApiRequest,
  ILoopbackGuiApiResponse,
  ILoopbackGuiLabels,
  ILoopbackGuiLanding,
  ILoopbackGuiServer,
  ILoopbackGuiServerOptions,
} from './loopback-gui-server.js';
