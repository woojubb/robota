---
'@robota-sdk/dag-framework': patch
---

Stop `text-replace` from ever running a regex on the host's main thread. `createDagFramework`'s default executor now isolates the default regex operation the same way the local Node provider already does, and the node itself no longer falls back to inline `RegExp` execution when no isolated operation is supplied — a pathological pattern can no longer freeze the host process, including its own cancel and status endpoints.
