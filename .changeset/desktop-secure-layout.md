---
'@robota-sdk/agent-cli': minor
---

`@robota-sdk/agent-cli/desktop-host` adds `resolveDesktopSecureLayout` and its `IDesktopSecureLayout` type. Given the product config and the environment, it returns the CLI's layout for opening a secure owner link as plain values: the state root, the keyring path, the supervised runtime directory, the workspace-root broker's approvals file and launch recipe, the start-lock removal hint, and the runtime's argument layout, token names and refusal copy. It reads no key, takes no lock and starts nothing.
