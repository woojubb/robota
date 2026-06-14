# PRESET-001 — agent-preset 패키지 기반 (IPreset + resolvePreset + default)

Spec: `.agents/spec-docs/active/PRESET-001-agent-preset-package-foundation.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: `packages/agent-preset/package.json` `name` = `@robota-sdk/agent-preset`
- [x] TC-02: `src` exports `IPreset` + `TResolvedPresetOptions`
- [x] TC-03: `IPreset.effort` enum includes `'xhigh'`/`'max'`
- [x] TC-04: `IPreset` has `enableParallelSubagents?: boolean` + `selfVerification?: boolean`
- [x] TC-05: `resolvePreset('default', base)` deep-equals base (no-op) — unit test
- [x] TC-06: `resolvePreset(id, { cliOverrides })` precedence merge (explicit > cliOverrides > preset > default) — unit test
- [x] TC-07: `listPresets()` includes `id === 'default'` — unit test
- [x] TC-08: `pnpm --filter @robota-sdk/agent-preset build` exit 0 + `check-dependency-direction.mjs` exit 0
- [x] TC-09: `pnpm harness:scan` exit 0
- [x] TC-10: agent-preset version == agent-core version
- [x] TC-11: `.changeset/config.json` fixed group includes `@robota-sdk/agent-preset`
- [x] TC-12: `publishConfig.access` = `public`, no `private: true`

## Test Plan

Unit tests (vitest) for the resolver/registry logic: `resolvePreset` no-op for `default` (TC-05),
precedence merge with `cliOverrides` (TC-06), `listPresets` contains `default` (TC-07). Type/contract
presence verified by `rg` over `src` (TC-02/03/04). Package scaffolding + registration verified by
command-form smoke: build + `check-dependency-direction.mjs` (TC-08), `harness:scan` (TC-09), version
match via `node -p` (TC-10), changeset fixed-group + publishConfig via `rg`/`node -p` (TC-11/12).
Build uses tsdown (ESM+CJS, dist/node), matching sibling `agent-interface-transport`.
