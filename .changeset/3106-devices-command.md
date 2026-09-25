---
'@robota-sdk/agent-remote-pairing': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': minor
---

Add `/devices` for this device's identity among the user's devices: `list`, `init` (creates the identity: a recovery phrase, the master-certified signing key, this device's keys and certificate, the first roster and revocation list), `revoke <device-id>` (signing key only, no phrase; confirmed at the terminal) and `recover` (rotates the signing key from the phrase and revokes the old ones). Enrolling another device (`add` / `join`) comes with the device connection.

The recovery phrase never enters the session: it is shown once and read with no echo on the controlling terminal (opened apart from the session's input), on the alternate screen that is cleared afterwards, and never reaches prompt history, conversation history, transcripts, traces or the model. Without an interactive terminal the phrase commands refuse. `/devices` is operator-only: never model-invocable and refused from remote surfaces. Private keys live in the host credential store; certificates, roster, revocation lists and sequence marks are kept in owner-only files under `~/.robota/devices`.

`agent-remote-pairing` adds `isRecoveryPhraseWord`, so a phrase can be checked one word at a time.
