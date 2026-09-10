---
status: done
type: FLOW
lane: L2
tags: [cli, typescript, async]
---

# FLOW-008: Resolve and expose active model effort across CLI, settings, environment, and live sessions

## Problem

Robota already carries a concrete `TModelEffort` from presets into a provider request, and a live
`/preset` switch can re-apply it. The user-facing flow is incomplete: there is no `--effort` launch
flag, no environment or settings resolution, no live `/effort` command, no single result describing
the requested and active values, and no consistent status/print/hook projection. Consequently the
same session can receive different answers depending on whether its effort came from a preset at
startup or from a live command, while a user cannot tell whether a requested value was applied.

The reproduction is a CLI launch with a configured preset and `ROBOTA_EFFORT` set, followed by a live
effort change or a print-mode invocation. The current parser rejects `--effort`, the settings value is
not considered, and the TUI status bar and headless result do not expose the active effort. A provider's
model-specific clamp or unsupported outcome is not invented here; API-001 owns that capability decision,
and this flow must project the typed outcome it receives.

## Prior Art Research

Official product and API documentation was reviewed on 2026-09-11:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config) documents model-dependent
  effort levels, `/effort`, `--effort`, environment/settings inputs, model defaults, persistence, and
  visible current effort. It also separates reasoning amount from thinking display.
