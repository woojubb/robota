# @robota-sdk/agent-provider-replay

## 3.0.0-beta.82

### Patch Changes

- Updated dependencies [c7f9203]
  - @robota-sdk/agent-core@3.0.0-beta.82
  - @robota-sdk/agent-session@3.0.0-beta.82

## 3.0.0-beta.81

### Patch Changes

- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [ec5e477]
- Updated dependencies [18b52cc]
- Updated dependencies [9843fe6]
  - @robota-sdk/agent-core@3.0.0-beta.81
  - @robota-sdk/agent-session@3.0.0-beta.81

## 3.0.0-beta.80

### Major Changes

- 242a644: Require versioned, event-decoded session replay logs. Reject unknown, malformed, and unsupported
  entries instead of dropping them or inventing message fields. Replay-only session loads and lists
  report damaged logs explicitly. Legacy unversioned JSONL is not accepted; snapshot encoding remains
  unchanged. Persisted logs now use schema version 1, and all replay entry points share the session-owned
  decoder and preserve sidecar integrity failures.

### Minor Changes

- b078afa: Restore full-fidelity replay for session-log values externalized to content-addressed sidecar files.

  `agent-session` now exports a bounded, containment- and integrity-checked recursive payload resolver,
  hydrates JSONL logs at their read boundary, and rejects unresolved replay-substrate values during raw
  validation. `agent-provider-replay` reuses that resolver for direct construction and file loading so
  large recorded responses remain aligned with later calls.

### Patch Changes

- Updated dependencies [7b6234c]
- Updated dependencies [5307f8a]
- Updated dependencies [b462ee7]
- Updated dependencies [4eea54b]
- Updated dependencies [30e5e50]
- Updated dependencies [1698be4]
- Updated dependencies [9368d00]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [a5cc36e]
- Updated dependencies [d23c848]
- Updated dependencies [807d161]
- Updated dependencies [fec722f]
- Updated dependencies [b078afa]
- Updated dependencies [b078afa]
- Updated dependencies [2ebff01]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [64ba748]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [6085cad]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [bed26ea]
- Updated dependencies [4b76cfa]
- Updated dependencies [fcb0da3]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [ebd40a0]
- Updated dependencies [d6b9404]
- Updated dependencies [9814afc]
- Updated dependencies [242a644]
  - @robota-sdk/agent-core@3.0.0-beta.80
  - @robota-sdk/agent-session@3.0.0-beta.80

## 3.0.0-beta.79

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.79
- @robota-sdk/agent-session@3.0.0-beta.79

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-session@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-session@3.0.0-beta.77
