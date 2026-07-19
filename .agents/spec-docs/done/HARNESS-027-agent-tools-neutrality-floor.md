---
status: done
completed: 2026-07-19
type: INFRA
tags: [harness, scan, neutrality, agent-tools, dependency-allowlist, selfhost]
---

# HARNESS-027: mechanical agent-tools neutrality / third-party-dependency floor

## Problem

Promotes backlog [HARNESS-027](../../backlog/HARNESS-027-agent-tools-neutrality-floor.md). SELFHOST-003 (repo-map
retrieval) and SELFHOST-010 (computer-use) both keep their reference adapters in `agent-tools` NEUTRAL: the heavy
capability (source parser / browser page) is injected as a **duck-typed port**, and NO heavy third-party SDK
(vector store / tree-sitter / Playwright / CDP) becomes an `agent-tools` runtime dependency. This is enforced
today only by **per-feature unit floors + a one-time manual grep** (SELFHOST-003 TC-04, SELFHOST-010 TC-06 /
`computer-use/__tests__/neutrality.test.ts`). No `pnpm harness:scan` rule mechanically fences `agent-tools`'
third-party **dependency set**: `deps` (`check-dependency-direction.mjs`) only checks inter-workspace
direction/cycles; `interface-imports`/`interface-runtime` only cover `agent-interface-*`. Per
[enforcement-architecture.md](../../rules/enforcement-architecture.md) (every guardian needs a mechanical floor
that keeps firing), `agent-tools` neutrality must not rest on a one-time grep — a future heavy SDK could be added
to `agent-tools/package.json` and no scan would catch it. This also satisfies the deferred **SELFHOST-010-P4**
(agent-tools dep-allowlist floor).

## Prior Art Research

