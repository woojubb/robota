---
title: 'HARNESS-103: scan-interface-runtime checks a narrower thing than the rule it enforces'
status: done
completed: 2026-08-17
created: 2026-08-17
priority: medium
urgency: soon
area: scripts/harness, .agents/project-structure.md, packages/agent-interface-transport
depends_on: []
issue: https://github.com/woojubb/robota/issues/1797
---

# HARNESS-103: the interface-package rule and its guard say different things

Found by `proposal-reviewer` while judging ARCH-029's recommendation. Filed separately: it is a gap
between a rule's words and its mechanism, owned by the harness axis, and ARCH-029's design avoids the
file entirely so it is not a blocker there.

## Problem

`.agents/project-structure.md:308` says an `agent-interface-*` package "must not contain classes or
runtime logic".

`scripts/harness/scan-interface-runtime.mjs` detects two things, per its own header: a bare-specifier
import that introduces a **value** binding, and a `class`/`abstract class`/`enum`/`const enum`
**declaration** node. A plain exported function containing runtime behavior matches neither.

## Evidence

`packages/agent-interface-transport/src/session-capability-host.ts` <!-- evidence-superseded: PR #1804 moved this zero-production-consumer host to the sanctioned testing subpath; ARCH-106 later moved the same test double to the session-interface owner, where current tests cover it --> — 120 lines of prototype-walking
descriptor forwarding, accessor caching, reserved/duplicate-member rejection, and freezing. No class,
no enum, no external value import, so the scan is silent. Its runtime values
`createSessionCapabilityHost` and `readSessionCapability` are published from the package barrel
(`src/index.ts:100`) and re-exported from the `testing` subpath.

**Zero production consumers**, verified 2026-08-17 by grepping `packages/*/src` and `apps/*/src`: the
only in-source references are the barrel re-export and the file's own unit test
(`src/__tests__/session-capability-contracts.test.ts`).

## The two questions, to be decided together

1. **Does the rule mean what it says?** If interface packages may host generic runtime mechanisms,
   that is a `project-structure.md` amendment — per AGENTS.md, "an argument against a rule is the
   input to an amendment, never an exemption from it".
2. **If it does, the scan should measure it.** A rule whose mechanism checks something narrower
   produces a green that does not mean what a reader thinks it means.

Question 1 is owner-reserved: it is a repository-practice decision on a rule document, not an
evidence-driven reversible implementation choice.

## Direction

Recommended: the rule means what it says. Widen the scan to a mechanically exact predicate — the
package's build output contains no runtime values — and relocate `session-capability-host.ts` to an
implementation package. It is the only option under which the rule and the guard state the same thing
_and_ that statement is checkable; amending the rule to permit "generic, dependency-free runtime
mechanisms" would produce prose the guard again cannot measure, reproducing this defect one level up.

Deciding now is nearly free because the file has no production consumer. Every consumer added before
the decision raises the cost of the strict answer, which would let accumulated inconvenience settle
the rule instead of judgement.

Paired spec document: `.agents/spec-docs/draft/HARNESS-103-interface-runtime-scan-is-narrower-than-its-rule.md`.

## Blockers

- Owner answer to question 1 (carried at GATE-APPROVAL).
