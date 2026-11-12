# @robota-sdk/agent-os

## 3.3.1
### Patch Changes

- Refresh the package README so the npm page shows the current package layout, install steps and environment variable names.

## 3.3.0
### Minor Changes

- 913d334: The host primitives are now one package, `@robota-sdk/agent-os`, with one subpath each: `file-authority` (and `file-authority/testing`), `node-lock` and `process`. Import the subpath you use (`@robota-sdk/agent-os/process`); there is no root export, and a bundle that imports `process` contains no native binding. Koffi is now an optional peer dependency pinned to `3.3.1`: a project that imports `file-authority` or `node-lock` installs it itself, and a project that imports only `process` installs nothing. The exported names and signatures are unchanged. `@robota-sdk/agent-file-authority`, `@robota-sdk/agent-node-lock` and `@robota-sdk/agent-process` no longer receive releases. The framework, session, tools, executor and subagent-runner packages depend on `@robota-sdk/agent-os`; the packages that used the file authority or the lock declare `koffi` themselves, so their installs are unchanged.

### Patch Changes

- 44f28ee: `killProcessTree` now ends the whole process tree at once on Windows. Before, it ended only the direct child first, so a shell that exited left the program it started running with the shell's output pipes open, and a caller waiting for the child to close waited forever.
