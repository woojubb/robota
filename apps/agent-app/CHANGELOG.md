# @robota-sdk/agent-app

## 3.0.0-beta.90
### Minor Changes

- cf7938e: The desktop app works on the folder you open, not the folder its process was started in.
  
  - **First launch:** the app asks which folder to open. After that it reopens the most recent folder that still exists. An installed app no longer falls back to `/` when started from Finder, the Dock, the Start menu or a launcher.
  - **Switching folders:** **File → Open Folder…** (`Cmd/Ctrl+O`) switches folders, and **File → Open Recent** lists earlier ones. The trust question names the chosen folder. The window attaches to that folder's daemon and leaves the previous folder's daemon running.
  - **Window and Dock:** the window title names the open folder. On macOS, clicking the Dock icon after closing the last window opens a new window on the same folder.

### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.94

## 3.0.0-beta.89
### Patch Changes

- Updated dependencies [c402d98]
  - @robota-sdk/product-config@3.0.0-beta.93

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
