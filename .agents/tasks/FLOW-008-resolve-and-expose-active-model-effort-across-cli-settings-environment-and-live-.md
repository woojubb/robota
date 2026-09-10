---
title: 'FLOW-008: resolve and expose active model effort across CLI, settings, environment, and live sessions'
issue: https://github.com/woojubb/robota/issues/1987
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: agent-cli, agent-framework, agent-session
depends_on: []
---

# FLOW-008: user-facing effort resolution and visibility

## Objective

Provide one session-level resolution authority and user flow for model effort. Presets already reach
startup and live re-application, but the CLI has no launch flag, environment/settings resolution,
`/effort` command, active-level display, print-mode feedback, or hook exposure. Adding those as
independent switches would create precedence drift; this Task owns the end-to-end flow and persistence
decisions.

## Plan

1. [x] Research current product behavior and explicitly adopt, adapt, or reject every session/control/
   visibility checklist row from issue #1987 in the paired FLOW-008 spec.
2. [x] Define the typed resolution result and the single source-precedence decision in the paired spec.
3. [ ] Wire settings, environment, launch flag, preset/configured level, `auto`, live command/picker,
   print mode, persistence policy, status visibility, and hook fields through that authority.
4. [ ] Keep thinking display and one-turn prompt keywords separate from persistent effort, with tests for
   both adjacent controls.

Paired spec: `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`.

TC mapping for the implementation checkpoint:

- [ ] TC-01: add and validate the `--effort` flag and help text.
- [ ] TC-02: implement one source-precedence resolver and `auto` handling.
- [ ] TC-03: implement the live command, picker, cancellation, and persistence policy.
- [ ] TC-04: project the result to TUI and print surfaces.
- [ ] TC-05: project hook metadata and keep thinking controls independent.
- [ ] TC-06: run the package and repository verification gates.

## Completion Criteria

- All supported input sources obey one documented and tested precedence order.
- `auto` returns to the active model's default rather than hard-coding a global level.
- Persistence is deliberate per level; session-only values do not leak into settings.
- Interactive, print, and hook surfaces show the effective outcome, including clamp/not-applied states.
- Thinking display remains an independent control.

## Test Plan

- CLI parser/settings/environment precedence unit tests and process integration tests.
- Interactive command tests for picker, explicit level, auto, persistence, and restart.
- Print-mode tests for applied, clamped, and not-applied feedback.
- Header/footer and hook payload/environment assertions.
- Affected package builds, `pnpm harness:scan`, and CI-equivalent verification before merge.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 4`

The built CLI is the product surface. Build the CLI from the repository root, set
`REPO_ROOT="$(pwd)"`, `ROBOTA_BIN="$REPO_ROOT/packages/agent-cli/bin/robota.cjs"`,
`PROBE_ROOT="$(mktemp -d)"`, `PROBE_HOME="$PROBE_ROOT/home"`, and
`PROBE_PROJECT="$PROBE_ROOT/project"`, then create an isolated settings file with the existing
dummy-provider startup shape. The commands below complete before a model request, so they need no
network connection or provider key.

Expected: every command reports one effective value and its source; a cancelled picker leaves that
value unchanged; ordinary prompt wording and thinking-display settings do not change it. The settings
file comparison is part of the implementation evidence: session-only selections must not leak into
settings, while a persistent named selection is written only when its policy allows it. Evidence:
pending implementation.

### Scenario 1

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `pnpm exec robota --effort high -p "/effort" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=source=flag
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: pending implementation

### Scenario 2

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `pnpm exec robota -p "/effort low" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=requested=low
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: pending implementation

### Scenario 3

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `pnpm exec robota -p "/effort auto" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=disposition=applied
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: pending implementation

### Scenario 4

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `pnpm exec robota --effort max -p "/effort" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=disposition=applied
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: pending implementation

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-11

**Status upgrade:** scenario drafted → scenario written

- Scenario set is executable against the shipped CLI; every scenario includes executability, prerequisites, command, expected observable, cleanup, and evidence fields, and the observed output is product behavior.

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --effort high -p \"/effort\" --output-format json --no-session-persistence",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=source=flag",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "built CLI and isolated dummy-provider settings exist under PROBE_HOME",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --effort high -p \"/effort\" --output-format json --no-session-persistence"
      },
      "expectedObservable": "exit=0; output-contains=source=flag",
      "cleanup": "rm -rf -- \"$PROBE_ROOT\"",
      "evidence": "pending implementation"
    },
    {
      "name": "Scenario 2",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota -p \"/effort low\" --output-format json --no-session-persistence",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=requested=low",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "built CLI and isolated dummy-provider settings exist under PROBE_HOME",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota -p \"/effort low\" --output-format json --no-session-persistence"
      },
      "expectedObservable": "exit=0; output-contains=requested=low",
      "cleanup": "rm -rf -- \"$PROBE_ROOT\"",
      "evidence": "pending implementation"
    },
    {
      "name": "Scenario 3",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota -p \"/effort auto\" --output-format json --no-session-persistence",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=disposition=applied",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "built CLI and isolated dummy-provider settings exist under PROBE_HOME",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota -p \"/effort auto\" --output-format json --no-session-persistence"
      },
      "expectedObservable": "exit=0; output-contains=disposition=applied",
      "cleanup": "rm -rf -- \"$PROBE_ROOT\"",
      "evidence": "pending implementation"
    },
    {
      "name": "Scenario 4",
      "surface": "robota-cli",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --effort max -p \"/effort\" --output-format json --no-session-persistence",
      "observableType": "product-output",
      "observable": "exit=0; output-contains=disposition=applied",
      "observableRationale": "source=product-process",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "built CLI and isolated dummy-provider settings exist under PROBE_HOME",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --effort max -p \"/effort\" --output-format json --no-session-persistence"
      },
      "expectedObservable": "exit=0; output-contains=disposition=applied",
      "cleanup": "rm -rf -- \"$PROBE_ROOT\"",
      "evidence": "pending implementation"
    }
  ]
}
```
<!-- checkpoint-evidence:v1:end -->
