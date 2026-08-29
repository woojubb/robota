---
title: 'SECURITY-002: Skill and agent frontmatter cross trust boundaries without one strict decoder'
issue: https://github.com/woojubb/robota/issues/2082
status: todo
created: 2026-08-29
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

This is one independently mergeable leaf of tracking issue #2066. Issue #2094 owns migration of skill
and plugin discovery, and issue #2095 owns migration of agent-definition loading. Those siblings must
consume this decoder; this Task must not migrate their discovery roots or add compatibility shims.

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
  traversal, precedence rule, and user-facing loader error projection in issue #2094 or issue #2095.
- Do not retain permissive aliases, forwarding parsers, or compatibility fallbacks; the affected API
  is prerelease.

## Plan

- [ ] Survey the exact skill and agent key vocabularies and identify the lowest correct owner for the
      shared decoder and its typed output without reversing package dependencies.
- [ ] Specify strict parsing and diagnostic semantics for missing delimiters, malformed lines, unknown
      keys, booleans, lists, positive integers, context values, model values, and effort values.
- [ ] Implement one discriminated skill/agent decoder with file-, line-, and field-bound failures.
- [ ] Prove every invalid class fails and every valid variant preserves its typed values.
- [ ] Update the governing contract/design documentation and leave issue #2094 and issue #2095 as the
      only loader-migration owners.

## Completion Criteria

- One decoder accepts an explicit skill-or-agent variant plus source identity and returns only a fully
  typed metadata value or a structured non-empty diagnostic set.
- Boolean typos, invalid context values, zero/negative/fractional/non-numeric turn limits, wrong field
  shapes, malformed lines, and the reviewed unknown-key policy are rejected without a partial value.
- Diagnostics identify the source file and the offending line and field whenever those coordinates
  exist.
- Skill and agent variants have closed, independently tested key sets and share scalar/list/effort
  primitives rather than duplicating coercion logic.
- The effort field consumes the `TModelEffort` SSOT, and no arbitrary string crosses the decoded
  boundary.
- Existing skill/plugin and agent loaders are not migrated in this Task; issue #2094 and issue #2095
  remain the respective migration owners.
- No compatibility parser, silent fallback, partial-record cast, or forwarding alias is added.

## Test Plan

- Unit-test valid minimal and complete skill/agent metadata variants.
- Table-test every invalid boolean, list shape, positive-integer edge, context value, effort value,
  malformed line, wrong field type, and unknown key against exact diagnostic coordinates.
- Prove a malformed model-invocation disabling flag cannot decode to `false`.
- Run the affected package build, tests, lint/type checks, package contract verification, repository
  scans, and CI-equivalent verification before merge.

## User Execution Test Scenarios

Not applicable for this leaf: it deliberately defines and tests the shared decoder without connecting
any production loader. Issue #2094 and issue #2095 own the runnable skill/plugin and agent loading
surfaces and must record user-execution evidence when they migrate those paths.