- [Claude Code configuration](https://code.claude.com/docs/en/configuration) documents the persisted
  `effortLevel` setting and the distinction between persistent levels and session-only `max`.
- [Claude Code environment variables](https://code.claude.com/docs/en/env-vars) documents an effort
  environment variable accepting named levels, `max`, and `auto`.
- [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) documents that
  `reasoning.effort` is model-dependent and that defaults vary by model.
- [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai#thinking) documents the
  mapping between OpenAI reasoning effort and Gemini thinking controls, including model-dependent
  support and the rule that overlapping native and compatibility controls must not be sent together.

The common constraint is that effort is a request-control selection, not a portable numeric guarantee:
the active model determines the available/default outcome, and the interface must show what was
requested and what became effective. Robota therefore adopts one flow-level resolution record while
leaving provider capability mapping to API-001. The resolution order for this Task is explicit launch
flag, environment, persisted setting, selected preset, then the active model default. This treats a
one-invocation flag as the strongest user instruction while preserving environment authority over
persistent configuration; the existing parent scenario requires this ordering for `--effort high` to
win over `ROBOTA_EFFORT=medium`.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/command-api/` — public session effort result and host/session ports.
- `packages/agent-framework/src/effort/` — provider-neutral input parsing and precedence/result types.
- `packages/agent-command/src/effort/` — built-in `/effort` command, picker, and command tests.
- `packages/agent-cli/src/utils/cli-args.ts` — `--effort` parsing and validation.
- `packages/agent-cli/src/startup/` — environment/settings/preset resolution and command-module wiring.
- `packages/agent-cli/src/modes/print-mode.ts` — structured print-mode effort outcome.
- `packages/agent-transport-tui/src/StatusBar.tsx` and `SessionStatusBar.tsx` — active effort display.
- `packages/agent-cli/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md`,
  `packages/agent-command/docs/SPEC.md`, and `packages/agent-transport-tui/docs/SPEC.md` — live contract
  sections affected by new public behavior/types.

### Alternatives Considered

1. **Add independent effort handling to each surface.** Pro: small local edits. Con: precedence,
   persistence, and active-value drift would recur between startup, `/effort`, print mode, and TUI.
2. **Put all effort behavior in the CLI.** Pro: one product has one implementation. Con: reusable
   command modules and embedded framework hosts could not expose the same live command or typed result,
   and the CLI would bypass the existing host-adapter boundary.
3. **Use one framework resolution/result contract, with CLI composition and command-module projections.**
   Pro: one source of truth reaches all surfaces, while settings I/O and provider capabilities remain
   owned by their existing layers. Con: the public framework contract and several package specs must
   evolve together.

### Decision

Choose alternative 3. `agent-framework` owns the provider-neutral request selection and typed
resolution record; the CLI supplies launch-time sources and settings persistence; `agent-command` owns
the `/effort` command and picker; the TUI and headless channel only render/project the result. The
record includes `requested`, `effective`, `source`, and a disposition that distinguishes exact
application, model default, downward clamp, and not-applied outcomes. API-001 supplies provider/model
capability resolution and may enrich the disposition without moving source precedence into provider
adapters. DATA-007 consumes the effective provider semantics for cache identity.

The design was checked for reachability across startup, live command, embedded framework hosts, print
mode, TUI status, and hook-facing execution data; it preserves the existing concrete `TModelEffort`
request channel; and its adversarial cases include invalid external values, explicit `auto`, model
switches, persistence boundaries, headless execution, cancellation, unsupported providers, and stale
status projections. Thinking display controls and ordinary prompt wording remain separate and cannot
mutate effort state.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — CLI startup/print/TUI, framework command ports, and built-in command modules checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add a framework-owned effort selection/result contract. `auto` remains a request selection and is
   resolved through the active model-default resolver; it is never stored as a concrete provider
   effort. The source order is `flag > environment > settings > preset > model-default`.
2. Parse `--effort` and `ROBOTA_EFFORT`, validate settings values at the untrusted boundary, and
   preserve invalid values as explicit startup/command errors rather than silently choosing a level.
3. Add the built-in `/effort [auto|low|medium|high|xhigh|max]` command. With an argument it applies the
   resolved value to the live session; without an argument it uses the existing picker when available
   and otherwise reports the current result. Session-only values are not written to settings; persistent
   named values are written only through the injected settings adapter.
4. Project the same result into TUI status, print-mode text/JSON, and hook-facing execution metadata.
   A provider-specific clamp or unsupported result is displayed, not rewritten by a surface.
5. Keep `thinking` display settings and one-turn prompt words independent. Ordinary words such as
   “think harder” do not change the persistent or session effort selection.

## Affected Files

- `packages/agent-framework/src/effort/effort-resolution.ts`
- `packages/agent-framework/src/command-api/session-roles.ts`
- `packages/agent-framework/src/command-api/host-adapters.ts`
- `packages/agent-framework/src/command-api/index.ts`
- `packages/agent-framework/src/transport-host/headless/HeadlessInteractionChannel.ts`
- `packages/agent-command/src/effort/effort-command.ts`
- `packages/agent-command/src/effort/effort-command-module.ts`
- `packages/agent-command/src/effort/index.ts`
- `packages/agent-command/examples/verify-semantic-command-roles.ts` — compatibility fixture for the
  required session effort projection used by the semantic command-role scenario
- `packages/agent-command/src/default/default-command-modules.ts`
- `packages/agent-cli/src/utils/cli-args.ts`
- `packages/agent-cli/src/startup/effort-resolution.ts`
- `packages/agent-cli/src/startup/command-setup.ts`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/modes/print-mode.ts`
- `packages/agent-transport-tui/src/StatusBar.tsx`
- `packages/agent-transport-tui/src/SessionStatusBar.tsx`
- focused tests beside each changed module
- the four affected package `docs/SPEC.md` files listed in Affected Scope

## Completion Criteria

- [x] TC-01: `parseCliArgs(['--effort', 'high'])` returns `effort: 'high'`, rejects an unknown value
      with a named validation error, and `--effort` is present in the built CLI help.
- [x] TC-02: Given flag, environment, settings, preset, and model-default inputs, the resolution
      result selects exactly `flag > environment > settings > preset > model-default`; `auto` reports
      the active model default rather than a separate global level.
- [x] TC-03: `/effort low`, `/effort auto`, and the no-argument picker update or report one live session
      result; a cancelled picker leaves the previous result unchanged; persistent values are written
      only when the selected policy permits persistence.
- [x] TC-04: TUI status and print-mode text/JSON expose the same requested, effective, source, and
      disposition fields, including explicit clamp/not-applied values supplied by the capability seam.
- [x] TC-05: Hook-facing execution metadata carries the effective effort result, and ordinary thinking
      display settings or prompt words do not mutate it.
- [x] TC-06: The affected package builds/tests, SPEC conformance, harness scans, and
      `pnpm harness:verify-like-ci` pass with no unresolved scope drift.

## Test Plan

| TC-ID | Test Type           | Tool / Approach                                                                | Notes                                                                                                                                                                                                              |
| ----- | ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TC-01 | Process integration | Vitest parser/help tests plus built CLI `--help` spawn                         | `packages/agent-cli/src/utils/__tests__/cli-args.test.ts`; covers the CLI surface and invalid input.                                                                                                               |
| TC-02 | Process integration | Vitest resolution matrix and startup composition tests                         | `packages/agent-framework/src/effort/effort-resolution.test.ts`; uses injected environment/settings/model-default inputs.                                                                                          |
| TC-03 | Process integration | `agent-command` command-module tests with scripted picker and settings adapter | `packages/agent-command/src/effort/effort-command.test.ts`; tests apply, auto, cancellation, and persistence without a live provider.                                                                              |
| TC-04 | Process integration | Headless channel and TUI status rendering tests                                | `packages/agent-framework/src/transport-host/headless/__tests__/headless-runner.test.ts`; `packages/agent-transport-tui/src/__tests__/status-bar.test.tsx`; verifies text/JSON/status projections read one result. |
| TC-05 | Process integration | Hook input/metadata test and negative thinking-keyword test                    | `packages/agent-session/src/__tests__/selfhost-009-model-call-hooks.test.ts`; keeps reasoning amount separate from display.                                                                                        |
| TC-06 | Repository gate     | package builds/tests, `pnpm harness:scan`, `pnpm harness:verify-like-ci`       | `pnpm harness:verify-like-ci`; CI-equivalent command is the final engineering gate.                                                                                                                                |

## Tasks

- [x] `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`

## User Execution Test Scenarios

The built CLI is the product surface. Build it from the repository root, set
`REPO_ROOT="$(pwd)"`, `ROBOTA_BIN="$REPO_ROOT/packages/agent-cli/bin/robota.cjs"`,
`PROBE_ROOT="$(mktemp -d)"`, `PROBE_HOME="$PROBE_ROOT/home"`, and
`PROBE_PROJECT="$PROBE_ROOT/project"`. Create an isolated `.robota/settings.json` in
`PROBE_HOME` with a configured dummy provider; these commands end at `/effort` before a model request.

### Scenario 1

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `robota --effort high -p "/effort" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=source=flag
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: 2026-09-11 KST built CLI exit=0; JSON result contains source=flag.

### Scenario 2

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `robota -p "/effort low" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=requested=low
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: 2026-09-11 KST built CLI exit=0; JSON result contains requested=low.

### Scenario 3

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `robota -p "/effort auto" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=disposition=model-default
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: 2026-09-11 KST built CLI exit=0; JSON result contains disposition=model-default.

### Scenario 4

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: built CLI and isolated dummy-provider settings exist under PROBE_HOME
- command: `robota --effort max -p "/effort" --output-format json --no-session-persistence`
- observable type: product-output
- expected observable: exit=0; output-contains=disposition=applied
- observable rationale: source=product-process
- cleanup: rm -rf -- "$PROBE_ROOT"
- evidence: 2026-09-11 KST built CLI exit=0; JSON result contains requested=max and disposition=applied.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status upgrade:** draft → review-ready

- GATE-WRITE — frontmatter: `status: draft`, `type: FLOW`, `lane: L2`, and `tags` are present.
- GATE-WRITE — Problem: concrete CLI symptom and reproduction condition are stated in multiple sentences.
- GATE-WRITE — Prior Art Research: official product/API documentation is cited, and the findings feed the alternatives and decision.
- GATE-WRITE — Architecture Review: affected layers, sibling scan, three alternatives with trade-offs, and the chosen decision are recorded.
- GATE-WRITE — Completion Criteria: six distinct `TC-NN` observable criteria are defined.
- GATE-WRITE — Test Plan: one non-empty test row exists for each of the six criteria; no manual row is used.
- GATE-WRITE — structure: Tasks and Evidence Log sections are present; no forbidden body status section exists.
- GATE-WRITE — semantic self-review: PASS. The user explicitly prohibited subagents and additional worktrees, so this is a single-agent review and is not represented as independent review. The problem names exact CLI/command/status surfaces; the research is used in the precedence decision; the selected framework contract mirrors the existing command/session host layering rather than introducing a sibling product dependency; and each criterion maps to a distinct flow behavior.

**Judged by:** `single-agent semantic review under the user's no-subagent/no-worktree constraint`

**Judged at:** HEAD `7fa78d9a87de` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/draft/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live.md` blob `1c6a978f233d` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-11, this conversation
**Review fingerprint:** c07daa77423c (review 920575ba, type/tags a55796ea)

**Semantic approval review:** PASS. The existing user instruction “다 사전승인함” is treated as direct
approval for this already identified FLOW-008 work. The selected design is limited to the existing
framework command/session ports and the existing CLI/TUI projection path; provider capability policy
and cache identity remain with API-001 and DATA-007. The stated precedence and persistence choices are
observable, testable, and consistent with the approved FLOW-008 scenario.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c07daa77423c) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7fa78d9a87de` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/backlog/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live.md` blob `054154afa98e` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-11

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`, whose basename is not the spec's (FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live.md)
  **Required action:** pair the Task and the spec by basename
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/6 TC ids and carries 0 checkbox task(s)
  **Required action:** one task per TC-N

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7fa78d9a87de` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/todo/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live.md` blob `0817cc5afd81` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-11

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-11; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 391 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 4`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md",
  "specPath": ".agents/spec-docs/todo/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 4
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md",
    ".agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7fa78d9a87de` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/todo/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `c924c18b6d05` (untracked)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-11

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm harness:scan` → exit 1 ( ⏎ 1 of 161 scans failed ⏎  ELIFECYCLE  Command failed with exit code 1.); `pnpm --filter @robota-sdk/agent-cli build` → exit 0 ([33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../agent-builtin-providers/dist/node/index.js is dynamically imported by ../dag-nodes-default/dist/node/index.js but also statically imported by src/eval/eval-command.ts, src/product/robota-subagent-composition.ts, src/startup/command-setup.ts, src/startup/diagnose-command.ts, src/startup/provider-startup.ts, dynamic import will not move module into another chunk. ⏎ ⏎ [33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../dag-nodes-default/dist/node/index.js is dynamically imported by ../dag-framework/dist/node/index.js but also statically imported by ../agent-command-workflows/dist/node/index.js, dynamic import will not move module into another chunk.); `pnpm --filter @robota-sdk/agent-framework test -- --run src/effort/effort-resolution.test.ts` → exit 0 ( Duration 238ms (transform 104ms, setup 0ms, collect 121ms, tests 2ms, environment 0ms, prepare 28ms) ⏎ ⏎ 1:50:08 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm harness:scan` → exit 1 ( ⏎ 1 of 161 scans failed ⏎  ELIFECYCLE  Command failed with exit code 1.); `pnpm --filter @robota-sdk/agent-cli build` → exit 0 ([33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../agent-builtin-providers/dist/node/index.js is dynamically imported by ../dag-nodes-default/dist/node/index.js but also statically imported by src/eval/eval-command.ts, src/product/robota-subagent-composition.ts, src/startup/command-setup.ts, src/startup/diagnose-command.ts, src/startup/provider-startup.ts, dynamic import will not move module into another chunk. ⏎ ⏎ [33m[INEFFECTIVE_DYNAMIC_IMPORT] [0m../dag-nodes-default/dist/node/index.js is dynamically imported by ../dag-framework/dist/node/index.js but also statically imported by ../agent-command-workflows/dist/node/index.js, dynamic import will not move module into another chunk.); `pnpm --filter @robota-sdk/agent-framework test -- --run src/effort/effort-resolution.test.ts` → exit 0 ( Duration 238ms (transform 104ms, setup 0ms, collect 121ms, tests 2ms, environment 0ms, prepare 28ms) ⏎ ⏎ 1:50:08 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.)
  **Required action:** make every verify command exit 0

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `8db27029a0d6` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-11

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — All six Task plan items are checked `[x]`; none is blocked or pending.
- GATE-VERIFY — `pnpm --filter @robota-sdk/agent-cli build` → exit 0; the complete
  `pnpm harness:verify-like-ci` run passed its 9 applicable checks, including build,
  package-quality, binary E2E, and TUI PTY E2E.
- GATE-VERIFY — Affected framework, CLI, command, session, core, and TUI test suites passed;
  the final CI-equivalent run reported CLI 512 passed/18 skipped, binary E2E 10 passed, and
  TUI PTY E2E 32 passed.
- GATE-VERIFY — The only scan failure observed after checking completion boxes was the expected
  task-archival hold while this active Task/spec pair awaited GATE-COMPLETE and its move; no
  product, contract, or scope scan failed. The scan is re-run after completion.
- Semantic completion review: the implementation, paired Task/spec, affected contracts, user
  scenarios, and verification evidence were reviewed in this single-agent session. The user
  explicitly prohibited multi-agent/worktree use, so no additional agent dispatch was made;
  no unresolved semantic residue remains.

**Judged by:** single-agent completion evidence review
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-11

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Task plan: all six items are checked `[x]`, with no blocked or pending item.
- GATE-VERIFY — Build: `pnpm --filter @robota-sdk/agent-cli build` exited 0, and
  `pnpm harness:verify-like-ci` passed all 9 applicable checks.
- GATE-VERIFY — Tests: affected framework, CLI, command, session, core, and TUI suites passed;
  the CI-equivalent run reported CLI 512 passed/18 skipped, binary E2E 10 passed, and TUI PTY
  E2E 32 passed.
- GATE-VERIFY — Scan disposition: the post-checkbox scan had only the expected task-archival hold
  pending the immediate GATE-COMPLETE move; no product, contract, or scope scan failed.
- GATE-VERIFY — Semantic review: implementation, paired documents, contracts, scenarios, and
  evidence were reviewed in this single-agent session; no unresolved semantic residue remains.

**Judged by:** single-agent completion evidence review
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-11

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — All six Task plan items are checked `[x]`; none is blocked or pending.
- GATE-VERIFY — `pnpm --filter @robota-sdk/agent-cli build` → exit 0; the complete
  `pnpm harness:verify-like-ci` run also passed its 9 applicable checks, including build,
  package-quality, binary E2E, and TUI PTY E2E.
- GATE-VERIFY — Framework, CLI, command, session, core, and TUI tests passed in the affected
  package runs; the final CI-equivalent run reported CLI 512 passed/18 skipped, binary E2E
  10 passed, and TUI PTY E2E 32 passed.
- GATE-VERIFY — `pnpm harness:scan` was re-run after ticking the completion boxes and reported
  only the expected task-archival hold while the active Task/spec pair awaits the completion
  move; no product, contract, or scope scan failed. The pair is being completed immediately
  after GATE-COMPLETE and the scan will be re-run after that move.
- Semantic completion review: the implementation, paired Task/spec, affected package contracts,
  user scenarios, and verification evidence were reviewed in this single-agent session. The
  user has explicitly prohibited multi-agent/worktree use, so no additional agent dispatch was
  made; no unresolved semantic residue remains.

**Judged by:** single-agent completion evidence review
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-cli test`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `a84ef5568701` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-framework test -- --run src/effort/effort-resolution.test.ts`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `b71a7b77a941` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-command test`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `bb6a57f9cb75` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-framework test -- --run src/transport-host/headless/__tests__/headless-runner.test.ts; pnpm --filter @robota-sdk/agent-transport-tui test`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `a869442b6427` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-11

**Command:** `pnpm --filter @robota-sdk/agent-session test`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `95893a31d84b` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-11

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
Exit: 0
Output: headless focused tests 18 passed; TUI Test Files 89 passed; Tests 800 passed

TC-05: pnpm --filter @robota-sdk/agent-session test
Exit: 0
Output: Test Files 50 passed; Tests 366 passed | 20 skipped

TC-06: pnpm harness:verify-like-ci
Exit: 0
Output: PASS — 9 checks executed, 2 not applicable, 8 execution batches; required coverage satisfied. Binary E2E 10 passed; TUI PTY E2E 32 passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `ddaac80ddaf9` (modified)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-11

**Status remains:** in-progress
**Failed criteria:**

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: status is `in-progress`, `verifying` expected
  **Required action:** run the prior gate to PASS first

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `d33117de3be0` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-11

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — Task plan: all six items are checked `[x]`, with no blocked or pending item.
- GATE-VERIFY — Build: `pnpm --filter @robota-sdk/agent-cli build` exited 0, and
  `pnpm harness:verify-like-ci` passed all 9 applicable checks.
- GATE-VERIFY — Tests: affected framework, CLI, command, session, core, and TUI suites passed;
  the CI-equivalent run reported CLI 512 passed/18 skipped, binary E2E 10 passed, and TUI PTY
  E2E 32 passed.
- GATE-VERIFY — Scan disposition: the post-checkbox scan had only the expected task-archival hold
  pending the immediate GATE-COMPLETE move; no product, contract, or scope scan failed.
- GATE-VERIFY — Semantic review: implementation, paired documents, contracts, scenarios, and
  evidence were reviewed in this single-agent session; no unresolved semantic residue remains.

**Judged by:** single-agent completion evidence review
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-11

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-11; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (6)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 6/6 tasks `[x]` in .agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `91a762d26247` · base `origin/develop@7fa78d9a87de` · document `.agents/spec-docs/active/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md` blob `ac58de1c4936` (modified)
