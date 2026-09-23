---
'@robota-sdk/agent-session': major
'@robota-sdk/agent-provider-replay': major
'@robota-sdk/agent-framework': major
---

Require versioned, event-decoded session replay logs. Reject unknown, malformed, and unsupported
entries instead of dropping them or inventing message fields. Replay-only session loads and lists
report damaged logs explicitly. Legacy unversioned JSONL is not accepted; snapshot encoding remains
unchanged. Persisted logs now use schema version 1, and all replay entry points share the session-owned
decoder and preserve sidecar integrity failures.
