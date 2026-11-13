# @robota-sdk/agent-app

## 3.0.15
### Patch Changes

- The desktop app runs on the current SDK versions, including the one that stores the sections a session's system prompt was composed from.
- Updated dependencies
  - @robota-sdk/agent-cli@3.4.0

## 3.0.14
### Patch Changes

- Adopt SDK core 3.3, framework 3.3 and session 3.2.6 and workflows 0.0.7. Edit checkpoints are serialized per session and claimed atomically across processes, project logs and history reached through links are refused, and a session that closes normally keeps its record claim until it is down. The live workspace broker now supplies the checkpoint writer leases and directory claims the SDK requires: a lease is held by the broker for the session, ends when its client process is gone, and is released when its trust is revoked.
- 57a832a: Watch a served session without being able to change it. `robota --serve --observer-port <port>` with `PRODUCT_OBSERVER_TOKEN` (at least 32 characters, different from the driver and HTTP tokens) opens a read-only loopback listener with its own token: an observer reads the conversation and state, cannot submit, answer prompts, run commands or switch sessions, and its disconnect does not end the session. A secure runtime and a hosted task worker refuse the flag.
- Updated dependencies
- Updated dependencies [57a832a]
  - @robota-sdk/agent-cli@3.3.0

## 3.0.13
### Patch Changes

- e10f377: Build on the merged SDK packages. The CLI and the desktop app now import providers, host primitives, transport carriers, the default tool set, product assembly and the shared contracts from the subpaths of `@robota-sdk/agent-provider`, `@robota-sdk/agent-os`, `@robota-sdk/agent-transport`, `@robota-sdk/agent-tools`, `@robota-sdk/agent-product` and `@robota-sdk/agent-interface`, instead of the separate packages those replace. The command line, the settings and the behavior are unchanged.
- 5747738: Use the released SDK session roles. A connected client can ask the CLI or the desktop app for its effective role, and a desktop renderer that asks on the hosted desktop path stays connected.
- fa36533: Use the SDK patch release whose shipped types and messages no longer point at internal tracker IDs, so an agent reading the installed types or an error message is not sent looking for tickets it cannot open.
- efb0831: The workspace root broker now exits once the user-state directory it serves is removed or replaced. Before, it ran until the next reboot, so every run with a temporary state directory, such as a test or a disposable smoke, left one more broker process behind. CLI and desktop restarts still reattach to held approvals while that directory remains.
- Updated dependencies [e10f377]
- Updated dependencies [5747738]
- Updated dependencies [fa36533]
- Updated dependencies [56fbaf9]
- Updated dependencies [efb0831]
  - @robota-sdk/agent-cli@3.2.2

## 3.0.12
### Patch Changes

  - @robota-sdk/agent-local-host@3.0.3
  - @robota-sdk/agent-cli@3.2.1
  - @robota-sdk/agent-transport@3.2.1
  - @robota-sdk/product-config@3.2.1

## 3.0.11
### Patch Changes

- Updated dependencies [0ea29ac]
- Updated dependencies [12ab3f5]
- Updated dependencies [ffaf7d5]
- Updated dependencies [9da9c6c]
- Updated dependencies [ad5e9fb]
- Updated dependencies [2a28af7]
  - @robota-sdk/agent-cli@3.2.0
  - @robota-sdk/agent-transport@3.2.0
  - @robota-sdk/agent-local-host@3.0.2
  - @robota-sdk/product-config@3.2.0

## 3.0.10
### Patch Changes

- Updated dependencies [871fbef]
  - @robota-sdk/agent-cli@3.1.2
  - @robota-sdk/product-config@3.1.2

## 3.0.9
### Patch Changes

- Updated dependencies [7e55f21]
  - @robota-sdk/agent-cli@3.1.1
  - @robota-sdk/product-config@3.1.1

## 3.0.8
### Patch Changes

- Updated dependencies [51ad6a4]
- Updated dependencies [b160a57]
- Updated dependencies [bc8de21]
- Updated dependencies [d46727b]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [bc8de21]
- Updated dependencies [22ad89c]
- Updated dependencies [eabce48]
- Updated dependencies [bc8de21]
- Updated dependencies [eabce48]
- Updated dependencies [82663df]
- Updated dependencies [ea6fb89]
- Updated dependencies [bc8de21]
- Updated dependencies [0a677e9]
- Updated dependencies [830d3d2]
- Updated dependencies [0a677e9]
- Updated dependencies [a8c9e25]
- Updated dependencies [5b46d43]
- Updated dependencies [fab48ad]
- Updated dependencies [a2d36ea]
- Updated dependencies [ee7f7ef]
- Updated dependencies [a2d36ea]
- Updated dependencies [7ce5e73]
- Updated dependencies [a2d36ea]
- Updated dependencies [be32d9b]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [a2d36ea]
- Updated dependencies [b7b6cd0]
- Updated dependencies [42d595e]
- Updated dependencies [437ca9e]
- Updated dependencies [12cf199]
- Updated dependencies [44e9640]
- Updated dependencies [779781c]
  - @robota-sdk/agent-cli@3.1.0
  - @robota-sdk/product-config@3.1.0

