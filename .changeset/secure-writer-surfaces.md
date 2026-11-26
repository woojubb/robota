---
'@robota-sdk/agent-cli': patch
---

Print mode (`-p`, `--goal`), `acp` and `mcp serve` over stdio now start while secure conversations are on; before, each exited with `Secure conversation sealing key holder is unavailable; no conversation store may open.` before doing anything, because no process but a supervised runtime was given a key holder. They are given a locked one: it holds only the keyring's sealing public key, so what they write is sealed to the keyring and opens only for its owner, and they never ask for a passphrase or unlock. A saved session sealed to the keyring is therefore never opened there: `--continue` says it is sealed and locked and starts a new session, and `--resume` of one is refused. If the keyring file cannot be read these processes still refuse to open any conversation store; nothing falls back to plaintext. The terminal UI, commands such as `usage` and `session list`, `--attach` and plain mode are unchanged.
