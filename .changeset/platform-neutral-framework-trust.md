---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
---

Make the workspace trust modules of the main entry platform-neutral: they no longer import `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `process`, `Buffer` or `@robota-sdk/agent-file-authority`. The package stays Node-only until the rest of the split lands.

What is now required:

- `WorkspaceTrustService` takes `projectFiles` (`IWorkspaceProjectFiles`: `readBytes`, `listDirectory`, `inspectKind`, `createMutationBoundary`, `createStableWriter`), the host's own file operations. A service built without them, or with one of them missing, throws `WorkspaceAuthorityRequiredError` at construction. The service binds them to each authority it mints; nothing else in the framework opens a project path, and the authority brand, its records and the issuer stay unexported, so a look-alike object is refused as before.
- A host with no file operations builds no service: it passes `createRestrictedWorkspaceProjectAccess('untrusted', cwd)` as `projectAccess`, which carries no authority and so reads and writes nothing, exactly as a Restricted session did.
- A Node host builds a trusted session with `createNodeWorkspaceTrustService(storePath, directories)` from `@robota-sdk/agent-framework/node`, or composes `new WorkspaceTrustService({ identityResolver, store, projectFiles: createNodeWorkspaceProjectFiles() })`. Reads, listings, kinds and writes are the same root-relative, link-refusing, stable operations as before, and a write is still refused off Linux.

Moved to `@robota-sdk/agent-framework/node` (no longer on the main entry): `createNodeWorkspaceIdentityResolver`, `createNodeWorkspaceTrustService`, `createNodeWorkspaceTrustStore`, `inspectPreTrustProjectPaths`, `supportsWorkspaceProjectMutation`, and the types `INodeWorkspaceTrustStoreOptions`, `IPreTrustProjectPathInspection` and `TPreTrustProjectPathKind`. New there: `createNodeWorkspaceProjectFiles`. New on the main entry: the types `IWorkspaceProjectFiles`, `IWorkspaceProjectMutationBoundary` and `IWorkspaceProjectStableWriter`.

`.` and `./node` share one module instance in both the ESM and the CJS output, so an authority the Node service mints is accepted by `assertWorkspaceProjectAuthority`, `getWorkspaceProjectReader`, `getWorkspaceProjectIdentity` and `assertWorkspaceProjectMutationForAuthority` on the main entry, which `@robota-sdk/workflows` 0.0.3 calls.

The service, the reader, the state storage, the mutation and the settings writer keep what they hold in `#` fields and methods, so no property or method of one of them, reachable at runtime, carries the host's file operations, the generations that decide an authority's liveness or the step that mints one.

Unchanged on Windows and POSIX: the `relativePath` of a `readTextAlongAncestors` entry and the `projectRelativePath` of a state storage keep the separator of the host's own root.
