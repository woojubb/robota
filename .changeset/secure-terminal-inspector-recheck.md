---
'@robota-sdk/agent-cli': patch
---

The terminal's unlock now checks for an open debugger inspector a second time, after the passphrase is typed and before the keyring is tried with it, not only before the prompt opens. An inspector that opened while the passphrase was being typed drops the typed line unused and keeps the keys locked, with the same message as the first check. In a binary built with Bun, a launch that sets `BUN_INSPECT` is now read as an open inspector as well: Bun listens for a debugger there while its `inspector.url()` reports none, so `/unlock` used to ask for the passphrase in a process a debugger could read.
