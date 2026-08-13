---
status: in-progress
type: DATA
tags: [typescript, async]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md
---

# ARCH-019: make the sanctioned session double honest about turn identity

## Problem

`createTestInteractiveSession().submit()` returns the fixed turn id `test-turn` for every call. Two
submissions through the published contract double are therefore indistinguishable even though the
public turn-handle contract identifies each submission separately. The defect reproduces by creating
one test session, calling `submit` twice, and comparing the two returned `turnId` values: they are equal.

The Task also questioned whether `IInteractiveSession.getSession()` understates a required event-service
surface. Current source disproves that broader claim: transport-typed consumers use only
`getSessionId()`, while framework prompt execution receives a concrete framework `Session` through its
own `IPromptTurnContext`. The double's nested `getEventService` member is defensive extra shape, not a
demonstrated transport-contract requirement. This work keeps the public nested-session contract narrow
and removes the unowned extra stub.

There is also a concrete owner-document contradiction: the interface-transport SPEC says
`agent-framework` re-exports `createTestInteractiveSession`, while framework source and its SPEC say
the opposite. The `agent-interface-transport/testing` subpath is the sole public owner; both SPECs
must state that fact.

## Prior Art Research

Vitest's official mock API documents that successive calls may deliberately produce different values
through `mockImplementationOnce`/`mockReturnValueOnce`, while TypeScript checks those values against the
original function's return type: [Vitest Mocks](https://vitest.dev/api/mock). The relevant principle is
not to use Vitest mocks inside the published factory; it is that a test double for an identity-producing
operation must be able to represent successive distinct identities while remaining type-conformant.

Robota already applies the same rule to this factory's session identity: every factory instance gets a
deterministic counter-suffixed session id so multi-session tests do not collapse into one identity. The
turn identity needs the per-call equivalent. A deterministic per-double counter is preferable to random
data because failures remain reproducible while separate submissions remain representable.

## Architecture Review

### Affected Scope

- `packages/agent-interface-transport/src/testing/index.ts`: published testing-subpath factory.
- `packages/agent-interface-transport/src/__tests__`: per-call identity and nested-session shape tests.
- `packages/agent-interface-transport/docs/SPEC.md`: test-double fidelity and nested-session boundary.
- `packages/agent-framework/docs/SPEC.md`: remove the stale framework-export claim.
- `.changeset/`: additive/fix release note for the published testing subpath.
- `.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md`: public SDK evidence.

### Alternatives Considered

1. Retain one fixed `test-turn` id.
   - Pro: fully deterministic and zero implementation change.
   - Con: cannot model two submissions, contradicting the public turn-handle identity semantics.
2. Generate a random UUID per call.
   - Pro: identities are practically unique across every double and process.
   - Con: nondeterministic failure output is unnecessary for an in-process test fixture.
3. Generate a deterministic id from the double's session id and a per-call counter, and keep
   `getSession()` at its proven narrow transport surface.
   - Pro: distinct, reproducible, coherent identities with no production/runtime dependency; avoids
     widening a public contract for a framework-only concrete-session need.
   - Con: the factory becomes stateful across submissions and exact literal expectations must migrate.

### Decision

Choose alternative 3. Each factory instance owns a submission counter. Its default `submit` returns a
turn id derived from that instance's resolved session id plus the next counter value; custom `submit`
overrides retain full control. Keep `IInteractiveSession.getSession()` as
`{ getSessionId(): string }`, because all consumers typed against that contract require only identity.
Remove `getEventService` from the default nested object and add a type-level exactness assertion so the
published double does not silently grow a framework-only surface again.

Compatibility classification: this is a **PATCH** changeset for
`@robota-sdk/agent-interface-transport`. It changes default behavior of a published testing fixture but
does not change a TypeScript signature or production contract. Removing an extra property that was not
part of the declared nested-session return type is not a public API removal.

This remains in `agent-interface-transport/testing`, mirroring the existing `agent-core/testing`
fixture family. It adds no product, presentation, package, or sibling dependency. ARCH-012 consumes this
honest full double as its capability-conformance foundation; it does not widen ARCH-019 into the later
capability migration.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `agent-core/testing` and the existing per-double session-id strategy examined
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Create the default `submit` implementation after the factory's resolved-session-id helper exists. On
each call it increments a counter and returns a handle whose `turnId` is
`<resolved-session-id>-turn-<n>`. The completed result remains the existing immediate empty result.
Overrides are spread after the default and therefore preserve existing customization semantics.

The first two default ids from one double are exactly `${sessionId}-turn-1` and
`${sessionId}-turn-2`. A second double starts its own counter at 1 under its distinct session id. An
overridden `getSession()` supplies the prefix when it returns a non-empty id; the existing deterministic
fallback session id supplies it when that override throws or returns empty. An overridden `submit`
remains authoritative and does not expose or depend on the default counter.

Return only `getSessionId` from the default `getSession`. Add a compile-time exact nested-session shape
test plus runtime identity regressions. Update both package SPECs to state that the testing factory is
owned/exported only by `agent-interface-transport/testing`, models distinct submissions, and keeps the
transport nested-session contract identity-only. Record the observable testing-subpath fix in a PATCH
changeset.

## Affected Files

- `packages/agent-interface-transport/src/testing/index.ts`
- `packages/agent-interface-transport/src/__tests__/test-double-turn-identity.test.ts`
- `packages/agent-interface-transport/docs/SPEC.md`
- `packages/agent-framework/docs/SPEC.md`
- `.changeset/arch-019-test-session-turn-identity.md`
- `.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md`
- `.agents/tasks/ARCH-019-interactive-session-getSession-contract-understated.md`

