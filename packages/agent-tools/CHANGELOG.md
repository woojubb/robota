# @robota-sdk/agent-tools

## 3.0.0-beta.61

### Minor Changes

- e243fb0: Add provider-neutral sandbox execution ports, E2B-compatible sandbox adapter, and SDK sandbox injection for Bash and core file tools.
- 18fcc5b: Add provider-neutral sandbox snapshot hydration for interactive sessions. Snapshot-capable sandbox clients now persist `sandboxSnapshotId` on shutdown and restore it before saved message replay on non-fork resume, while the E2B structural adapter supports both `createSnapshot()`-style checkpoints and pause/resume sandbox references.
- 3bde012: Add provider-neutral sandbox workspace manifests and wire `InteractiveSession` to apply them before session creation.

### Patch Changes

- d97bdf2: Add provider-owned model catalog metadata, route `/model` suggestions through the active provider, and make `cli:dev` resolve the CLI workspace dependency closure through source export conditions.
- Updated dependencies [1c0d44c]
- Updated dependencies [36eb7a9]
- Updated dependencies [d97bdf2]
  - @robota-sdk/agent-core@3.0.0-beta.61

## 3.0.0-beta.60

### Patch Changes

- Updated dependencies [7439391]
  - @robota-sdk/agent-core@3.0.0-beta.60

## 3.0.0-beta.59

### Patch Changes

- 95721ff: Preserve existing target mode bits during atomic Write and Edit file replacements.
  - @robota-sdk/agent-core@3.0.0-beta.59

## 3.0.0-beta.58

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.58

## 3.0.0-beta.57

### Patch Changes

- 822a78b: Add self-hosting verification planning and atomic UTF-8 writes for built-in file mutation tools.
- Updated dependencies [16c3b6f]
- Updated dependencies [f61e2cb]
  - @robota-sdk/agent-core@3.0.0-beta.57

## 3.0.0-beta.56

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.56

## 3.0.0-beta.55

### Patch Changes

- 38a72bf: fix: resolve ESLint tsconfig parsing errors and improve pnpm CI reliability
  - Add tsconfig.eslint.json to all packages for per-package ESLint runs
  - Migrate typecheck from pnpm -r exec tsc to per-package typecheck scripts
  - Add --if-present to all recursive pnpm run scripts
  - Fix React type imports, dynamic imports in tests, Express.Multer types

- Updated dependencies [38a72bf]
  - @robota-sdk/agent-core@3.0.0-beta.55

## 3.0.0-beta.54

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.54

## 3.0.0-beta.53

### Patch Changes

- refactor: monolith decomposition — all agent-\* files under 300 lines
- Updated dependencies
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.53

## 3.0.0-beta.52

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.52

## 3.0.0-beta.51

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.51

## 3.0.0-beta.50

### Patch Changes

- fix: reinsert repository/homepage/bugs in correct field order
  - @robota-sdk/agent-core@3.0.0-beta.50

## 3.0.0-beta.49

### Patch Changes

- fix: add repository, homepage, bugs metadata to all publishable packages
  - @robota-sdk/agent-core@3.0.0-beta.49

## 3.0.0-beta.48

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.48

## 3.0.0-beta.47

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.47

## 3.0.0-beta.46

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.46

## 3.0.0-beta.45

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.45

## 3.0.0-beta.44

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.44