Waived: <internal harness mechanism (a package dependency-allowlist scan) with no external product prior art;
mirrors the repo's own established neutrality-scan precedents `scan-orchestration-neutrality.mjs` /
`scan-memory-neutrality.mjs` — a house pattern, not a market feature>.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-agent-tools-neutrality.mjs` (new) — reads `packages/agent-tools/package.json`, enumerates
  its runtime `dependencies`, excludes `@robota-sdk/*` (workspace edges, governed by the `deps` scan), and FAILs
  on any remaining third-party dependency not on a small documented ALLOWLIST. Verified post-SELFHOST-003/010 the
  real third-party runtime set is exactly `{fast-glob, p-limit, zod}`. A heavy retrieval/parser/vector/browser SDK
  creeping in → FAIL.
- `scripts/harness/run-all-scans.mjs` — register it (`agent-tools-neutrality`).
- `scripts/harness/__tests__/scan-agent-tools-neutrality.test.mjs` (new) — pure `findDisallowedDeps(pkgJson)` +
  red fixture (a heavy SDK) + green fixture (the allowlist) + the live package clean.

### Alternatives Considered

1. **A dependency-allowlist scan over `agent-tools/package.json` (CHOSEN).** ✅ Mechanical, always-firing,
   mirrors the existing neutrality-scan house pattern; catches the exact smuggling vector (a heavy SDK added as a
   dep). ❌ The allowlist is hand-maintained — but a deliberate, reviewed act (adding a dep + its allowlist entry),
   and the diff makes it visible.
2. **Extend the existing `deps` scan** (`check-dependency-direction.mjs`). ✅ One scan. ❌ That scan is about
   inter-workspace DIRECTION/cycles, not third-party allowlisting; overloading it conflates two concerns and its
   output would confuse a direction violation with a neutrality violation. REJECTED (SRP).
3. **Keep the per-feature unit floors only.** ✅ Zero new scan. ❌ A unit test does not fire on a `package.json`
   edit that adds a heavy dep without touching the neutral source; the gap the backlog names stays open. REJECTED.

### Decision

Adopt (1): a standing `scan-agent-tools-neutrality.mjs` dependency-allowlist floor, registered in run-all-scans,
with a red-fixture unit test. Scope covers the retrieval (SELFHOST-003) + computer-use (SELFHOST-010) neutrality
invariant at the dependency layer; the per-feature source unit floors stay as the finer-grained check.

## Solution

`findDisallowedDeps(packageJson)` — pure: enumerate the **union of runtime-reachable dep kinds**
`dependencies` ∪ `peerDependencies` ∪ `optionalDependencies` (drop `@robota-sdk/*` in each), and return those not
in `ALLOWLIST = {fast-glob, p-limit, zod}`. **`devDependencies` are excluded with a documented rationale**:
agent-tools is NOT a bundled/INFRA-028 package (only `agent-cli` is in `BUNDLED_WORKSPACE_PACKAGES`), so it
externalizes runtime deps into `dependencies`/`peerDependencies` and its devDeps (tsdown/typescript/vitest) never
reach `dist`. **Reviewer-caught correctness fix (proposal-review REVISE→applied): reading only `dependencies`
would leave `peerDependencies`/`optionalDependencies` as an un-fenced smuggling vector** — a heavy SDK declared as
a peer ("the consumer must install playwright") or optional (dynamic-`require`-reachable) dodges both a
`dependencies`-only scan AND the source-import unit floor; agent-tools already uses `peerDependencies` (for
`agent-core`), so it is a live evasion path. The scan reads `packages/agent-tools/package.json`, calls
`findDisallowedDeps`, and exits 1 with a clear message (name the offending dep + fix: inject it as a duck-typed
port from the surface) if non-empty. Registered in run-all-scans. Unit test with red fixtures for BOTH a
`dependencies` heavy SDK and a `peerDependencies` heavy SDK + a green fixture + the live-package-clean assertion.

## Affected Files

| File                                                                   | Change                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `scripts/harness/scan-agent-tools-neutrality.mjs` (new)                | dependency-allowlist floor + pure `findDisallowedDeps` |
| `scripts/harness/run-all-scans.mjs`                                    | register `agent-tools-neutrality`                      |
| `scripts/harness/__tests__/scan-agent-tools-neutrality.test.mjs` (new) | red/green fixtures + live-package-clean assertion      |
| `.agents/backlog/HARNESS-027-agent-tools-neutrality-floor.md`          | → `done` on completion                                 |

## Completion Criteria

- [x] TC-01: `findDisallowedDeps` returns [] for the current `agent-tools` deps and flags an added heavy SDK
      (e.g. `playwright`/`tree-sitter`/`@pinecone-database/pinecone`) not on the allowlist, in EACH of
      `dependencies`, `peerDependencies`, `optionalDependencies` (unit test, red-in-each-kind + green). `devDependencies` are not checked (documented: not shipped).
- [x] TC-02: the scan is registered in `run-all-scans.mjs` and green on the current tree; a fixture package with a
      disallowed dep exits 1 (mechanical FAIL floor).
- [x] TC-03: closes SELFHOST-010-P4 — the same floor fences a heavy browser SDK from `agent-tools` (documented).

## Test Plan

| TC    | Verification                                        | Type/Tool                      |
| ----- | --------------------------------------------------- | ------------------------------ |
| TC-01 | allowlist diff: clean now, flags an added heavy SDK | vitest unit (fixtures)         |
| TC-02 | registered + green; disallowed-dep fixture exits 1  | scan run + unit                |
| TC-03 | browser/vector/parser SDK fenced (010-P4)           | covered by TC-01 fixture + doc |

## Tasks

- **P1** — the scan + registration + test (this). Task tracked inline (single-slice INFRA floor).

## Evidence Log

- 2026-07-19 — **Draft authored**, grounded in the actual `agent-tools/package.json` (third-party runtime deps =
  `{fast-glob, p-limit, zod}`; peer `@robota-sdk/agent-core`), the existing neutrality-scan house pattern
  (`scan-orchestration-neutrality.mjs`, `scan-memory-neutrality.mjs`), and the gap the backlog names (`deps` +
  `interface-*` scans do not fence `agent-tools` third-party deps). Prior-art waived (internal harness mechanism).

### [GATE-WRITE] — ✅ PASS | 2026-07-19

**Status upgrade:** draft → review-ready

- **Frontmatter:** File opens with `---` YAML block; `status: draft` present; `type: INFRA` (valid 11-prefix value); `tags:` present (non-empty array). PASS.
- **Problem:** Concrete symptom (neutrality enforced only by per-feature unit floors + a one-time manual grep; no `harness:scan` rule fences the `agent-tools` third-party dependency set — `deps` checks only inter-workspace direction/cycles, `interface-*` covers only `agent-interface-*`) + reproduction condition (a future heavy SDK added to `agent-tools/package.json` without touching neutral source escapes every scan). No TBD/TODO/vague prose. PASS.
- **Prior Art Research:** `## Prior Art Research` present with an explicit `Waived: <reason>` line (internal harness mechanism — a package dependency-allowlist scan mirroring the repo's own `scan-orchestration-neutrality.mjs`/`scan-memory-neutrality.mjs` house pattern, no external product prior art). Waiver permitted for an internal harness floor. PASS.
- **Architecture Review:** Affected Scope enumerated; Alternatives Considered has 3 entries, each with pro (✅) and con (❌); Decision references the trade-off that drove the choice (SRP / always-firing over overloading the `deps` scan or relying on unit floors that miss `package.json` edits). Matches the repo's prose Architecture-Review convention (cf. done SELFHOST-010). **New-surface placement: N/A** — introduces a harness scan script (`scan-agent-tools-neutrality.mjs`) mirroring existing house-pattern scans, not a new package/app/presentation/interface surface and no layer/product-family reclassification. PASS.
- **Solution:** Present — pure `findDisallowedDeps(packageJson)` + scan wiring + red/green unit fixtures. PASS.
- **Affected Files:** Present (4-row table: new scan, run-all-scans registration, new test, backlog → done). PASS.
- **Completion Criteria:** TC-01/TC-02/TC-03 all carry `TC-N` prefix; each uses observable/command form (returns `[]`, exits `1`, fenced+documented); no banned vague phrasing. PASS.
- **Test Plan:** `## Test Plan` present; 3 rows (TC-01/TC-02/TC-03) match the 3 Completion Criteria exactly; each row has non-empty Type/Tool (vitest unit / scan run); no `manual`-tool rows requiring a Notes justification. **TC-N count matches: 3 = 3.** PASS.
- **Structure:** `## Tasks` present with a P1 placeholder; `## Evidence Log` present (only the informational Draft-authored note — no fabricated prior-gate entry); no `## Status` or `## Classification` body sections (those are frontmatter fields). PASS.

All GATE-WRITE criteria met. Status upgrade to `review-ready` authorized.

### [GATE-APPROVAL] — ❌ FAIL | 2026-07-19

**Status remains:** review-ready

**Precondition (met):** GATE-WRITE PASS entry recorded above + frontmatter `status: review-ready`.

**Criteria evaluated:**

- **(b) Owner/user sign-off — MET.** Explicit standing directive quoted verbatim from the current session:
  "모든 남은 백로그들 중 너가 스스로 수행 가능한 것부터 우선순위 대로 모두 끝까지 진행해" (translation: "Of all the
  remaining backlog items, proceed with the ones you can perform yourself, in priority order, all the way to
  completion"). This is a direct authorization to proceed on self-performable backlog items; HARNESS-027 is an
  internal, self-performable harness floor, so the directive constitutes the owner sign-off for this item.
- **(a) Independent design sign-off — NOT MET (pending).** GATE-APPROVAL requires an independent design review
  (a `proposal-reviewer` ENDORSE verdict) recorded in this Evidence Log. No such ENDORSE entry is present yet. An
  independent `proposal-reviewer` design pass is being run in parallel by the orchestrator; its verdict must be
  appended here before GATE-APPROVAL can PASS. Per guard policy, an ENDORSE is NOT fabricated.

**Failed criteria:**

- Independent design sign-off: required a recorded `proposal-reviewer` ENDORSE in the Evidence Log; none present.
  **Required action:** the orchestrator appends the `proposal-reviewer` verdict. If ENDORSE, re-run GATE-APPROVAL —
  both criteria (owner sign-off already met + independent ENDORSE) will then be satisfied and the gate PASSes
  (`review-ready → approved`). If REVISE/REJECT, address the findings first.
- 2026-07-19 — **GATE-APPROVAL: proposal-review REVISE → applied.** Independent `proposal-reviewer` verified the
  premises against code (no existing scan fences agent-tools third-party deps; the `deps` scan is direction/cycles
  only; `interface-*` cover only `agent-interface-*`; current third-party set = `{fast-glob, p-limit, zod}`) and
  endorsed the direction + both alternative rejections, with ONE required fix: enumerate the **union of
  runtime-reachable dep kinds** (`dependencies` ∪ `peerDependencies` ∪ `optionalDependencies`), not `dependencies`
  alone — else a heavy SDK smuggled as a peer/optional dep dodges the floor (agent-tools already uses
  `peerDependencies`, a live evasion path), and add a peer-dep red fixture; exclude `devDependencies` with a stated
  rationale (not shipped; agent-tools is not a bundled package). **Applied** to Solution + TC-01. This is the
  reviewer's explicitly-stated approvable form ("the change I would approve").
- 2026-07-19 — **Owner sign-off** (GATE-APPROVAL): the owner's explicit standing directive this session authorizes
  self-performable backlog items — "모든 남은 백로그들 중 너가 스스로 수행 가능한 것부터 우선순위 대로 모두 끝까지
  진행해" — recorded as the owner approval for this internal harness floor.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-19

**Status upgrade:** review-ready → approved

- **Precondition (met):** GATE-WRITE PASS entry recorded above + frontmatter `status: review-ready`.
- **(a) Independent design sign-off — MET.** The `[GATE-APPROVAL: proposal-review REVISE → applied]` entry records an independent `proposal-reviewer` pass that verified the premises against code (no scan fences agent-tools third-party deps; `deps` = direction/cycles only; `interface-*` = `agent-interface-*` only; current set = `{fast-glob, p-limit, zod}`), endorsed the direction + both alternative rejections, and returned REVISE with ONE correctness fix (enumerate the union of runtime-reachable dep kinds `dependencies` ∪ `peerDependencies` ∪ `optionalDependencies`, not `dependencies` alone) — the reviewer's explicitly-stated approvable form ("the change I would approve").
- **REVISE fix confirmed reflected in Solution.** Union of dep kinds present (Solution: "union of runtime-reachable dep kinds `dependencies` ∪ `peerDependencies` ∪ `optionalDependencies`"; TC-01: "in EACH of dependencies, peerDependencies, optionalDependencies"); peer-dep red fixture present ("red fixtures for BOTH a `dependencies` heavy SDK and a `peerDependencies` heavy SDK"); `devDependencies` exclusion rationale present (not a bundled/INFRA-028 package; devDeps never reach `dist`).
- **(b) Owner/user sign-off — MET.** Explicit standing directive quoted verbatim from the current session: "모든 남은 백로그들 중 너가 스스로 수행 가능한 것부터 우선순위 대로 모두 끝까지 진행해" — a direct authorization to proceed on self-performable backlog items; HARNESS-027 is an internal, self-performable harness floor.
- **No post-approval mutation.** Architecture Review / frontmatter type/tags not modified after the sign-offs.
- **New-surface placement: N/A** — introduces a harness scan script mirroring the existing neutrality-scan house pattern, not a new package/app/presentation/interface surface.

Both GATE-APPROVAL criteria met (independent design sign-off applied + owner sign-off quoted). Status upgrade to `approved` authorized.

- 2026-07-19 — **[IMPLEMENTED]** `scripts/harness/scan-agent-tools-neutrality.mjs` (registered `agent-tools-neutrality`) — `findDisallowedDeps` checks `dependencies` ∪ `peerDependencies` ∪ `optionalDependencies` (excludes `@robota-sdk/*` + devDeps), fails on any non-allowlisted third-party (allowlist `{fast-glob,p-limit,zod}`). 4 unit tests (clean allowlist+workspace; heavy SDK flagged in EACH runtime dep kind; devDeps not checked; live package clean). **60/60 harness scans**. Closes SELFHOST-010-P4 (TC-03). GATE-VERIFY→GATE-COMPLETE next.

### [GATE-VERIFY] — ✅ PASS | 2026-07-19

**Status upgrade:** in-progress → verifying

- All TC-01..03 `[x]` with evidence; scan green + 4 unit tests; 60/60 harness scans; single-slice INFRA floor (task inline).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-19

**Status upgrade:** verifying → done

- Scan registered + green; backlog HARNESS-027 → completed/; SELFHOST-010-P4 closed; no code beyond the floor + test.
