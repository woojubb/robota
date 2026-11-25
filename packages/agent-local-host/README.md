# @robota-sdk/agent-local-host

Node-only authority for owner-controlled local runtime state. Product hosts supply the selected paths and retain responsibility for secrets and admission.

The package is private to the workspace and provides, among other things:

- **Keyring file store** (`createKeyringFileStore`, `KeyringStoreError`): the owner-protected keyring file with its lock, verified writes and typed failure codes.
- **Supervised-runtime control carrier**: the owner-private session directory, the registration record and the Unix-domain socket (Windows named pipe) through which a supervised runtime is registered and reached, with liveness proof (`verifyLiveOwner`, `openRegisteredControlStream`, `listRegisteredCandidates`). The Windows private-descriptor helpers are exported beside it.
- **Workspace daemon prover** (`createWorkspaceDaemonProver`): proves, over an authenticated link the host's opener supplies, which registered runtime is the daemon serving a workspace.
- **Workspace-root broker** (`startWorkspaceRootBroker`, `requestWorkspaceRootBroker`, `SyncWorkspaceRootBrokerClient`, `secureWorkspaceRoot`): the long-lived process that retains the folders a person approved and performs project file operations against them, its clients, and the selection of the one physical root secure clients and runtimes fence. Its Windows endpoint is a protected named pipe.
- **Broker launcher, trust service and fence** (`ensureWorkspaceRootBroker`, `workspaceRootBrokerEndpoint`, `BrokeredWorkspaceTrustService`, `SecureWorkspaceRootFence`): starts or attaches to one broker per user-state root through a launcher the host supplies, resolves workspace trust and project file access through that broker, and fences the physical root a secure owner or runtime serves.
