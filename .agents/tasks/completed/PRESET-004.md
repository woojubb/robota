# PRESET-004 — 번들 (모듈 델타 + 권한 포스처 + 실행 능력)

Spec: `.agents/spec-docs/active/PRESET-004-bundle-modules-permission-profile.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: enabledCommandModules whitelist → exactly those modules registered
- [x] TC-02: disabledCommandModules → module excluded
- [x] TC-03: enable+disable same module → excluded (deny > allow)
- [x] TC-04: no preset/default → 20 modules (no-regression)
- [x] TC-05: defaultPermissionMode preset → session permission mode matches
- [x] TC-06: autonomy 'act-first' (no explicit mode) → autonomous write mode
- [x] TC-07: autonomy 'ask-first' (no explicit mode) → ask-on-write mode
- [x] TC-08: enableParallelSubagents true → assembly enableAgentRuntime true + dispatch enabled
- [x] TC-09: selfVerification true → threaded to framework/executor option
- [x] TC-10: build (command+framework+cli) + typecheck exit 0

## Test Plan

agent-command `createDefaultCommandModules` gains enabled/disabled delta (deny > allow; no delta = all 20).
agent-preset `resolvePreset` derives `permissionMode` from `autonomy` when `defaultPermissionMode` absent
(ask-first→'default', act-first→'acceptEdits', balanced→'default'). agent-framework assembly applies
permissionMode + `enableAgentRuntime` (from enableParallelSubagents) + threads `selfVerification`. agent-cli
forwards resolved module-delta + options (shell). Integration/unit tests in agent-command (module set) +
agent-preset (autonomy→mode) + framework assembly (enableAgentRuntime/selfVerification threading). Build+typecheck smoke.
