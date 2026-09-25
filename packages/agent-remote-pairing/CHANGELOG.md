# @robota-sdk/agent-remote-pairing

## 3.0.0-beta.80

### Minor Changes

- 040f31f: Add the three-tier identity primitives: a master key derived from a 24-word recovery phrase (BIP39, SLIP-0010 Ed25519) and never stored, signing-key and device certificates, signed rosters and revocation lists with rollback protection, session descriptors, and `verifyDeviceChain`. Every signature carries a purpose tag and one canonical encoding, and malformed input is refused with a closed reason rather than a throw.
- 1f45110: REMOTE-005 Stage B3: add the isomorphic `@robota-sdk/agent-remote-pairing` package — pairing + DTLS-fingerprint
  channel binding for P2P remote-control (no user-facing enable path; that is B4).

  A high-entropy (256-bit) single-use pairing secret (QR / deep link) replaces the parent design's SPAKE2 — a PAKE
  is unnecessary for a machine-transferred high-entropy secret. Authentication + MITM-relay detection is a
  **directional, nonce-bound HMAC key-confirmation bound to both DTLS fingerprints** (`HMAC(HKDF(secret),
LABEL[role] ‖ nonces ‖ sortedPair(localFp, remoteFp))`): reflection-safe (distinct initiator/responder labels),
  replay-safe (fresh nonces), and MITM-detecting (a relay's substituted fingerprint makes the peers' pairs differ).
  WebCrypto only, zero workspace deps, no `node:` imports — reusable unchanged by the Stage-D browser client. Ships
  secret/nonce/URL helpers, `extractDtlsFingerprint`, a domain-separated `deriveSessionKey`, and a fail-closed
  `startPairingHandshake` (rejects on mismatch/timeout).

### Patch Changes

- 4f3c075: Assemble complete, verified package generations before switching build output; preserve the previous generation on build failure and pack only verified regular-file images. Include copied CLI web assets in affected-build ordering and artifact transfer. Preserve the CLI version in managed build paths. Public runtime contracts remain compatible (patch).
- 2db1b97: Remote-control pairing binds to the negotiated DTLS certificate.

  - The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
    SDP text, and builds the pairing gate once the DTLS handshake completes.
  - An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
    fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
  - A start takes one answer (host) and a connection takes one offer (browser client); a later description is
    ignored.

- 833afe1: Remove the remaining polynomial-ReDoS backtracking (SEC-003, CodeQL `js/polynomial-redos`) and stop the DTLS fingerprint binding to SDP free text.

  **`extractDtlsFingerprint` (agent-remote-pairing) — remote-reachable, pre-authentication.** Unlike the rest of this class, the SDP it parses arrives over the signaling relay, which the pairing design treats as untrusted, and it is parsed _before_ the channel-binding confirmation — on the browser peer, before `setRemoteDescription` too. Unanchored, `a=fingerprint:\S+\s+…` restarted from every offset in a non-space run: 5.0 s on a 400 KB SDP. It is now anchored to the start of an SDP line (`/^…/m`), which is linear and also stops the extractor from returning a value smuggled into another line's free text (`s=`, `i=`, an unrelated attribute) — text no DTLS stack reads, and which a relay controls. **Behaviour change:** a mid-line `a=fingerprint:` is no longer recognised. Every SDP a WebRTC stack emits puts the attribute at the start of its own line, so no real SDP is affected. A session-level line can still shadow a media-level one; that residual is recorded in the SEC-003 backlog.

  **Trailing-run trims (agent-framework, agent-cli, agent-tools).** `replace(/-+$/, '')`-shaped regexes have no start anchor, so the engine retried the run from every offset inside it and each retry rescanned to the end — 3.0 s at 100 K characters, ~50 s at 400 K. The memory topic sanitiser, the provider profile-name sanitiser, the model-command tool-name projection, the npm registry URL builder, the git-worktree path-segment sanitiser and the sandbox-root normaliser now use linear index scans (`trimEdgeChars` / `trimTrailingChars` in agent-framework, local helpers elsewhere), proven equivalent to the regexes they replace over every string of the relevant alphabet up to 12 characters.

  **Whitespace-ambiguity parsers (agent-framework).** The skill and agent-definition frontmatter list splitters used `/\s*,\s*/`, whose whitespace run overlapped nothing after it on a failed comma — 12.6 s on a 200 K run. They now split on `','`; the padding was already removed by the `.trim()` that follows, so the parsed lists are unchanged. The `.git` `gitdir:` pointer and the task-file open-item matcher used `\s*(.+)$` / `\s+(.+)$`, where `\s` and `.` both match a space; the capture is now pinned to start non-space, which accepts exactly the same inputs (verified exhaustively) and removes 14.5 s and 15.4 s worst cases.

  **`WebFetch` HTML-to-text (agent-tools) — carried no CodeQL alert.** Found by sweeping for the same shapes rather than the flagged lines, and the only quadratic here whose input is a live response body from an arbitrary URL. `<[^>]+>`, `<script[\s\S]*?</script>` and `<style…>` each restarted from every opener that had no terminator: 12.6 s on 200 KB of `<`, and the 5 MB the fetch allows would have taken hours. All three are now single-pass scans, verified character-for-character identical to the regexes over ~800 K generated inputs.

  Apart from the `extractDtlsFingerprint` anchoring noted above, no behaviour changes: every fix accepts the same inputs and produces the same values, and each ships an equivalence test pinning that.
