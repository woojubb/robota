# @robota-sdk/agent-transport-webrtc-web

Browser-side WebRTC transport. See [docs/SPEC.md](docs/SPEC.md) for its public contract.

Session-client tests retain their owner-local native-browser SDP fixture. Cross-dialect
fingerprint normalization is verified in the [pairing owner](../agent-remote-pairing/README.md),
so browser tests do not read another package's private fixture directory.
