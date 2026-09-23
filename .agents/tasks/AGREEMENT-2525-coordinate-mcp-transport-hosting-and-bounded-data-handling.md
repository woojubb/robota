---
title: 'AGREEMENT-2525: coordinate MCP transport hosting and bounded data handling'
issue: https://github.com/woojubb/robota/issues/2525
status: in-progress
created: 2026-09-21
priority: high
urgency: soon
area: MCP client admission, external-payload replay, local subprocess authority, and loopback MCP hosting
depends_on: []
children: [PAYLOAD-2153, MCP-2522, MCP-2525, MCP-2533]
---

# AGREEMENT-2525: coordinate MCP transport hosting and bounded data handling

Spec: `.agents/spec-docs/active/AGREEMENT-2525-coordinate-mcp-transport-hosting-and-bounded-data-handling.md`

## Objective

Coordinate the four independently releasable boundaries retained by [issue #2525](https://github.com/woojubb/robota/issues/2525): stable external-payload replay, safe stdio client transport, bounded MCP result admission with secure spill, and authenticated loopback Streamable HTTP hosting.

This Agreement owns the source map, dependency order, and no-overlap rules only. It deliberately owns no runtime adapter, common fallback path, or public API. The existing client and server migration trees remain under `AGREEMENT-014` and `AGREEMENT-015`; they are prerequisite streams rather than nested children, because an AGREEMENT may not absorb pre-existing AGREEMENT records.

## Source Register

| Source                                                       | Owner                                         | Relationship                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [issue #1985](https://github.com/woojubb/robota/issues/1985) | `AGREEMENT-014` → `MCP-001` through `MCP-005` | Existing client-control-plane prerequisite stream; retain its own children and source identity. |
| [issue #1986](https://github.com/woojubb/robota/issues/1986) | `AGREEMENT-015` → `MCP-006` through `MCP-008` | Existing server-product prerequisite stream; retain its own children and source identity.       |
| [issue #2153](https://github.com/woojubb/robota/issues/2153) | `PAYLOAD-2153`                                | Stable, cross-platform external-payload replay authority.                                       |
| [issue #2522](https://github.com/woojubb/robota/issues/2522) | `MCP-2522`                                    | Local subprocess authority for stdio client transport.                                          |
| [issue #2525](https://github.com/woojubb/robota/issues/2525) | `MCP-2525`                                    | Result admission, bounded context, spill reference, retention, and cleanup.                     |
| [issue #2533](https://github.com/woojubb/robota/issues/2533) | `MCP-2533`                                    | Authenticated loopback Streamable HTTP carrier and session mapping.                             |

The four direct child records use canonical umbrella [issue #2525](https://github.com/woojubb/robota/issues/2525) in their `issue:` frontmatter because the closed leaf Issues transferred their unfinished scope here. Their exact historical source links remain in this register and in each child Objective.

## Shared Constraints

- MCP metadata may request a bounded per-tool result limit but must never bypass the generic admission owner or its repository hard cap.
- `PAYLOAD-2153` alone owns a portable, replacement-safe external-payload read primitive; no consumer may restore check-then-open pathname reads as a compatibility path.
- `MCP-2522` alone owns command, arguments, environment, working-directory, and child-process lifecycle authority for local stdio clients.
- `MCP-2533` alone owns the MCP Streamable HTTP carrier, loopback network admission, and protocol-session mapping; it must not reuse Robota HTTP or WebSocket protocol carriers.
- Every source outcome remains independently implemented, tested, and user execution test scenario verified from
  its already-approved design. A future shared contract is allowed only when a child design proves
  a real common owner without merging these security boundaries.

## Plan

- [ ] Revalidate the six-source register, current MCP references, existing Task graph, and package ownership before child implementation starts.
- [ ] Treat this owner map and the four already-approved child designs as the implementation entry;
      do not create or synchronize another lifecycle record solely to repeat their status.
- [ ] Implement each direct child from its approved design, then run focused verification and its
      executable user execution test scenario before the one completion decision.
- [ ] Reconcile the existing `AGREEMENT-014` and `AGREEMENT-015` streams from their source Tasks without duplicating or nesting their records.
- [ ] Audit all twelve retained outcomes and delivery evidence before the parent Issue's terminal writeback.
- [ ] On the final integration-to-develop PR, require the applicable five-host payload qualification
      through `pr-validation`, verify the four declared live contexts, and leave final landing for
      the user's decision. A conflict-free base advance does not invalidate an unchanged head.

## Completion Criteria

- [ ] TC-01: The four direct children remain the explicit, non-overlapping owner map; any retained
      Agreement spec is design evidence rather than a mirrored lifecycle/status gate.
- [ ] TC-02: Every retained source row has one exact owner, and no direct child claims another child's filesystem, subprocess, result-lifecycle, or network-admission authority.
- [ ] TC-03: `PAYLOAD-2153`, `MCP-2522`, `MCP-2525`, and `MCP-2533` each finish the approved design,
      negative-path tests, and runnable product-surface scenario.
- [ ] TC-04: All eight Tasks under `AGREEMENT-014` and `AGREEMENT-015` have truthful terminal delivery evidence; their source outcomes are not inferred from this Agreement's existence.
- [ ] TC-05: The final issue #2525 audit proves every source-register row against merged `origin/develop` evidence before the Issue is closed.
- [ ] TC-06: The applicable native qualification is a fail-closed child of `pr-validation` under
      the simplified four-context policy. Selected missing, skipped, cancelled, or failed host legs
      prevent acceptance; this integration does not change remote protection settings.

## Test Plan

Check the dependency graph and non-overlap ownership mechanically. For each direct child, run its
focused package tests, typecheck/build when affected, security negative cases, and declared user
execution scenario. For the final audit, read the six source outcomes, merged evidence, and current
Issue map; do not recreate a Task/spec projection merely to prove bookkeeping symmetry.

| TC-ID | Tool / Approach                                                             | Expected observable                                                                   |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-06 | Final PR native-child read-back → `pr-validation` → live context comparison | Selected native legs and the aggregate pass; the four repository/live contexts match. |

## Gate-Fail Correction Record

Historical evidence only. Issue #2826 supersedes the future gate references below; the four child
designs are approved and resume through one entry decision and one completion decision without
replaying `GATE-WRITE` or `GATE-APPROVAL`.

**Instruction (verbatim):** "[https://github.com/woojubb/robota/issues/2525](https://github.com/woojubb/robota/issues/2525) 이 이슈를 처리하고 닫을 때까지 반복해서 처리해서 최종적으로 닫아주세요."

**Covered decision:** Correct only the named `GATE-WRITE` document findings while preserving issue #2525's source register, four-child boundary split, existing Task ownership, and all future approval gates.

**Independent verdict:** `GATE-WRITE` FAIL on 2026-09-21 — the Decision omitted the accepted four-child cost, and TC-03 misstated the two-stage L2 gate as one exit-code check.

**Correction grounds:** This change adds the explicit cost-versus-security-boundary trade-off and replaces only TC-03's invalid command assertion with the observable mechanical-plus-guardian outcome. It introduces no runtime behavior, public contract, product scope, policy-file change, or user-authored-document change.

## Children

- [x] PAYLOAD-2153 — done — `.agents/tasks/completed/PAYLOAD-2153-provide-stable-cross-platform-external-payload-replay-handles.md`
- [ ] MCP-2522 — todo — `.agents/tasks/MCP-2522-add-a-safe-stdio-mcp-client-transport.md`
- [ ] MCP-2525 — todo — `.agents/tasks/MCP-2525-bound-mcp-results-and-spill-oversized-output-securely.md`
- [ ] MCP-2533 — todo — `.agents/tasks/MCP-2533-add-authenticated-loopback-streamable-http-mcp-hosting.md`

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Agreement coordinates independently user-verifiable child capabilities and the final
required-check rollout, but exposes no separate runnable product surface; each direct child owns and must
execute its own product scenario before completion.

## PAYLOAD-2153 Final-Rollout Handoff

**Recommendation:** PAYLOAD-2153 owns the native capability, five-host qualification, repository-side
stable context, and its tests. This Agreement owns only the external live activation because its final
integration-to-develop PR is the first safe point at which the new context can be green before it becomes
required.

**Instruction (verbatim):** “모두 승인하고, 앞으로의 것도 모두 타당한 근거와 함께 제시된
추천안이라면 그게ㅏ 타당할 경우 사전 승입합니다.”

**Independent verdict:** `REVIEW VERDICT: ENDORSE` — explicit transfer is required; leaving the child
criterion pending or waiving it would violate the one-item-at-a-time and done invariants.

## Simplified-harness integration — 2026-09-23

Issue #2826 and the owner's instruction to continue with the newly merged harness supersede the
additional required-context rollout above. Preserve PAYLOAD-2153's five-host native qualification
as an applicable child of `pr-validation`; do not restore retired benchmark jobs, local CI mirrors,
or the former twelve-context declaration. The quoted earlier rollout decision remains historical
evidence. This adoption neither changes live rulesets nor supplies final integration merge approval.
