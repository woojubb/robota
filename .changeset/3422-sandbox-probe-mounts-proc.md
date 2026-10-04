---
'@robota-sdk/agent-tools': patch
---

The bubblewrap availability probe now mounts `/proc` the way every confined command does. Where
`/proc` cannot be mounted — a container that masks it, such as Docker without
`--security-opt systempaths=unconfined` — the sandbox was reported available and each confined
command then failed with `Can't mount proc on /newroot/proc`, so `sandbox.failIfUnavailable` never
refused to start. Such a host is now reported unavailable with that reason.
