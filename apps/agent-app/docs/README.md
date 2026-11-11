# Electron desktop host

An **Electron desktop application** for macOS, Linux, and Windows. It is an internal workspace package and
is not published to npm.

The desktop host is a **thin shell**. It runs `__PRODUCT_CLI_NAME__ daemon start --json`, which starts this
workspace's headless runtime daemon or reuses the live one. In a folder that is not trusted yet, it asks
whether to trust the folder, start it Restricted, or quit. It loads the shared GUI web application and hands
it the daemon's loopback address through the preload bridge. Closing the window leaves the daemon running;
the next launch reattaches to it. The same page runs in a browser against the CLI's `--serve --open` mode.
Session, command, and permission logic stays in the daemon, so the GUI has no runtime dependency of its own.

The loopback connection is authenticated by a token. The CLI creates it with the daemon and reports it in
the address the shell hands to the page. The WebSocket transport rejects a connection without the token
before emitting session data.

## Secure conversations

When secure conversations are on for the product (`__PRODUCT_CLI_NAME__ secure enable`, see
[secure conversations](../../../packages/agent-cli/README.md#create-a-keyring-for-secure-conversations)), the
window starts no plain daemon and the page gets no WebSocket address. **File → Unlock Secure
Conversation…** opens an isolated native window for the passphrase or recovery key; the shell then
attaches to the folder's secure runtime, or starts and certifies one, and relays that one session to the
page over a message port. **File → Review Imported Secure Conversation…** lists imported conversations
that are not yet accepted, and a native dialog accepts or cancels each one. Folder trust is decided in a
native dialog, never by the page. Closing or reloading the window, locking the screen, suspending the
machine and quitting lock the session. If the runtime lock cannot be confirmed, the app refuses to
unlock, close or quit and says to stop the secure runtime. Secure desktop conversations run on macOS
only; on other systems the window says to use the secure CLI.

## Run from source

```bash
pnpm app:dev   # build the shell and page, then run the configured CLI from source
```

The daemon serves the selected workspace. Set `PRODUCT_CONFIG_FILE` to an explicit environment file for
product identity and host settings. `PRODUCT_GUI_SIDECAR_CMD` selects a fixture or alternate executable for
local testing; `PRODUCT_CLI_NAME` selects the configured CLI command when that override is absent.

## Package

`pnpm --filter @robota-sdk/agent-app dist:app` builds the shell and page, copies the host-platform CLI
binary into the app, and produces installers with electron-builder: AppImage and deb on Linux, dmg and zip
on macOS, NSIS on Windows. Compile the binary first with
`pnpm --filter ./packages/agent-cli build:bun:<target>` (for example `darwin-arm64`, `linux-x64` or
`windows-x64`; it needs Bun). `bundle:runtime` takes it from
`packages/agent-cli/dist-bun/<artifact prefix>-<target>` and fails when it is missing;
`PRODUCT_DESKTOP_BINARY` (or `--binary <path>` when running `bundle:runtime` alone) selects another file.
The generated product configuration supplies the installed application ID, display name, executable
names, and artifact prefix. Signing and notarization are separate release settings.

See [`SPEC.md`](./SPEC.md) for the daemon/token contract, renderer hardening, and the limits of the shell.

## Owner-selected remote task

Set `PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG` to an absolute, owner-only JSON file:

```json
{
  "version": 1,
  "publicUrl": "https://runtime.example/desktop",
  "binding": "owner-selected-binding",
  "credentialFile": "/private/current-desktop.jwt",
  "operatorCredentialFile": "/private/current-operator.jwt"
}
```

The credential files must be owned by the desktop user and readable only by that user. The optional
`caFile` selects an owner-managed certificate authority; otherwise system TLS trust applies. The runtime
must expose the `HostedDesktopGateway` owner composition documented in the CLI README. Pairing and
reconnect need fresh, issuer-signed credentials for the same task/session. Without an operator credential,
permission-requiring work is aborted. With one, the native approval dialog offers Deny or Allow once.
Remote tasks cannot use the desktop file picker or open local paths. The renderer holds only a fresh local
nonce; it receives neither remote credential. The window does not start a local daemon in this mode.

After building the page and shell, `test:e2e:remote` exercises the real Electron window, stock CLI worker,
TLS pairing and native approval using synthetic credentials. On Linux run it under a virtual display.
`PRODUCT_DESKTOP_NATIVE_E2E_EXECUTABLE` can select an existing Electron binary for this test.
