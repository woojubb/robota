# @robota-sdk/dag-api

## 3.0.0-beta.61

### Major Changes

- 34768aa: **BREAKING — RUNTIME-003: make one queue-scoped coordinator the sole owner of DAG run
  advancement.**

  `dag-api` no longer exports the framework assembly result or the raw worker-step port. The
  framework-owned execution composition now exposes `runAdvancement` instead of `workerLoop`, and the
  legacy framework `WorkerLoopDriver` export is removed.

  `dag-worker` adds `RunAdvancementCoordinator`, its observer/lifecycle contracts, and the typed
  `RunAdvancementStoppedError`. Background demand and named-run observers share one actor, observer
  abort/deadline never cancels a run, and shutdown settles observers before draining the single
  in-flight step. Framework prompt jobs and local CLI/SDK execution now use that coordinator without
  floating promises or competing `processOnce()` loops.

### Patch Changes

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
- @robota-sdk/dag-runtime@3.0.0-beta.60
- @robota-sdk/dag-worker@3.0.0-beta.60
- @robota-sdk/dag-scheduler@3.0.0-beta.60
- @robota-sdk/dag-projection@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.59
- @robota-sdk/dag-runtime@3.0.0-beta.59
- @robota-sdk/dag-worker@3.0.0-beta.59
- @robota-sdk/dag-scheduler@3.0.0-beta.59
- @robota-sdk/dag-projection@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.58
- @robota-sdk/dag-runtime@3.0.0-beta.58
- @robota-sdk/dag-worker@3.0.0-beta.58
- @robota-sdk/dag-scheduler@3.0.0-beta.58
- @robota-sdk/dag-projection@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.57
- @robota-sdk/dag-runtime@3.0.0-beta.57
- @robota-sdk/dag-worker@3.0.0-beta.57
- @robota-sdk/dag-scheduler@3.0.0-beta.57
- @robota-sdk/dag-projection@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.56
- @robota-sdk/dag-runtime@3.0.0-beta.56
- @robota-sdk/dag-worker@3.0.0-beta.56
- @robota-sdk/dag-scheduler@3.0.0-beta.56
- @robota-sdk/dag-projection@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/dag-core@3.0.0-beta.55
  - @robota-sdk/dag-projection@3.0.0-beta.55
  - @robota-sdk/dag-runtime@3.0.0-beta.55
  - @robota-sdk/dag-scheduler@3.0.0-beta.55
  - @robota-sdk/dag-worker@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.54
- @robota-sdk/dag-runtime@3.0.0-beta.54
- @robota-sdk/dag-worker@3.0.0-beta.54
- @robota-sdk/dag-scheduler@3.0.0-beta.54
- @robota-sdk/dag-projection@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.53
- @robota-sdk/dag-runtime@3.0.0-beta.53
- @robota-sdk/dag-worker@3.0.0-beta.53
- @robota-sdk/dag-scheduler@3.0.0-beta.53
- @robota-sdk/dag-projection@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.52
- @robota-sdk/dag-runtime@3.0.0-beta.52
- @robota-sdk/dag-worker@3.0.0-beta.52
- @robota-sdk/dag-scheduler@3.0.0-beta.52
- @robota-sdk/dag-projection@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.51
- @robota-sdk/dag-runtime@3.0.0-beta.51
- @robota-sdk/dag-worker@3.0.0-beta.51
- @robota-sdk/dag-scheduler@3.0.0-beta.51
- @robota-sdk/dag-projection@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.50
- @robota-sdk/dag-runtime@3.0.0-beta.50
- @robota-sdk/dag-worker@3.0.0-beta.50
- @robota-sdk/dag-scheduler@3.0.0-beta.50
- @robota-sdk/dag-projection@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.49
- @robota-sdk/dag-runtime@3.0.0-beta.49
- @robota-sdk/dag-worker@3.0.0-beta.49
- @robota-sdk/dag-scheduler@3.0.0-beta.49
- @robota-sdk/dag-projection@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.48
- @robota-sdk/dag-runtime@3.0.0-beta.48
- @robota-sdk/dag-worker@3.0.0-beta.48
- @robota-sdk/dag-scheduler@3.0.0-beta.48
- @robota-sdk/dag-projection@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.47
- @robota-sdk/dag-runtime@3.0.0-beta.47
- @robota-sdk/dag-worker@3.0.0-beta.47
- @robota-sdk/dag-scheduler@3.0.0-beta.47
- @robota-sdk/dag-projection@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.46
- @robota-sdk/dag-runtime@3.0.0-beta.46
- @robota-sdk/dag-worker@3.0.0-beta.46
- @robota-sdk/dag-scheduler@3.0.0-beta.46
- @robota-sdk/dag-projection@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.45
- @robota-sdk/dag-runtime@3.0.0-beta.45
- @robota-sdk/dag-worker@3.0.0-beta.45
- @robota-sdk/dag-scheduler@3.0.0-beta.45
- @robota-sdk/dag-projection@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- @robota-sdk/dag-core@3.0.0-beta.44
- @robota-sdk/dag-runtime@3.0.0-beta.44
- @robota-sdk/dag-worker@3.0.0-beta.44
- @robota-sdk/dag-scheduler@3.0.0-beta.44
- @robota-sdk/dag-projection@3.0.0-beta.44
