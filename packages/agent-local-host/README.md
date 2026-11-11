# @robota-sdk/agent-local-host

Node-only authority for owner-controlled local runtime state. Product hosts supply the selected paths and retain responsibility for secrets and admission.

The package is private to the workspace and provides three things:

- **Keyring file store** (`createKeyringFileStore`, `KeyringStoreError`): the owner-protected keyring file with its lock, verified writes and typed failure codes.
- **Supervised-runtime control carrier**: the owner-private session directory, the registration record and the Unix-domain socket (Windows named pipe) through which a supervised runtime is registered and reached, with liveness proof (`verifyLiveOwner`, `openRegisteredControlStream`, `listRegisteredCandidates`). The Windows private-descriptor helpers are exported beside it.
- **Workspace daemon prover** (`createWorkspaceDaemonProver`): proves, over an authenticated link the host's opener supplies, which registered runtime is the daemon serving a workspace.
