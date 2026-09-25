# @robota-sdk/dag-runtime

## 3.0.0-beta.61

### Patch Changes

- eb71c83: Persist composite child run lineage (`IDagRun.lineage`) across restarts, so a restarted
  worker enforces composite depth/ancestry from the persisted run rather than an in-process default.

  - `dag-adapters-sqlite` adds migration v3 (`dag_runs.lineage_json`) and reads it back unvalidated —
    a corrupted or hand-edited value is handed through to the caller's decode step rather than
    thrown out of a plain `getDagRun`/`listDagRuns` read.
  - `dag-worker` decodes the persisted lineage before entering the executor and fails the task
    deterministically with `DAG_VALIDATION_RUN_LINEAGE_INVALID` on an undecodable value, leaving the
    worker loop free to keep processing other messages instead of crashing over one corrupted run.
  - `dag-runtime`'s run-key idempotency now also compares lineage: a duplicate run key whose
    requested composite lineage differs from the existing run's persisted lineage is rejected with
    `DAG_VALIDATION_RUN_KEY_LINEAGE_MISMATCH` instead of silently handing back the existing run.
  - A root lineage that only carries a depth cap remains valid for starting a fresh root run.

- Updated dependencies [eb71c83]
- Updated dependencies [fec722f]
- Updated dependencies [9fbab1b]
- Updated dependencies [caabd3c]
- Updated dependencies [6238e38]
- Updated dependencies [74bf844]
- Updated dependencies [5a46402]
  - @robota-sdk/dag-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/dag-core@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.44
