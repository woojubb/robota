---
status: draft
type: AGREEMENT
lane: L0
tags: [cli, typescript]
---

# AGREEMENT-004: Provider-neutral model-effort control

Paired with
`.agents/tasks/AGREEMENT-004-coordinate-model-effort-control-semantics-across-session-overrides-providers-and.md`
and converted from [issue #1987](https://github.com/woojubb/robota/issues/1987).

## Problem

Robota already carries `TModelEffort` through presets and core provider calls and maps it for OpenAI
Responses, so issue #1987's claim that no request-side seam exists is false. The partial seam is not a
complete product contract:

- no single authority resolves requested, effective, and actually applied effort across settings,
  environment, launch flags, live commands, scoped skills/subagents, and model defaults;
- skill metadata parses an arbitrary effort string but execution does not apply it, while issue #2094
  waits for this issue to define the semantics its strict decoder must consume;
- provider capability data cannot express model-specific tiers/defaults/degradation, and the current
  Anthropic, Gemini, and OpenAI request behavior is incomplete or stale;
- execution-cache keys omit effort, so a response produced at one level can satisfy another.

These defects reproduce when a user tries to change cost/quality per task, invokes a scoped override,
selects a level unsupported by the active model, or repeats a prompt through the execution cache.

## Prior Art Research

Official product/API references re-read on 2026-08-29:

- [Claude Code model configuration](https://code.claude.com/docs/en/model-config) exposes model-dependent
  named effort levels, `/effort`, launch/environment/settings inputs, scoped skill/subagent overrides,
  precedence, persistence, visibility, and cache invalidation behavior.
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort) defines request-level
  `output_config.effort`, model-dependent support, a high API default, and prompt-cache invalidation
  when effort changes.
- [Anthropic adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
  keeps the amount of reasoning distinct from how reasoning content is displayed.
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model) exposes
  model-dependent `reasoning.effort` values: current families differ across `none`, `minimal`, low,
  medium, high, xhigh, and max rather than sharing one provider-wide maximum or default.
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking#controlling-thinking) uses
  model-dependent thinking levels, including `minimal`, while legacy Gemini 2.5 models use numeric
  budgets; its
  [OpenAI compatibility mapping](https://ai.google.dev/gemini-api/docs/openai#thinking) also forbids
  overlapping native and compatibility controls.

Observed common behavior: effort is an ordinal model capability, not a portable quantity; defaults and
supported values are model-dependent; user input must resolve to an explicit effective/applied outcome;
and a changed effective effort is request semantics, so it must participate in cache identity.

Constraint for Robota: one multi-provider vocabulary may be convenient at the framework boundary, but
it cannot claim that equal names purchase equal reasoning across models, and it must make clamps or
unsupported/no-op outcomes visible.

## Architecture Review

### Affected Scope

- `packages/agent-core` — effort types, provider/model capability metadata, effective outcome, provider
  request assembly, execution-cache identity.
- `packages/agent-framework` — session resolution, live re-application, skill command execution,
  subagent inheritance and restoration, hook projection.
- `packages/agent-session` / `packages/agent-executor` — scoped execution request and lifecycle contracts.
- `packages/agent-cli` — flags, settings/environment resolution, interactive command/picker, print mode,
  persistence, and status visibility.
- `packages/agent-provider-anthropic`, `packages/agent-provider-openai`,
  `packages/agent-provider-gemini` — model capability declarations and native request mapping.

### Alternatives Considered

1. **Keep the current global five-value dial and let every provider silently clamp or ignore it.**
   Pro: smallest change and preserves current call sites. Con: users cannot know whether the requested
   setting applied, model-specific defaults remain unrepresentable, and cache collisions remain hidden.
2. **Expose only provider-native controls.** Pro: exact vendor fidelity. Con: CLI, skills, and presets
   become provider-specific; switching models changes configuration language and breaks the
   provider-neutral framework boundary.
3. **Use one extensible ordinal request vocabulary plus model capability metadata and a typed resolution
   outcome.** Pro: preserves a provider-neutral user control while representing current `none`/`minimal`
   tiers and recording exact/default/clamped/not-applied semantics per model. Con: requires coordinated
   changes across session, providers, and caching and expands the current type vocabulary.

### Decision

Choose alternative 3. Evolve the request vocabulary to
`auto | none | minimal | low | medium | high | xhigh | max`; represent `auto` separately from the
resolved effort, meaning omit the native control and use the model default. `none` is a model request
tier, never a universal thinking-display toggle. A central provider-neutral resolver returns requested
tier, effective tier/default, and a typed exact/default/clamped-down/not-applied disposition using model
capability metadata. Provider adapters alone assemble native request fields and return a normalized,
provider-owned semantic fingerprint of what they will send; cache identity keys that fingerprint.

Validated recommendation:

- **Reachability:** current effort already crosses core, presets, CLI assembly, and OpenAI; the new
  result must reach every existing consumer plus skills, subagents, hooks, Anthropic, Gemini, and cache.
- **Capability preservation:** current preset startup/live behavior and explicit low/medium/high
  OpenAI calls remain representable; silent high clamps become explicit outcomes.
- **Adversarial pass:** invalid metadata, unsupported tiers, model switches, nested scoped overrides,
  cancellation, print mode, custom gateways, and cache replay are named failure paths and must fail
  closed or report not-applied rather than appear successful.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — CLI/settings/hooks, skill/subagent, Anthropic/OpenAI/Gemini, cache 경로 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

One intentional capability degradation is allowed: when the requested tier is unsupported and the
active model's declared policy permits ordinal fallback, resolution may clamp to the nearest explicitly
supported tier that is not greater than the request. The result must be `clamped-down` and expose both
requested and effective values in interactive, print, and hook outcomes. When no such tier or policy
exists, including a provider with no native effort control, the result is `not-applied` and the adapter
must omit the native field. Silent clamps, provider-wide guessed defaults, and catch-to-default paths
remain forbidden.

## Solution

Create four child Tasks under this agreement:

1. `BEHAVIOR-009` owns typed scoped skill/subagent inheritance, precedence, temporary application,
   restoration, and the semantics consumed later by issue #2094.
2. `FLOW-008` owns the session resolution authority and all user/control/visibility projections.
3. `API-001` owns provider/model capability metadata, native mappings, defaults, clamps, and visible
   unsupported outcomes.
4. `DATA-007` owns cache identity for the provider-owned normalized semantic fingerprint after the
   effective/applicable outcome is available.

The agreement owns the issue checklist matrix. Every row must receive an adopted, adapted, or rejected
verdict before approval; a child may refine implementation but may not silently drop a row.

### Issue #1987 checklist disposition

| Checklist group                              | Initial verdict                   | Owner / reason                                                                                    |
| -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| low/medium/high/xhigh/max ordinal scale      | Adapt                             | AGREEMENT/API-001; extend the existing SSOT with `none`/`minimal`, while `auto` stays separate    |
| per-model support, defaults, downward clamp  | Adopt with typed outcome          | API-001; never silent                                                                             |
| equal names not comparable across models     | Adopt                             | AGREEMENT/API-001 documentation contract                                                          |
| picker, `/effort <level>`, and `auto`        | Adopt                             | FLOW-008                                                                                          |
| launch flag, environment, settings           | Adopt                             | FLOW-008                                                                                          |
| skill/subagent frontmatter                   | Adopt                             | BEHAVIOR-009; decoder migration remains issue #2094                                               |
| precedence and per-level persistence         | Adapt after adversarial review    | FLOW-008/BEHAVIOR-009; env authority and session-only values must be explicit                     |
| print-mode run-only and not-applied feedback | Adopt                             | FLOW-008                                                                                          |
| header/footer visibility and hook exposure   | Adopt                             | FLOW-008                                                                                          |
| one-off prompt keyword                       | Reject as magic syntax by default | FLOW-008 may adopt only with an explicit parser contract; ordinary language must not mutate state |
| thinking display controls                    | Keep separate from effort         | FLOW-008; display and reasoning amount are different contracts                                    |
| effort change invalidates cache              | Adopt and strengthen              | DATA-007 keys effective assembled semantics, not only raw effort                                  |

## Affected Files

Initial owner paths are listed under Architecture Review. Each child spec must narrow its file list
before implementation; this agreement does not authorize changing every file in those packages.

## Completion Criteria

- [ ] TC-01: Every issue #1987 checklist row has a reviewed adopted/adapted/rejected verdict and no
      child contradicts the shared requested/effective/applied semantics.
- [ ] TC-02: BEHAVIOR-009 defines and verifies typed scoped inheritance, precedence, and restoration,
      unblocking issue #2094 without implementing its decoder migration.
- [ ] TC-03: FLOW-008 exposes one effective session value across interactive, print, settings,
      environment, persistence, display, and hooks.
- [ ] TC-04: API-001 maps supported Anthropic, OpenAI, and Gemini models to current native controls and
      makes clamp/default/not-applied outcomes observable.
- [ ] TC-05: DATA-007 prevents cache reuse across different effective request semantics while
      preserving hits for equivalent resolved outcomes.
- [ ] TC-06: All four children are done, user execution evidence is recorded, package specs match code,
      and repository scans/CI-equivalent verification pass.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                           | Notes                              |
| ----- | --------------------- | ------------------------------------------------------------------------- | ---------------------------------- |
| TC-01 | Contract review       | checklist matrix + independent proposal review                            | No silent omission                 |
| TC-02 | Integration           | framework skill/subagent lifecycle tests                                  | success, failure, cancel, nesting  |
| TC-03 | Process integration   | CLI/TUI launch, command, restart, print, hook tests                       | precedence and visibility          |
| TC-04 | Contract/integration  | capability tables + provider request fixtures                             | exact, clamp, default, unsupported |
| TC-05 | Unit/integration      | cache-key and provider-call-count tests                                   | low→low hit, low→high miss         |
| TC-06 | User scenario + gates | recorded CLI scenario, `pnpm harness:scan`, `pnpm harness:verify-like-ci` | parent closes last                 |

## Tasks

- [ ] BEHAVIOR-009 — todo — `.agents/tasks/BEHAVIOR-009-apply-scoped-skill-and-subagent-effort-overrides-with-inheritance-and-restoratio.md`
- [ ] FLOW-008 — todo — `.agents/tasks/FLOW-008-resolve-and-expose-active-model-effort-across-cli-settings-environment-and-live-.md`
- [ ] API-001 — todo — `.agents/tasks/API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md`
- [ ] DATA-007 — todo — `.agents/tasks/DATA-007-include-effective-model-effort-in-execution-cache-identity.md`

## Evidence Log

| Claim                                      | Evidence                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Request-side seam already exists           | `TModelEffort`, `IChatOptions.effort`, PRESET-008/PRESET-013, OpenAI mapping              |
| Session control surface is incomplete      | `packages/agent-cli/src/utils/cli-args.ts`; no effort option/parser                       |
| Scoped metadata is parsed but not executed | `skill-source.ts` uses `effort?: string`; subagent override omits effort                  |
| Provider mapping is incomplete             | Anthropic request lacks effort; Gemini effort is unmapped; OpenAI clamp is model-agnostic |
| Cache identity omits effort                | `packages/agent-core/src/services/cache/cache-key-builder.ts`                             |
| Cause split independently reviewed         | finding-depth result: `4 FOUNDATIONAL of 5`; original total-absence premise `INVALID`     |
