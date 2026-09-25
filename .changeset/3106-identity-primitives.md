---
'@robota-sdk/agent-remote-pairing': minor
---

Add the three-tier identity primitives: a master key derived from a 24-word recovery phrase (BIP39, SLIP-0010 Ed25519) and never stored, signing-key and device certificates, signed rosters and revocation lists with rollback protection, session descriptors, and `verifyDeviceChain`. Every signature carries a purpose tag and one canonical encoding, and malformed input is refused with a closed reason rather than a throw.