## 3.0.7
### Patch Changes

  - @robota-sdk/product-config@3.0.7

## 3.0.6
### Patch Changes

  - @robota-sdk/product-config@3.0.6

## 3.0.5
### Patch Changes

  - @robota-sdk/product-config@3.0.5

## 3.0.4
### Patch Changes

  - @robota-sdk/product-config@3.0.4

## 3.0.3
### Patch Changes

  - @robota-sdk/product-config@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/product-config@3.0.2

## 3.0.1
### Patch Changes

- 95af165: Restore consistent stable package and desktop delivery after the incomplete 3.0.0 publication.
- 5f6b7ad: Consume the published workflow package while preserving host SDK identity.
  - @robota-sdk/product-config@3.0.1

## 3.0.0
### Minor Changes

- 9ecffed: `robota daemon start | status | stop | unlock` runs one long-lived runtime per workspace for clients to attach to.

  - **What a daemon is.** A supervised session marked as the workspace's daemon.
    - Its control socket answers `connect` with the loopback WebSocket address, and only to a caller that names the daemon's current start.
    - The token never touches disk or argv. The daemon removes it from its own environment, so its tools do not inherit it.
  - **Starting.** `daemon start --json` prints one line, `{"id","url"}`, for a client host to read.
    - Starts in one workspace take turns through a lock.
    - A lock left behind by a start that is gone is never removed automatically. The start refuses and names `robota daemon unlock`.
    - A daemon that cannot hand over its address fails its start and is not left running.
  - **The desktop app attaches** to the workspace daemon and starts one only when none is running.
    - Closing the window leaves the daemon running.
    - If the daemon stops while the window is open, the window says so and offers Reconnect.
  - **`agent-ui-web`.** The WebSocket session client reports when its retries are exhausted (`onGiveUp`, and `onConnectionLost` in `useWsSession`).
- cf7938e: The desktop app works on the folder you open, not the folder its process was started in.

  - **First launch:** the app asks which folder to open. After that it reopens the most recent folder that still exists. An installed app no longer falls back to `/` when started from Finder, the Dock, the Start menu or a launcher.
  - **Switching folders:** **File → Open Folder…** (`Cmd/Ctrl+O`) switches folders, and **File → Open Recent** lists earlier ones. The trust question names the chosen folder. The window attaches to that folder's daemon and leaves the previous folder's daemon running.
  - **Window and Dock:** the window title names the open folder. On macOS, clicking the Dock icon after closing the last window opens a new window on the same folder.

### Patch Changes

- 66af868: Restore portable default startup for generated Robota artifacts while preserving explicit product selection and immutable identity. Keep shared product configuration internal because existing SDK and CLI artifacts bundle its implementation and types.
- 2c612ba: Release the migrated Robota product with its public SDK namespace, robota command, compatible SDK exports, internal product configuration, and verified CLI startup and delivery corrections.
- 0af9b30: Bundle the full CLI so the desktop app can check workspace trust, start and reconnect to its daemon, and stop it on each supported platform.
- dfde075: Generated products can select a CLI package binary, version and build label, native host entry and artifact name, and desktop identity. Artifact metadata records the source version and provenance. Clean-tree generation copies only the committed source tree, while the built-in desktop remains packageable without generation.
- Updated dependencies [66af868]
- Updated dependencies [dfde075]
- Updated dependencies [cf4fff8]
- Updated dependencies [c402d98]
  - @robota-sdk/product-config@3.0.0

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.106

## 3.0.0-beta.101
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.105

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.104

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.103

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.102

## 3.0.0-beta.97
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.101

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.100

## 3.0.0-beta.95
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.99

## 3.0.0-beta.94
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.98

## 3.0.0-beta.93
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.97

## 3.0.0-beta.92
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.96

## 3.0.0-beta.91
### Patch Changes

  - @robota-sdk/product-config@3.0.0-beta.95

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
