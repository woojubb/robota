---
'@robota-sdk/agent-remote-pairing': patch
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-cli': patch
---

Remote-control pairing binds to the negotiated DTLS certificate.

- The Node host reads the remote fingerprint from the certificate the DTLS layer verified, not from the answer's
  SDP text, and builds the pairing gate once the DTLS handshake completes.
- An SDP must advertise exactly one DTLS fingerprint. `extractDtlsFingerprint` now throws when two different
  fingerprints are present, and `extractDtlsFingerprintAttribute` returns the algorithm with the value.
- A start takes one answer (host) and a connection takes one offer (browser client); a later description is
  ignored.
