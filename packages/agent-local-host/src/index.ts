export { KeyringStoreError, createKeyringFileStore } from './keyring-store.js';
export type { IKeyringFileState, IKeyringFileStoreOptions, IKeyringStore, IMachineIdentity, TKeyringLoadResult, TKeyringStoreErrorCode } from './keyring-store.js';
export { createWorkspaceDaemonProver } from './workspace-daemon-proof.js';
export type { IProvenWorkspaceDaemon, IWorkspaceDaemonCandidate, IWorkspaceDaemonProofAttempt, IWorkspaceDaemonProofLink } from './workspace-daemon-proof.js';
export { openPreparedOwnerLink, openRegisteredOwnerLink, openRegisteredSpawnerLink } from './owner-link-client.js';
export { proveWorkspaceDaemon } from './prove-workspace-daemon.js';
export { launchAndCertifyRuntime } from './certified-runtime-launch.js';
export type { ICertifiedRuntimeLaunch } from './certified-runtime-launch.js';
export { MAX_FORWARDED_ENVIRONMENT_BYTES, startForwardedRuntime, startPlainRuntime, startSpawnerRuntime } from './runtime-process-launch.js';
export type { IRuntimeStartCommand, IRuntimeStartHandoff, IRuntimeStartLayout, IRuntimeStartRequest, TPreparedForwardedEnvironment } from './runtime-process-launch.js';
export { openNativeSecureOwner } from './native-secure-owner.js';
export type { INativeSecureOwner, INativeSecureOwnerOptions, TNativeOwnerSecret } from './native-secure-owner.js';
export { acquireSupervisedDaemonStartLock, removeSupervisedDaemonStartLock } from './supervised-start-lock.js';
export type { ISupervisedDaemonStartLockOptions } from './supervised-start-lock.js';
export { CONTROL_REQUEST_TIMEOUT_MS, isControlCwd, isCurrentActivity, listSupervisedRuntimes, lockSupervisedSession, openSupervisedAttachSocket, requestSupervisedControl, stopStartedSupervisedSession, stopSupervisedSession } from './supervised-control-client.js';
export type { ISupervisedAttachSocket, ISupervisedRuntime, ISupervisedRuntimeStatus, TSupervisedActivity } from './supervised-control-client.js';
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
export { approvePreparedCandidate, assertRestrictedRoot, prepareRestrictedRoot, releaseRestrictedRoot, retainRestrictedRoot } from './native-owner-trust.js';
export { CONTROL_ACCESS, isControlCommandName } from './control-access.js';
export type { TControlCommandName } from './control-access.js';
export type { IRuntimeAdmission, IRuntimeAdmissionContext, IRuntimeAdmissionStatus, TRuntimeAdmissionFactory } from './runtime-admission.js';
export { MAX_ATTACHED_SURFACES, createSupervisedAttachCarrier } from './supervised-attach.js';
export type { TSupervisedAttachTarget } from './supervised-attach.js';
export { SUPERVISED_SPAWNER_PAIR_FLAG, answerHandedOverSpawnerPair } from './supervised-spawner-pair.js';
export { SUPERVISED_TRANSPORT_TOKEN_FD, SUPERVISED_TRANSPORT_TOKEN_FLAG, isSupervisedTransportToken, readSupervisedTransportToken } from './supervised-transport-token.js';
export { RuntimeCustody } from './runtime-custody.js';
export { armUncertifiedStop } from './uncertified-stop.js';
export { LISTENER_SURFACES, PROCESS_SURFACES, SECURE_SURFACES, SecureSurfaceRefusedError, holdsNoReadKey, startListener, unlocksAtTerminal } from './secure-surfaces.js';
export type { TListenerRule, TListenerSurface, TProcessSurface } from './secure-surfaces.js';
export { answerSpawnerPairOrExit, startSecureRuntimeOrExit } from './secure-runtime-startup.js';
export type { ISecureRuntimeStart, ISecureServeRuntime } from './secure-runtime-startup.js';
export { readProductConversationMode, writeProductConversationMode } from './conversation-mode-state.js';
export type { TProductConversationMode } from './conversation-mode-state.js';
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
