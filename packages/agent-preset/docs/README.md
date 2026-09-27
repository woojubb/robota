# agent-preset Docs

`@robota-sdk/agent-preset` owns the preset contract (`IPreset`), the built-in presets, the
instance-scoped preset registry with its precedence rules, loading of external preset files, and the
output-style catalog and registry. It depends only on `@robota-sdk/agent-framework`, whose session
option types a preset overrides.

## Documents

- [Package README](../README.md) — usage, the built-in presets and output styles.
- [SPEC.md](./SPEC.md) — package contract, precedence and design decisions.
