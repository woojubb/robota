# @robota-sdk/agent-app

## 3.0.0-beta.88
### Patch Changes

- dfde075: Generated products can select a CLI package binary, version and build label, native host entry and artifact name, and desktop identity. Artifact metadata records the source version and provenance. Clean-tree generation copies only the committed source tree, while the built-in desktop remains packageable without generation.
- Updated dependencies [dfde075]
- Updated dependencies [cf4fff8]
  - @robota-sdk/product-config@3.0.0-beta.88

## 3.0.0-beta.87

### Patch Changes

- 66af868: Restore portable default startup for generated Robota artifacts while preserving explicit product selection and immutable identity. Keep shared product configuration internal because existing SDK and CLI artifacts bundle its implementation and types.
- Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- Updated dependencies [66af868]
  - @robota-sdk/product-config@3.0.0-beta.87

## 3.0.0-beta.84

### Patch Changes

- 0af9b30: Bundle the full CLI so the desktop app can check workspace trust, start and reconnect to its daemon, and stop it on each supported platform.

## 3.0.0-beta.83

### Minor Changes

- 9ecffed: CLI daemon start, status, stop, and unlock commands run one long-lived runtime per workspace for clients to attach to.

  - **What a daemon is.** A supervised session marked as the workspace's daemon.
    - Its control socket answers `connect` with the loopback WebSocket address, and only to a caller that names the daemon's current start.
    - The token never touches disk or argv. The daemon removes it from its own environment, so its tools do not inherit it.
  - **Starting.** `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
    - Starts in one workspace take turns through a lock.
    - A lock left behind by a start that is gone is never removed automatically. The start refuses and names the CLI daemon unlock command.
    - A daemon that cannot hand over its address fails its start and is not left running.
  - **The desktop app attaches** to the workspace daemon and starts one only when none is running.
    - Closing the window leaves the daemon running.
    - If the daemon stops while the window is open, the window says so and offers Reconnect.
  - **`agent-ui-web`.** The WebSocket session client reports when its retries are exhausted (`onGiveUp`, and `onConnectionLost` in `useWsSession`).

## 3.0.0-beta.82

### Patch Changes

- @robota-sdk/agent-ui-web@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- @robota-sdk/agent-ui-web@3.0.0-beta.81

## 3.0.0-beta.80

### Patch Changes

- Updated dependencies [1e3f91a]
  - @robota-sdk/agent-ui-web@3.0.0-beta.80