## Completion Criteria

- [ ] TC-01: For one default double, two calls return exactly `${sessionId}-turn-1` and
      `${sessionId}-turn-2` and both complete; a second double starts at `<its-session-id>-turn-1`.
- [ ] TC-02: The default `getSession()` result contains exactly the public `getSessionId` capability;
      transport consumers typecheck and framework prompt collection continues through its concrete
      `Session` contract.
- [ ] TC-03: A non-empty overridden session id prefixes default turn ids; throwing/empty session-id
      overrides use the deterministic fallback; an overridden `submit` remains authoritative.
- [ ] TC-04: Interface-transport and framework SPEC/export surfaces agree that only
      `@robota-sdk/agent-interface-transport/testing` exports the factory, and the PATCH changeset records
      the compatible testing-fixture behavior correction.
- [ ] TC-05: The durable public-SDK scenario imports only
      `@robota-sdk/agent-interface-transport/testing`, submits twice, prints two distinct deterministic ids
      and `DISTINCT`, exits 0, and removes its scratch directory.
- [ ] TC-06: package build, typecheck, tests, scoped harness verification, and
      `pnpm harness:verify-like-ci` exit 0.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                            | Notes                                                                                |
| ----- | ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| TC-01 | Unit + async contract    | Vitest two-submit regression in `test-double-turn-identity.test.ts`        | First RED expects unequal ids against the current fixed literal.                     |
| TC-02 | Type + regression        | exact nested-session shape assertion and affected package typecheck/tests  | No framework-only event-service member on the transport fixture.                     |
| TC-03 | Unit + async contract    | table-driven override/fallback/custom-submit cases                         | Preserve all documented factory override semantics.                                  |
| TC-04 | Contract/docs            | export-surface and SPEC assertions plus PATCH changeset inspection         | Pin the sole testing-subpath owner.                                                  |
| TC-05 | Public SDK scenario      | `.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md` | Fresh process prints exact ids derived from its runtime session id, then `DISTINCT`. |
| TC-06 | Engineering verification | package and harness/CI-mirror commands                                     | Run targeted checks before the broad gate.                                           |

## Tasks

- [ ] `.agents/tasks/ARCH-019-interactive-session-getSession-contract-understated.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter is valid with draft status, allowed DATA type, and tags. The Problem gives the exact
fixed-turn-id symptom and two-submit reproduction while explicitly excluding the disproved
`getSession()` widening premise. Prior Art Research cites official Vitest documentation and the
repository's deterministic session-id precedent; both feed three pro/con alternatives and the
counter-based Decision. All four architecture checklist items are checked; no new surface is
introduced, and the existing testing-subpath placement is justified against the `agent-core/testing`
sibling without product dependency. Completion Criteria TC-01 through TC-04 are observable and match
four substantive Test Plan rows exactly. Tasks and an empty first-run Evidence Log were present, with
no forbidden body status/classification sections.

### [GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-08-14

**Status remains:** review-ready
**Violation:** GATE-WRITE was requested against a document whose frontmatter already said
`review-ready`, while the file remained in `.agents/spec-docs/draft/`; the gate expected `draft`
input, and the retained PASS evidence covered the superseded four-TC version rather than the current
six-TC document.
**Required action:** Restore the document to coherent `status: draft` in `draft/`, retain this
ordering record, and invoke a fresh GATE-WRITE for the TC-01..06 content. On PASS, move it to
`.agents/spec-docs/backlog/` while setting `status: review-ready`.

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter and draft-folder input state were coherent. The Problem records the exact fixed-turn-id
symptom, two-call reproduction, sole-owner SPEC contradiction, and the invalid `getSession`-widening
premise excluded from scope. Official Vitest documentation and the repository's deterministic
session-id precedent feed three pro/con alternatives and the deterministic per-double counter
Decision, including override semantics and PATCH compatibility. All four architecture items are
checked; no new surface is introduced, and the retained testing subpath is placed against the
`agent-core/testing` sibling without product dependency. Completion Criteria TC-01 through TC-06
are observable and match six substantive Test Plan rows exactly. The Tasks placeholder exists;
prior GATE-WRITE/NON-COMPLIANCE history is preserved; no forbidden body status/classification
sections exist.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User standing approval, verbatim: “타당한 이유와 함께 추천안을 제시하면 타당할 경우 자동으로
승인하겠습니다.” The exact revised ARCH-019 recommendation was independently reviewed and returned
`ENDORSE`, satisfying the user's stated validity condition; the user's subsequent “진행하세요” and
“승인함” plus the active initiative instruction confirm execution authority. The endorsed
Architecture Review and frontmatter (`type: DATA`, `tags: [typescript, async]`) are unchanged in the
current six-TC document. No new-surface independent-review requirement applies, and no implementation
work predates this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
Task `.agents/tasks/ARCH-019-interactive-session-getSession-contract-understated.md` exists and is
named exactly in the spec's Tasks section. Its revised Plan maps TC-01 through TC-06 one-to-one across
deterministic turn identity, exact nested-session shape, override/fallback behavior, owner SPECs and
PATCH changeset, the public SDK scenario, and broad verification/archive. Its substantive Revised Test
Plan covers red-first, type/regression, public scenario, package/scoped-harness, and CI-equivalent
checks, with no blockers. Planned implementation/test/scenario/changeset artifacts had not been created
or modified, so no implementation predated this gate.
