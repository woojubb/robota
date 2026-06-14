# PRESET-003 — 페르소나 합성 (priority/source 섹션 메커니즘) + agentName 소유권

Spec: `.agents/spec-docs/active/PRESET-003-persona-system-prompt-composition.md`

## Plan (one task per Completion Criterion)

- [x] TC-01: `'persona'` in `TSystemPromptSectionSource`; `createPersonaSection('x')` → `source === 'persona'`
- [x] TC-02: `createPersonaSection('x').priority === 5` (5 < 10) — unit test
- [x] TC-03: preset persona text appears as substring in composed system message — integration test
- [x] TC-04: persona text AND runtime base-section markers both present — integration test
- [x] TC-05: index(persona) < index(runtime/project-instruction marker) via priority sort — integration test
- [x] TC-06: default (empty persona) → no persona section, identical to runtime-only (no-regression)
- [x] TC-07: agentName from preset applied; default agentName sourced from agent-preset (not cli)
- [x] TC-08: `rg "agentName: 'robota-cli'" packages/agent-cli/src/cli.ts` → 0 matches
- [x] TC-09: build (agent-cli + agent-framework + agent-preset) + typecheck exit 0

## Test Plan

Framework system-prompt mechanism: add `'persona'` source + `createPersonaSection` (priority 5) + `persona?`
param in `buildSystemPrompt`; the EXISTING `composeSystemPrompt` priority sorter places it (no hardcoded slot).
Unit tests (vitest, agent-framework) for source/priority (TC-01/02). Integration tests asserting composed
system message contents + priority ordering + no-regression for empty persona (TC-03..06). agent-preset IPreset
gains `persona?`; default agentName const owned by agent-preset; agentName application in framework assembly
(TC-07). cli literal removal verified by rg (TC-08). Build+typecheck smoke across the 3 packages (TC-09).
