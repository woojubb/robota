---
status: approved
type: SCREEN
tags: [cli, typescript]
lane: L1
---

# CLI-1988: P0 output styles: make response style a persistent, selectable, provider-neutral session prompt surface

Paired with `.agents/tasks/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md`. Arising from [issue #1988](https://github.com/woojubb/robota/issues/1988).

## Problem

Robota has no named output-style contract or interactive settings surface. A user can only alter
response shape through the process-boundary `--system-prompt` (replacement) or
`--append-system-prompt` (append) flags; those do not provide named discovery, persistence, or
in-session switching. Reproduce from a configured CLI session by trying to select a response style:
there is no `--output-style` flag and no `/output-style` command, while `/settings` only opens the
transport-toggle screen. The existing preset and prompt mechanisms cannot express a response style
without conflating identity/persona, one-shot prompt text, and persistent settings.

## Prior Art Research

### Reference re-read (2026-09-10)

The current reference is [Claude Code output styles](https://code.claude.com/docs/en/output-styles).
It still describes named built-ins (Default, Concise, Proactive, Explanatory, Learning), custom
Markdown styles with frontmatter, user/project/managed sources, system-prompt composition, main-chat
scope, settings selection, and style-specific prompt cost. The page also currently says that the
standalone `/output-style` command is deprecated/removed in favour of the settings picker and that a
style change takes effect on the next message while rebuilding the prompt cache once.

### Provider-neutral form

The style is a provider-neutral value `{ id, name, description, instructions,
keepCodingInstructions, tokenCost }`. It is appended to Robota's composed system prompt, so
Anthropic, OpenAI-compatible, Gemini, DeepSeek, Qwen, Gemma, and replay providers all receive the
same semantic instruction through the existing provider request path. A provider with no native
style parameter does not need a fallback: the style is prompt policy, not a provider option. The
provider still owns native message formatting, tool-call encoding, structured-output parameters, and
sampling; style selection never changes permission mode or provider capability.

### Repository seam survey

- `agent-preset` owns the instance-scoped preset registry and external JSON decoding. It is the
  correct owner for immutable built-in style values and a parallel Markdown style decoder, but it
  does not read settings or assemble sessions.
- `agent-framework` owns `ISystemPromptParams`, priority-sorted sections,
  `IInteractiveSessionStandardOptions`, `buildSessionSystemPrompt`, and the retained live rebuild
  closure. It is the only prompt owner and therefore the only place that can guarantee language,
  style, AGENTS/CLAUDE context, permissions, tools, and capabilities remain one composition.
- `agent-interface-command` owns the command host-action discriminator. `agent-command` already
  implements inline selection commands with `selectAction`, and its preset command demonstrates
  the registry adapter pattern.
- `agent-cli` owns CLI parsing, trusted contribution sources, user settings read/write, and the
  three startup mode projections. Its user settings adapter already provides the safe persistence
  boundary; its project reader already refuses links and out-of-root reads.
- `/settings` currently renders transport settings only. It has no generic style registry or
  selection protocol. The implementation therefore uses the same structured picker mechanism for
  `/output-style` and leaves the transport settings screen unchanged; a future unified screen can
  reuse the same registry/adapter without moving ownership into a renderer.

### Checklist verdicts

| Reference line | Verdict | Robota decision |
| --- | --- | --- |
| Default built-in | ADOPTED | `default` is listed and means the ordinary composed prompt; it emits no extra section. |
| Concise | ADOPTED | Built-in instructions lead with the result, omit routine preamble/narration, remain concise, and retain complete errors, security warnings, and destructive confirmations. |
| Proactive | ADAPTED | Built-in instructions favour immediate reasonable assumptions, but explicitly defer to the active permission mode; style never changes authorization. |
| Explanatory/Learning | ADOPTED | Both are built-ins; Learning asks the user to fill marked gaps rather than pretending certainty. |
| Markdown custom file | ADOPTED | `.md` files use the declared frontmatter plus body instructions. |
| User/project/managed levels | ADAPTED | User and trusted-project files are loaded by the CLI. Managed styles are an injected host source, never a user-writable path. Project ancestors are searched root-to-cwd and the nearest project definition wins. |
| Frontmatter fields | ADAPTED | `name`, `description`, and `keep-coding-instructions` are supported. `force-for-plugin` is parsed only by a plugin-aware host contract; this Task rejects it in ordinary files rather than silently enforcing it. |
| Custom replacement of engineering instructions | ADAPTED | `keepCodingInstructions` is preserved in the value and shown in diagnostics, but Robota always retains core safety, permission, project, tool, and capability sections. A custom style can add or omit optional style guidance, never remove security context. |
| Plugin-shipped styles | REJECTED | The current plugin bundle contract exposes commands/hooks, not output-style contributions. Adding a plugin style lifecycle is a separate plugin contract change; ordinary plugin files cannot become styles by convention. |
| Style appended to system prompt | ADOPTED | A priority-3 `output-style` section is composed before preset seed/persona and is present on every subsequent model request. |
| Mid-conversation reminders | ADAPTED | The persistent system-message section is re-sent by the provider adapter on each request; no extra user-message reminder is injected into history. |
| Read once / next session / cache cost | ADAPTED | Startup reads the selected style once; `/output-style` live-applies on the next turn. The spec and command output name the prompt-cache rebuild and per-style input-cost estimate. |
| Main conversation vs subagents/forks | ADOPTED | Main session only; subagents receive their own prompt and are not implicitly changed; forks inherit the assembled parent system message through existing fork persistence. |
| Settings key/UI; standalone command | ADAPTED | `outputStyle` is persisted in user settings and `/output-style` uses the existing structured selection UI. It remains a command because Robota's current `/settings` screen is transport-only; no second settings store is introduced. |
| Token cost | ADOPTED | Every built-in and custom style carries a `tokenCost` label (`baseline`, `low`, `medium`, `high`, or `unspecified`) shown in listings; the label is an estimate, not a provider token counter. |
| Boundary neighbours | ADOPTED | The final docs distinguish output styles from project memory, append-system-prompt, presets/personas, subagents, and skills, with a use-when rule for each. |
| `/language` interaction | ADOPTED | Language remains a separate priority-45 prompt section and wins only for language; style instructions cannot erase it. Live language/style changes rebuild one retained prompt closure. |

### Alternatives and sign-off

1. Add only `--output-style` and concatenate strings in `agent-cli`. Rejected: it would leave the
   interactive session, serve mode, forks, and alternate providers with different answers and would
   duplicate prompt composition.
2. Make output styles another `IPreset` field. Rejected: presets are bundles of model, posture, and
   command selection; this would make style identity and live style switching depend on preset
   application and would not support independent `/language` or settings selection.
3. Adopt the chosen design: a style registry in `agent-preset`, a neutral framework prompt section,
   a typed host action, and one CLI projection. Chosen because each existing owner gains exactly one
   responsibility and every surface consumes the same resolved value.

**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation

Independent delegated review is intentionally not used: the current user instruction prohibits
subagents and additional worktrees. Local adversarial review covered source ownership, trust-boundary
reads, fail-closed missing adapters, prompt ordering, provider neutrality, and the checklist table.

## Architecture Review

### Affected Scope

- `agent-command`
- `agent-preset`
- `agent-framework`
- `agent-interface-command`
- `agent-cli`

### Alternatives Considered

1. CLI-only flag and string concatenation.
   - Pro: smallest initial diff.
   - Con: does not reach interactive selection, serve mode, forks, settings, or non-Anthropic providers
     consistently; duplicates the existing prompt composition boundary.
2. Treat styles as another preset option.
   - Pro: reuses the existing preset registry.
   - Con: couples independent response shape to model/posture bundles and makes live style selection
     depend on preset application; custom style source levels still have no owner.
3. One style value/registry crossing existing owners.
   - Pro: one resolution and prompt composition path for all surfaces and providers; safe source
     ownership remains in the CLI.
   - Con: adds a small contract and adapter across four packages and requires explicit live state.

### Decision

**Alternative 3.** The additional typed seams are justified by the requirement that startup,
interactive, serve, fork, and provider-neutral behavior never drift. The design keeps core safety
sections non-removable even when custom style metadata requests replacement semantics.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — preset, command, prompt, settings, and transport settings seams surveyed
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: the `/output-style` command is owned by `agent-command`; its structured
      picker is an existing interaction surface, while style values remain outside renderers.

## Fallback & Degradation Declaration

Missing style registry, malformed style file, unknown style id, or unavailable settings adapter are
explicit failures. A malformed custom file is isolated and reported while valid files continue to
load. A missing project trust authority excludes project styles rather than reading the filesystem
directly. A style instruction is data and cannot disable the framework's permission, security, or
workspace-trust sections.

## Solution

Add a provider-neutral `IOutputStyle` value and `IOutputStyleRegistry` in `agent-preset`, with five
built-ins and Markdown decoding from injected sources. Add `outputStyle` to the one preset/session
projection only as a startup-selected value (it is not an `IPreset` option). Add a framework-owned
prompt section at priority 3 and a retained `outputStyle` live override alongside persona/language.
Add a typed `output-style-change` host action plus the `ICommandOutputStyleRegistryAdapter` and
session `applyOutputStyle`/active-id role seams. Implement `/output-style list|<id>` and no-argument
structured selection in `agent-command`; the host applies the style before returning the result and
writes `outputStyle` through the existing user settings adapter. Add `--output-style <id>`, load user
and trusted-project sources with managed injection, and forward the same projection to print, serve,
and TUI sessions. Keep system-prompt replacement and append flags independent.

Custom source precedence is: built-ins < user < trusted project (nearest ancestor wins) < managed
injected source. A same-level duplicate keeps the first file in deterministic lexical order and
records the later file as rejected. Custom styles default `keepCodingInstructions` to false in the
metadata, but the framework's mandatory core sections are never removed. A style change rebuilds the
live message for the next turn; it does not rewrite conversation history or trigger a provider
restart. The active style id is persisted in the user settings file only, because that is the existing
unconditional settings writer; project setting persistence remains the responsibility of a future
project-settings UI.

The feature is explicitly documented against neighbouring controls: use project memory for durable
facts, `--append-system-prompt` for one invocation, presets for bundled model/posture changes,
subagents for isolated delegated work, and skills for task-specific instructions.

## Affected Files

- `packages/agent-command/src/output-style/*`
- `packages/agent-preset/src/output-style-*` and built-in style definitions
- `packages/agent-framework/src/context/*`, `src/assembly/*`, `src/interactive/*`, and command host roles
- `packages/agent-interface-command/src/command-contracts.ts`
- `packages/agent-cli/src/utils/cli-args.ts`, `src/startup/*`, and all three mode projections
- affected package `docs/SPEC.md` files and focused tests

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-preset test -- output-style` and the named framework/command
      tests → exit 0; the new decoder, precedence, and built-in contract cases are green.
- [ ] TC-02: `pnpm --filter @robota-sdk/agent-interface-command typecheck && pnpm --filter @robota-sdk/agent-framework typecheck && pnpm --filter @robota-sdk/agent-command typecheck && pnpm --filter @robota-sdk/agent-cli typecheck` → exit 0.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-preset build && pnpm --filter @robota-sdk/agent-framework build && pnpm --filter @robota-sdk/agent-command build && pnpm --filter @robota-sdk/agent-cli build` → exit 0 with declarations exporting the new public contracts.
- [ ] TC-04: `pnpm harness:scan:specs` and the affected harness scans → exit 0; no forbidden direct project filesystem read or provider-specific style branch is introduced.
- [ ] TC-05: `robota --output-style concise --prompt \"Explain the current directory in one sentence\"` in the deterministic product fixture → exit 0 and the effective style is visible in the session output/record.
- [ ] TC-06: the interactive `/output-style list` → `/output-style <custom>` flow persists `outputStyle` in the user settings adapter and the next response uses the rebuilt prompt while retaining AGENTS/permissions/tool sections.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| --- | --- | --- | --- |
| TC-01 | Unit | Vitest in `agent-preset` plus framework prompt tests | Built-ins, Markdown validation, precedence, cost labels |
| TC-02 | Contract/type | package typechecks | New action/adapter/options remain type-safe across owners |
| TC-03 | Build | package builds | Public exports and bundled CLI remain consumable |
| TC-04 | Harness | specs and affected scans | Trust, dependency direction, exports, and documentation conformance |
| TC-05 | Product surface | deterministic CLI fixture | Startup flag reaches the same session prompt path |
| TC-06 | Product surface | scripted interactive session | list/select/live apply/persistence and retained safety sections |

## User Execution Test Scenarios

### Scenario 1 — select a built-in style at CLI startup

- **Surface:** Robota CLI one-shot mode.
- **Prerequisite:** A configured provider or the repository's deterministic replay fixture, and a
  shell in the repository root.
- **Action:** Run `robota --output-style concise --prompt \"Explain the current directory in one sentence\"`.
- **Expected observable:** Exit code 0; the response is concise and the run/session record identifies
  `concise`. Errors, security warnings, and destructive confirmations remain complete.
- **Cleanup:** No settings file is modified by the one-shot flag.
- **Evidence:** To be filled after implementation with command output and exit code.

### Scenario 2 — select and persist a custom style interactively

- **Surface:** Robota interactive command surface.
- **Prerequisite:** A valid `.robota/output-styles/brief.md` in a trusted project and a configured
  provider. The file contains frontmatter with `name`, `description`, and a response-format body.
- **Action:** Start `robota`; run `/output-style list`; choose `/output-style brief`; send a prompt
  asking for the configured format; start a new session and send another prompt.
- **Expected observable:** The list includes `brief` and its token-cost label; the switch succeeds;
  the next response follows the body while the composed AGENTS/permission/tool sections remain in
  effect; `~/.robota/settings.json` contains `outputStyle: \"brief\"`; the next session starts with
  `brief` unless an explicit CLI flag overrides it.
- **Cleanup:** Remove the temporary style file and restore/remove the prior `outputStyle` setting.
- **Evidence:** To be filled after implementation with command output, settings diff, and session
  result/log excerpt.

## Tasks

- [ ] `.agents/tasks/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** 81abe4d8affb (review bcb1993d, type/tags 966ba25d)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (81abe4d8affb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7e8c11f58009` · base `origin/develop@7e8c11f58009` · document `.agents/spec-docs/draft/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md` blob `48401eb4e83e` (untracked)

### [GATE-PLAN] — ❌ FAIL | 2026-09-10

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7e8c11f58009` · base `origin/develop@7e8c11f58009` · document `.agents/spec-docs/draft/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md` blob `80efab739e54` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: SCREEN` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 652 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 6 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 6 Test Plan rows = 6 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 6 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (81abe4d8affb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7e8c11f58009` · base `origin/develop@7e8c11f58009` · document `.agents/spec-docs/draft/CLI-1988-p0-output-styles-make-response-style-a-persistent-selectable-provider-neutral-se.md` blob `ffa2627e3bbc` (untracked)
