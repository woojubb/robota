# @robota-sdk/agent-interface-tui

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

## 3.0.0-beta.79

## 3.0.0-beta.78

## 3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-003 — restore agent-interface-tui to type-contracts only by removing its runtime type-guards (`isPickerInteraction`/`isConfirmInteraction`, which had zero call sites); narrow `TAnyTuiCommandInteraction` on its `onMissingArgs` discriminant instead. Documented the type-only downward references in agent-interface-transport.

## 3.0.0-beta.75

## 3.0.0-beta.74

## 3.0.0-beta.73

## 3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate

## 3.0.0-beta.70

## 3.0.0-beta.69

## 3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- CLIR: agent-cli layer separation, agent-framework interactive session improvements, subagent runner fix, TUI interface README
