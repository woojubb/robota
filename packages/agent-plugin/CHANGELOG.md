# @robota-sdk/agent-plugin

## 3.0.0-beta.85

### Patch Changes

- Updated dependencies [41cca13]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
  - @robota-sdk/agent-core@3.0.0-beta.85

## 3.0.0-beta.84

### Patch Changes

- Updated dependencies [9f46375]
- Updated dependencies [9c6a8db]
  - @robota-sdk/agent-core@3.0.0-beta.84

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
- Updated dependencies [e689c8e]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
  - @robota-sdk/agent-core@3.0.0-beta.83

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
  - @robota-sdk/agent-core@3.0.0-beta.81

## 3.0.0-beta.80

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
  - @robota-sdk/agent-core@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- DQ-AUDIT-006 — error/observability hygiene: replace raw `throw new Error()` on core-service and provider hot paths with typed `RobotaError` subclasses (`ConfigurationError`/`ValidationError`) so error-handling can branch on category/recoverable; surface fire-and-forget hook failures via `logger.warn` instead of silent `.catch(() => {})`; wire the error-handling plugin's `totalRetries`/`successfulRecoveries` stats to real counters.
- Updated dependencies
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65

## 3.0.0-beta.64

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.64
