---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-cli': minor
---

Add a credential store port (`ICredentialStore` in `agent-core`) and keep the CLI's secrets behind it: the OS keychain through the optional `@napi-rs/keyring` binding (macOS Keychain, Windows Credential Manager, Linux Secret Service), else an owner-only file under `~/.robota/credentials`. The backend is chosen at first use, recorded, and named by `/remote-control status`; a recorded keychain that stops working fails closed instead of degrading to the file.

The remote-control host identity key moves into the store. The old `~/.robota/remote-host-identity.json` may have been copied by backups or dotfile sync, so it is not carried over: on the first run after upgrading a new host key is generated, the old file is removed, and the operator is told once that trusted devices must pair again.
