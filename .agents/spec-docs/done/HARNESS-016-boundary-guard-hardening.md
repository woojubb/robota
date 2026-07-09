---
status: done
type: INFRA
tags: [harness]
---

# HARNESS-016: Boundary guard hardening — dag-nodes-leaf rule + revive sdk-react-free (ARL-16 b, g)

## Problem

The 2026-07-08 interface/boundary audit found boundary invariants that hold only by convention because
their guards are missing or dead (ARL-16, realizing the harness-governance "assert the relation, not a
proxy" principle). This spec is the first, no-blast-radius tranche — two pure-harness guards:

1. **No dag-nodes leaf guard (ARL-16b).** `check-dependency-direction.mjs` enforces cycles, pass-through
   re-exports, `agent-core` zero-deps, and the plugin-layer restriction — but nothing stops a
   `@robota-sdk/dag-node-*` leaf package from depending on a DAG orchestrator/runtime layer
   (`dag-runtime`/`dag-framework`/`dag-worker`/…) or on a **sibling** `dag-node-*`. Verified: every one of
   the 25 node packages depends only on `{dag-core, dag-node}` among `dag-*` — **except**
   `dag-node-llm-text-router`, which depends on 5 sibling `dag-node-llm-text-*` packages (the only node→node
   edge; the leaf-invariant breach behind ARL-11). Nothing catches it.
2. **`check-sdk-react-free.mjs` is a dead guard (ARL-16g).** Its docstring says it checks
   `packages/agent-framework`, but the code scans `packages/agent-sdk` — a **husk directory** (no `src/`,
   no `package.json`; an absorbed/renamed package). So `walkTs` returns nothing and the guard enforces
   nothing: the real assembly layer (`agent-framework`) that must stay React-free is never scanned. This is
   exactly the "docstring vs scan target divergence is a defect" case.

## Architecture Review

### Affected Scope

- `scripts/harness/check-dependency-direction.mjs` — NEW `checkDagNodesLeaf(packages)` + registration in
  `runScan`; frozen `DAG_NODES_LEAF_ALLOWLIST` for the one existing exception.
- `scripts/harness/check-sdk-react-free.mjs` — repoint `SDK_SRC`/`SDK_PKG_JSON` from the `agent-sdk` husk
  to the real `packages/agent-framework`; align the docstring; guard against silently scanning a missing dir.
- `scripts/harness/__tests__/` — fixtures for the new leaf rule (and, if the guard exposes a pure finder,
  the react-free repoint).

### Alternatives Considered

1. **Leave as convention / docstring-only fix for sdk-react-free.** Rejected: ARL-16b is unguarded (the
   router breach is invisible), and a docstring fix on sdk-react-free would still leave it scanning a husk —
   the guard must actually enforce the invariant it claims (assert-the-relation).
2. **Add both guards now; frozen-baseline the one known leaf exception; revive sdk-react-free onto the real
   package (chosen).** The router's 5 sibling edges go into a reasoned `DAG_NODES_LEAF_ALLOWLIST` (pending
   ARL-11's structural fix), so the live scan is green while any NEW node→node / node→orchestrator edge
   fails. sdk-react-free is repointed to `agent-framework` (verified React-free today, so it passes and
   now actually enforces).
3. **Also fold in the other ARL-16 guards (doc-edge, structural-duplicate-contract, interface-imports
   all-package, browser-safety) now.** Deferred: those are larger/heuristic or entail code migration
   (interface-imports surfaces the ARL-14 pass-through, a code change). Kept out of this no-blast-radius
   tranche; tracked in ARL-16 for follow-on tranches.

### Decision

**Alternative 2.** Two pure-harness guards, both realizing the "assert the relation" principle:
`checkDagNodesLeaf` (forbid a `dag-node-*` package depending on any `dag-*` other than `dag-core`/`dag-node`,
including sibling nodes; frozen allowlist = the router exception) and reviving `check-sdk-react-free` onto
`agent-framework`. Scope discipline: the leaf guard targets the _intra-DAG_ leaf invariant only; the
cross-subsystem `dag-node-skill → agent-framework` assembly reach (ARL-11) is a separate decision and is NOT
enforced here.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — scripts/harness (two guards + fixtures)
- [x] Sibling scan 완료 — existing check-dependency-direction rules + the husk-scanning sdk-react-free
- [x] 대안 최소 2개 검토 완료 — 3개 (convention / two-guards / all-ARL-16-now)
- [x] 결정 근거 문서화 완료 — frozen-baseline the router; revive sdk-react-free onto the real package; defer heuristic/code-migration guards

## Solution

1. **dag-nodes-leaf (`check-dependency-direction.mjs`):** add `checkDagNodesLeaf(packages)` — for every
   `@robota-sdk/dag-node-*` package, its `@robota-sdk/dag-*` production deps must be a subset of
   `{@robota-sdk/dag-core, @robota-sdk/dag-node}`; any other `dag-*` (orchestrator/runtime/adapters/builder
   layers **or** a sibling `dag-node-*`) is a violation unless the exact `"<pkg> -> <dep>"` edge is in the
   frozen `DAG_NODES_LEAF_ALLOWLIST`. Seed the allowlist with the 5 `dag-node-llm-text-router` sibling edges,
   each carrying the reason "aggregator node pending ARL-11 structural relocation". Register in `runScan`
   and the scan summary. (`findWorkspacePackages` is already nesting-aware for `packages/dag-nodes/*`.)
2. **sdk-react-free revive (`check-sdk-react-free.mjs`):** change `SDK_SRC`/`SDK_PKG_JSON` to
   `packages/agent-framework`; update the docstring to name `agent-framework` consistently; make a missing
   `src/`/`package.json` a hard finding (a guard that silently scans nothing is the defect this fixes).
3. Fixtures: a leaf-rule fixture (a fake `dag-node-x` depending on a sibling node / on `dag-runtime` → finding;
   allowlisted edge → no finding; a clean node → no finding), and a live-scan assertion that both guards
   exit 0 on the current repo (router allowlisted; agent-framework React-free).

## Affected Files

- `scripts/harness/check-dependency-direction.mjs` (+ `DAG_NODES_LEAF_ALLOWLIST`, `checkDagNodesLeaf`, runScan wiring)
- `scripts/harness/check-sdk-react-free.mjs` (repoint to agent-framework + docstring + missing-dir hard finding)
- `scripts/harness/__tests__/check-dependency-direction.test.mjs` (extend, or NEW) — leaf-rule fixtures
- `.agents/architecture-remediation-log.md` — mark ARL-16(b) + ARL-16(g) resolved (ARL-16 remainder stays open)

## Completion Criteria

- [ ] TC-01: a fixture `dag-node-*` package depending on a sibling `dag-node-*` → leaf violation (exit 1).
- [ ] TC-02: a fixture `dag-node-*` depending on `dag-runtime`/`dag-framework` → leaf violation.
- [ ] TC-03: the `dag-node-llm-text-router` sibling edges are allowlisted (reasoned) → live scan exit 0.
- [ ] TC-04: `check-sdk-react-free` now scans `packages/agent-framework` (not the `agent-sdk` husk); a react import/dep fixture → finding; current repo → exit 0 (agent-framework is React-free).
- [ ] TC-05: `pnpm harness:scan` exit 0 with both guards active; new fixture tests green.

## Test Plan

Fixture-based RED/GREEN for the leaf rule (sibling-dep + orchestrator-dep → finding; allowlisted + clean →
none) and the react-free repoint (react fixture → finding; live agent-framework → clean). Live `harness:scan`
stays green (router allowlisted pending ARL-11; agent-framework verified React-free). The allowlist is the
`check-orphan-exports`/`UNDOCUMENTED_EXPORT_ALLOWLIST` frozen-baseline discipline. Gate via the standard flow

- `merge-verifier`; mark ARL-16(b)/(g) resolved on land.

## Tasks

- [ ] 미생성 — GATE-APPROVAL 후 생성.

## Evidence Log

- 2026-07-08 GATE-APPROVAL — proposal-reviewer **ENDORSE** (round 1). All premises verified: allowed set
  `{dag-core, dag-node}` empirically exact (only router violates, 5 sibling edges); `check-sdk-react-free`
  confirmed scanning the `agent-sdk` husk (enforces nothing) while agent-framework is React-free (repoint
  passes); intra-DAG leaf scope correct (ARL-11 cross-subsystem reach is a separate code-migration invariant).
  Notes: node selector `startsWith('@robota-sdk/dag-node-')` (trailing dash) so `@robota-sdk/dag-node` is an
  allowed target; add a live-scan-exit-0 assertion. Approved → implement.

- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — Added `checkDagNodesLeaf` + `DAG_NODES_LEAF_ALLOWLIST`
  (5 router sibling edges, reason: ARL-11) to `check-dependency-direction.mjs`, wired into `runScan`
  (`[DAG-NODES-LEAF]`); exported `findWorkspacePackages` for the live assertion. Revived
  `check-sdk-react-free.mjs`: extracted pure `findSdkReactViolations(root, pkg)`, repointed from the
  `agent-sdk` husk to `packages/agent-framework`, made a missing scan target a hard finding (SCAN-TARGET-MISSING),
  aligned the docstring. NEW `__tests__/check-dependency-direction.test.mjs` (8 tests): leaf sibling/orchestrator
  → finding, allowed owners + allowlisted router → none, live repo → [] (TC-03); react-free import+dep fixture
  → finding, missing-target → 2 findings, live agent-framework → [] (TC-04). Verified: fixtures 8/8, both live
  guards exit 0, `pnpm harness:scan` 48/48 exit 0. Harness-only → no changeset. ARL-16(b)+(g) resolved. DONE.
