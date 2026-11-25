---
'@robota-sdk/agent-cli': minor
---

`@robota-sdk/agent-cli/desktop-host` no longer exports `openDesktopSecureOwner`, `IDesktopSecureOwnerOptions` and `TDesktopSecureSecret`. The sequence that opens a native owner's secure link now lives in the private local host package, and a desktop calls it with the layout `resolveDesktopSecureLayout` returns, so the subpath keeps only the desktop controller, the parsers, the content security policy helper and that layout. There is no replacement export, because the local host package is private.
