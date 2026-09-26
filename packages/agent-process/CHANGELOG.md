# @robota-sdk/agent-process

## 3.0.0-beta.81

## 3.0.0-beta.80

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).

## 3.0.0-beta.77

### Patch Changes

- Coordinated beta.77 release. Runtime hardening across the session/execution/subagent stack
  (CORE-019..024: compaction-failure contract, strict execution error propagation, plugin/timer
  disposal, process-tree kill via the new `@robota-sdk/agent-process`, scheduler & IPC integrity),
  TUI shutdown/channel hygiene (CLI-075: listener unwiring, permission-queue drain, timeout-bounded
  graceful shutdown, second-signal force-quit), and agent-cli decoupled from the unpublished
  DAG/workflow chain so the published CLI installs cleanly (CLI-077). First publish of
  `@robota-sdk/agent-process`.
