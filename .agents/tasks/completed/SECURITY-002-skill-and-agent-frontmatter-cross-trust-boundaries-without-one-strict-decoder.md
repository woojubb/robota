---
title: 'SECURITY-002: Skill and agent frontmatter cross trust boundaries without one strict decoder'
issue: https://github.com/woojubb/robota/issues/2082
status: done
created: 2026-08-29
completed: 2026-08-29
priority: medium
urgency: soon
area: agent-core, agent-interface-command, agent-framework
depends_on: []
---

# SECURITY-002: Skill and agent frontmatter cross trust boundaries without one strict decoder

## Objective

Define one strict, owner-controlled decoder for skill and agent definition frontmatter before either
loader is migrated. The decoder must turn untrusted metadata into explicit typed variants or a
structured diagnostic; it must never cast a partial record, coerce a typo to a wider permission, or
silently ignore a malformed or unknown field.

This is one independently mergeable leaf of tracking
[issue #2066](https://github.com/woojubb/robota/issues/2066).
[Issue #2094](https://github.com/woojubb/robota/issues/2094) owns migration of skill and plugin
discovery, and [issue #2095](https://github.com/woojubb/robota/issues/2095) owns migration of
agent-definition loading. Those siblings must consume this decoder; this Task must not migrate their
discovery roots or add compatibility shims.

## Existing Evidence

- `packages/agent-framework/src/commands/skill-source.ts` defines a private `IFrontmatter`, parses
  `disable-model-invocation: treu` as `false`, accepts `context` and `effort` as arbitrary strings,
  skips malformed lines, and casts a partial record.
- `packages/agent-framework/src/agents/agent-definition-loader.ts` owns a second parser, accepts numeric
  prefixes through `parseInt`, can produce `NaN`, skips malformed lines, and casts another partial
  record.
- Both current loaders read workspace or plugin-contributed files. A malformed disabling flag can
  therefore widen model invocation instead of failing at the trust boundary.
- No shared strict skill/agent metadata decoder or converted Task for issue #2082 exists on current
  `develop` at commit `1fe34532f41bca54bec4f817268bbf3993d7a38c`.

## Scope Boundary

- Own the closed field vocabulary, typed skill/agent variants, scalar/list/positive-integer/context/
  model-effort validation, and file/line/field diagnostics.
- Reuse the existing `TModelEffort` owner rather than defining a sibling effort vocabulary.
- Decide and test one explicit unknown-key policy. Silent acceptance is forbidden.
- Keep decoder definition and direct tests in this Task. Keep every loader migration, discovery-root
  traversal, precedence rule, and user-facing loader error projection in
  [issue #2094](https://github.com/woojubb/robota/issues/2094) or
  [issue #2095](https://github.com/woojubb/robota/issues/2095).
- Do not retain permissive aliases, forwarding parsers, or compatibility fallbacks; the affected API
  is prerelease.

## Recommendation Gate

**Accepted recommendation (2026-08-29).** Place one non-public decoder in
`packages/agent-framework/src/frontmatter/` and make callers select an explicit closed `skill`,
`bundle-skill`, or `agent` profile. Parse the delimited document with a direct `yaml` runtime
dependency, then validate the resulting AST into a fully typed value or a structured non-empty
diagnostic set; never return partial metadata. Preserve the exact body suffix and reject unterminated
blocks, YAML structural errors, duplicate keys, aliases or merge keys, unknown top-level fields, wrong
shapes, boolean typos, invalid context or effort values, and non-positive-safe-integer turn limits.

The `skill` vocabulary includes the runtime and repository-owned keys `name`, `description`, `model`,
`argument-hint`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `effort`, `context`,
`agent`, `loop`, `invocable`, `license`, and bounded scalar `metadata`; `bundle-skill` additionally
accepts `tags`. The `agent` vocabulary is `name`, `description`, `model`, `maxTurns`, `tools`,
`disallowedTools`, and `signal`. Both skill and agent `model` remain because their current command and
agent contracts consume them. Skill `effort` imports the existing `TModelEffort` owner, and `context`
accepts only the currently contracted `fork` value.
Existing loaders remain untouched for [issue #2094](https://github.com/woojubb/robota/issues/2094)
and [issue #2095](https://github.com/woojubb/robota/issues/2095).

**Grounds.** The repository inventory contains `loop`, `invocable`, `license`, nested `metadata`,
bundle `tags`, and agent `signal`/`tools`, so a narrower vocabulary would reject supported documents.
All future consumers are internal to `agent-framework`, which is already allowed to depend on
`agent-core`; therefore the private framework subsystem is the lowest owner without reversing a
dependency. A validated YAML parser supports the formats already present without repeating the unsafe
line parsers. Exact body preservation leaves consumer-specific trimming to the loader-migration
issues. The depth review classified the shared strict decoder as the foundational cause that this Task
already owns; [issue #2094](https://github.com/woojubb/robota/issues/2094) and
[issue #2095](https://github.com/woojubb/robota/issues/2095) own only integration.

**Independent review.** Round 1 returned `REVIEW VERDICT: REVISE` with four findings: missing real key
vocabularies, insufficient YAML syntax, under-specified body/diagnostic semantics, and unowned skill
`model`. The revised recommendation above resolved all four. Round 2 returned
`REVIEW VERDICT: ENDORSE` and `ACTIONABLE FINDINGS: 0`.

**Implementation-review correction.** Round A traced `skill-source.ts` through `ICommand.model` and
proved that the recommendation review's “unowned skill model” premise was false. The final profile
therefore retains skill `model`; prototype-named top-level fields fail as unknown, and extensible
metadata stores the same names as ordinary data without reaching object prototypes.

**Approval.** The owner's standing instruction is: "나에게 제안할 때는 타당한 근거와 함께 추천안을
제안해야 하며, 그 추천안이 타당할 경우 자동승인한다." The independent ENDORSE establishes that
the stated grounds are valid, so this exact recommendation is automatically approved.

## Plan

- [x] Survey the exact skill and agent key vocabularies and identify the lowest correct owner for the
      shared decoder and its typed output without reversing package dependencies.
- [x] Specify strict parsing and diagnostic semantics for missing delimiters, malformed lines, unknown
      keys, booleans, lists, positive integers, context values, model values, and effort values.
- [x] Implement one discriminated skill/agent decoder with file-, line-, and field-bound failures.
- [x] Prove every invalid class fails and every valid variant preserves its typed values.
- [x] Update the governing contract/design documentation and leave
      [issue #2094](https://github.com/woojubb/robota/issues/2094) and
      [issue #2095](https://github.com/woojubb/robota/issues/2095) as the only loader-migration owners.

## Completion Criteria

- One decoder accepts an explicit skill-or-agent variant plus source identity and returns only a fully
  typed metadata value or a structured non-empty diagnostic set.
- Boolean typos, invalid context values, zero/negative/fractional/non-numeric turn limits, wrong field
  shapes, malformed lines, and the reviewed unknown-key policy are rejected without a partial value.
- Diagnostics identify the source file and the offending line and field whenever those coordinates
  exist.
- Skill and agent variants have closed, independently tested key sets and share scalar/list/effort
  primitives rather than duplicating coercion logic.
- Prototype-named top-level keys cannot reach inherited appliers, while the extensible metadata map
  preserves them as ordinary scalar data keys.
- The effort field consumes the `TModelEffort` SSOT, and no arbitrary string crosses the decoded
  boundary.
- Existing skill/plugin and agent loaders are not migrated in this Task;
  [issue #2094](https://github.com/woojubb/robota/issues/2094) and
  [issue #2095](https://github.com/woojubb/robota/issues/2095) remain the respective migration owners.
- No compatibility parser, silent fallback, partial-record cast, or forwarding alias is added.

## Test Plan

- Unit-test valid minimal and complete skill/agent metadata variants.
- Table-test every invalid boolean, list shape, positive-integer edge, context value, effort value,
  malformed line, wrong field type, and unknown key against exact diagnostic coordinates.
- Prove a malformed model-invocation disabling flag cannot decode to `false`.
- Run the affected package build, tests, lint/type checks, package contract verification, repository
  scans, and CI-equivalent verification before merge.

## Result

- Added one private, caller-profiled frontmatter decoder subsystem with fail-closed YAML parsing,
  typed profile output, structured coordinates, and no partial-result path.
- Focused validation passed 37/37 tests (100%); package regression passed 1,600/1,600 tests (100%),
  typecheck, lint with zero errors, and build.
- Affected scans exited 0 with 103/105 checks passing (98.1%), one conditional skip (1.0%), and one
  historical advisory (1.0%); the design-document gate passed and every production file is below
  the 300-line limit.
- Exact scope diff confirmed that the three existing loaders and the public package entry point remain
  unchanged; loader integration remains with the linked follow-up issues.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable for this leaf: it delivers only a private, directly tested decoder and deliberately
does not connect any production loader. Current CLI, TUI, browser, and public SDK paths therefore do
not invoke the new decoder. This is not an unreachable user-facing capability hidden behind an
internal seam because this Task claims no runnable behavior;
[issue #2094](https://github.com/woojubb/robota/issues/2094) and
[issue #2095](https://github.com/woojubb/robota/issues/2095) own the skill/plugin and agent-loader
integrations and their user-visible rejection behavior. A scenario run
through today's product would exercise the existing permissive parsers rather than SECURITY-002.
