# @robota-sdk/agent-process

## 3.0.0-beta.91

## 3.0.0-beta.90

## 3.0.0-beta.89

## 3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.

## 3.0.0-beta.86

## 3.0.0-beta.85

## 3.0.0-beta.84

## 3.0.0-beta.83

### Patch Changes

- 57280bf: Every published package now declares `"engines": { "node": ">=22.12.0" }`. Before, 27 of the 38
  packages declared no floor (`agent-core`, `agent-tools` and every provider among them),
  `agent-session` and `agent-file-authority` declared `>=20.19.0`, and the other nine declared
  `>=22.0.0`, so a consumer on Node 20 saw at most a warning from a transitive dependency.

  Why 22.12: `agent-cli` and `agent-ui-terminal` need Node 22 through `ink` 7, and the CommonJS entries
  of `agent-tools` and its dependents, `agent-transport`/`node` and its dependents, and
  `agent-ui-terminal` `require()` ESM-only dependencies (`p-limit`, `jose`, `chalk`), which Node 22
  supports unflagged only from 22.12. `engines` is advisory unless the consumer enables `engine-strict`.

  No code changes: `tsdown` now reads `node22.12.0` as its build target from the field.

- 18c0d5c: Every published package now exports `./package.json`, so `require('<package>/package.json')` and
  `import('<package>/package.json', { with: { type: 'json' } })` work instead of failing with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and each tarball now ships the package's `CHANGELOG.md`.

## 3.0.0-beta.82

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
