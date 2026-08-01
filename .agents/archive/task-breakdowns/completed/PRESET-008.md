# PRESET-008 — effort → 모델 호출 배선

Spec: `.agents/spec-docs/active/PRESET-008-effort-model-invocation-wiring.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: resolved effort reaches the provider request param (native-effort provider) — unit/integration
- [x] TC-02: effort unset → default 'high' applied to provider request
- [x] TC-03: provider without native effort ignores it without error + documented no-op (rg doc)
- [x] TC-04: build + typecheck exit 0 for changed packages

## Test Plan

agent-framework threads resolved `effort` (default 'high' when unset) from session/assembly options into the
provider invocation. agent-provider request builders map `effort` to the native param where supported
(anthropic/openai), else a documented graceful no-op (deepseek/qwen) noted in provider SPEC/docs. Unit tests
on provider request builders assert effort presence/default/absence (TC-01/02/03) + doc `rg` (TC-03). Build+typecheck (TC-04).
