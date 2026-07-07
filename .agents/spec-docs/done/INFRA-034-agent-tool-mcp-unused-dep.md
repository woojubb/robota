---
status: done
type: INFRA
tags: [mcp]
---

# INFRA-034: Remove agent-tool-mcp's unused agent-tools dependency (ARL-05)

## Problem

`packages/agent-tool-mcp/package.json` lists `@robota-sdk/agent-tools` (`workspace:*`) in its
**`devDependencies`** (line 41) but the package **never imports it** — `rg "@robota-sdk/agent-tools"
packages/agent-tool-mcp/src` (and its tests) returns nothing (every source/test imports only
`@robota-sdk/agent-core`). The package's own SPEC boundary (`docs/SPEC.md:9-10`) states it must not import
any `agent-*` package other than `agent-core`. A declared-but-unused `workspace:*` devDependency still
creates a real pnpm topological build-order edge and is a false coupling signal — it misrepresents the
package's dependency graph and contradicts its own boundary. Surfaced as ARL-05 by the
architecture-refresh pass. Note: **no harness scan detects an unused declared dependency** (the `deps`
scan checks direction/cycles; `dep-kind` flags only _used_ imports mis-declared as dev) — which is why
ARL-05 required a manual pass to find, and why the verification below relies on build + typecheck + `rg`,
not a scan.

**Reproduction condition:** `rg "@robota-sdk/agent-tools" packages/agent-tool-mcp/src` → no matches, yet
the manifest lists it as a dependency.

## Architecture Review

### Affected Scope

- **`packages/agent-tool-mcp/package.json`** — remove the unused `@robota-sdk/agent-tools` entry.
- Docs: `.agents/architecture-remediation-log.md` (ARL-05 → Resolved). A changeset is not warranted — a
  dependency-manifest cleanup with no code/API change and no runtime effect.

### Alternatives Considered

1. **Remove the unused dependency (chosen).** It is imported nowhere and the package's SPEC forbids
   depending on non-`agent-core` `agent-*` packages; removing it makes the manifest match reality.
   - _Pro:_ accurate dependency graph (manifest matches reality + the package's own agent-core-only
     boundary); no build-order coupling to a package it does not use.
   - _Con:_ none of substance — it is dead metadata.
2. **Keep it and record a build-ordering reason in the manifest.** _Rejected —_ there is no build-ordering
   need (nothing in the package uses agent-tools at build or runtime); inventing a justification to keep
   dead metadata is worse than removing it.

### Decision

Remove `@robota-sdk/agent-tools` from `agent-tool-mcp`'s dependency manifest. It is unused; keeping it is
a false coupling signal that contradicts the package's own boundary.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-tool-mcp (package.json), remediation log
- [x] Sibling scan 완료 — verified zero imports of `@robota-sdk/agent-tools` across `agent-tool-mcp/src` + tests (rg); no other manifest or tooling references it — N/A for other packages (single-package manifest change)
- [x] 대안 최소 2개 검토 완료 — 2 alternatives; keep-with-reason rejected (no build-ordering need)
- [x] 결정 근거 문서화 완료 — dead metadata contradicting the package boundary; remove to match reality

## Solution

1. Remove the `@robota-sdk/agent-tools` line from `packages/agent-tool-mcp/package.json` `devDependencies`.
2. `pnpm install` to update the lockfile.
3. Mark ARL-05 Resolved in the remediation log.
4. Verify: `rg` (still zero imports) + `pnpm build` (agent-tool-mcp) + `pnpm typecheck` — the authoritative
   checks. Run `pnpm harness:scan` (45/45) as a non-regression sanity check (it does not detect unused
   declared deps, so it passes regardless).

## Affected Files

- `packages/agent-tool-mcp/package.json`
- `pnpm-lock.yaml`
- `.agents/architecture-remediation-log.md` (ARL-05 → Resolved)

## Completion Criteria

- [ ] TC-01: `packages/agent-tool-mcp/package.json` `devDependencies` no longer lists `@robota-sdk/agent-tools`; `rg` confirms it is imported nowhere in the package (unchanged — it never was). This grep + the manifest are the **authoritative** evidence.
- [ ] TC-02: `pnpm build` for `@robota-sdk/agent-tool-mcp` and `pnpm typecheck` succeed without the dependency (proves nothing relied on it).
- [ ] TC-03: `pnpm harness:scan` (45/45) green — a **non-regression sanity check only**; the `deps`/`dep-kind` scans do NOT detect an unused declared dependency and pass identically with or without it (so scan-green is not evidence this change is correct — TC-01/TC-02 are).
- [ ] TC-04: ARL-05 marked Resolved in the remediation log.

## Test Plan

Test strategy (INFRA, manifest-only): the **authoritative** checks are manual `rg` (zero imports of agent-tools) + `pnpm build` + `pnpm typecheck` — nothing relied on the dep. `harness:scan` is a non-regression sanity check only: no repo scan detects an unused declared dependency (`deps` = direction/cycles; `dep-kind` = used-but-mis-declared), so it passes identically with or without the removal.

| TC-ID | Test Type  | Tool / Approach                                                 | Notes                                      |
| ----- | ---------- | --------------------------------------------------------------- | ------------------------------------------ |
| TC-01 | Structural | `rg`/manifest read — devDep removed; still zero imports         | authoritative — matches reality            |
| TC-02 | Build/CI   | `pnpm --filter @robota-sdk/agent-tool-mcp build && … typecheck` | authoritative — nothing relied on it       |
| TC-03 | CI/harness | `pnpm harness:scan`                                             | non-regression sanity (no unused-dep scan) |
| TC-04 | Structural | remediation-log diff review                                     | ARL-05 Resolved                            |

## Tasks

- [ ] `.agents/tasks/INFRA-034.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter valid; Problem has concrete symptom + reproduction (rg evidence); Architecture Review checklist all [x] with sibling scan; ≥2 alternatives with pro/con; TC-N completion criteria + matching Test Plan rows; Tasks placeholder; empty Evidence Log; no `## Status`/`## Classification`.

### [Design Review] — proposal-reviewer | 2026-07-07

Round 1 → REVISE; Round 2 → **ENDORSE** (verified against code). Decision sound + rule-aligned.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): approved when the neutral proposal-reviewer ENDORSEs a sound, rule-aligned recommendation. Reviewer returned ENDORSE. No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
Tasks file `.agents/tasks/INFRA-034-agent-tool-mcp-unused-dep.md` created; path recorded; TC-mapped; includes Test Plan / 검증.

### [GATE-VERIFY] — ✅ PASS | 2026-07-07

**Status upgrade:** in-progress → verifying
TC-01: `@robota-sdk/agent-tools` removed from agent-tool-mcp devDependencies; still imported nowhere (rg). TC-02: build + typecheck green without it. TC-03: harness:scan 45/45 (non-regression sanity). TC-04: ARL-05 → Resolved. No changeset (private package).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

**Status upgrade:** verifying → done
Dead devDependency removed; manifest matches the package's agent-core-only boundary. proposal-reviewer ENDORSE (after 1 REVISE correcting the false "deps scan detects unused dep" premise).
