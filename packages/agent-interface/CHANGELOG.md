# @robota-sdk/agent-interface

## 3.3.2
### Patch Changes

- 21d52f7: A session now stores the sections its system prompt was composed from, beside the prompt: each section's id, source and rendered length, in prompt order, plus a digest of the product's own harness text (`none` when a run carries none). `/context prompt` lists them with their sizes and `/context prompt <section-id>` prints one exactly as the model receives it. A prompt a caller supplied whole has no known composition and is reported as such, and a fork inherits its parent's sections with the prompt.
  
  Breaking for code that wires a session by hand: the rebuilder returned from session assembly now returns `{ message, manifest }` instead of a string, `Session.updateSystemMessage` takes the manifest of the message it replaces (omit it and the session reports none), and `ICommandSessionRuntime` gains `getSystemMessage` and `getSystemPromptManifest`. The `careful-reviewer` preset no longer documents a verification loop that never existed; its `selfVerification` is a prompt directive.

## 3.3.1
### Patch Changes

- Refresh the package README so the npm page shows the current package layout, install steps and environment variable names.

## 3.3.0
### Minor Changes

- 327999e: The contract packages are now one package, `@robota-sdk/agent-interface`, with one subpath per family: `session` (and `session/testing`), `session-mobility`, `command`, `execution`, `analytics`, `transport` (and `transport/testing`) and `tui`. Import the subpath of the family you use (`@robota-sdk/agent-interface/session`); there is no root export. `@robota-sdk/agent-core` is now an optional peer dependency: `analytics` and `tui` need nothing, and a project that imports another family installs `agent-core` itself (the SDK packages that import those families declare it). The exported names and signatures are unchanged. `@robota-sdk/agent-interface-session`, `-session-mobility`, `-command`, `-execution`, `-analytics`, `-transport` and `-tui` no longer receive releases. The SDK packages that import a contract depend on `@robota-sdk/agent-interface`.
