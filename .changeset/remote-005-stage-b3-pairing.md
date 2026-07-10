---
'@robota-sdk/agent-remote-pairing': minor
---

REMOTE-005 Stage B3: add the isomorphic `@robota-sdk/agent-remote-pairing` package — pairing + DTLS-fingerprint
channel binding for P2P remote-control (no user-facing enable path; that is B4).

A high-entropy (256-bit) single-use pairing secret (QR / deep link) replaces the parent design's SPAKE2 — a PAKE
is unnecessary for a machine-transferred high-entropy secret. Authentication + MITM-relay detection is a
**directional, nonce-bound HMAC key-confirmation bound to both DTLS fingerprints** (`HMAC(HKDF(secret),
LABEL[role] ‖ nonces ‖ sortedPair(localFp, remoteFp))`): reflection-safe (distinct initiator/responder labels),
replay-safe (fresh nonces), and MITM-detecting (a relay's substituted fingerprint makes the peers' pairs differ).
WebCrypto only, zero workspace deps, no `node:` imports — reusable unchanged by the Stage-D browser client. Ships
secret/nonce/URL helpers, `extractDtlsFingerprint`, a domain-separated `deriveSessionKey`, and a fail-closed
`startPairingHandshake` (rejects on mismatch/timeout).
