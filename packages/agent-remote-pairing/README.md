# @robota-sdk/agent-remote-pairing

Isomorphic pairing and DTLS-fingerprint channel binding. The public contract is defined in
[docs/SPEC.md](docs/SPEC.md).

SDP-dialect normalization tests belong to this package:
`src/__tests__/fingerprint-parity.test.ts` reads its own werift and native-browser SDP samples.
The browser transport keeps a separate sample for its session-client behavior; neither fixture
directory is a shared testing API.
