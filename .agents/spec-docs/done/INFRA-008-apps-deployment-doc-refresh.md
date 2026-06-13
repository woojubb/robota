---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-008: Refresh apps-and-deployment.md

> Source: INFRA-002 audit findings **AF-10** (P1), **AF-18** (P2), **AF-19** (P2). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`.agents/specs/architecture-map/apps-and-deployment.md` is stale in three ways:

- **AF-10 (dead pipeline):** the Documentation Deployment mermaid references `apps/docs/scripts/copy-docs.js`
  and `apps/docs/scripts/copy-public.js` (the `apps/docs/scripts/` directory does not exist) and shows a
  `vitepress build` step. In reality `apps/docs` migrated to **Next.js**: build is `next build` +
  `pagefind --site out` (postbuild) → `apps/docs/out`, the content prep is `scripts/docs/prepare-docs.js`
  (`pnpm docs:build`), and manual deploy is `scripts/docs/deploy-cloudflare-pages.mjs` (`pnpm docs:deploy`).
- **AF-18 (missing apps):** the hosting/topology table documents only `apps/agent-web`, `apps/agent-server`,
  `apps/docs`, `apps/blog`. Three real apps are undocumented: `apps/action` (`@robota-sdk/action`, the
  official GitHub Action, `tsc`), `apps/starter-nextjs` (`@robota-sdk/starter-nextjs`, Next.js starter
  template), and `apps/www` (`robota-www`, Next.js marketing site on Cloudflare Pages — `wrangler.toml`,
  `pages_build_output_dir = "out"`).
- **AF-19 (deploy-platform ambiguity):** `apps/agent-web` is listed as deploying to **Vercel**, but the
  app ships both `vercel.json` AND `firebase.json` + `firestore.rules` + `firestore-indexes.json` — it is
  a Vercel-hosted frontend with a Firebase/Firestore backend, not Vercel-only.

**Reproduction condition:** `ls apps/docs/scripts` → not found; `ls apps/` shows 7 apps but the doc lists 4;
`ls apps/agent-web | grep -iE 'vercel|firebase'` shows both platforms.

## Architecture Review

### Affected Scope

- `.agents/specs/architecture-map/apps-and-deployment.md`
- (doc correction only — no `packages/*` production code)

### Alternatives Considered

1. **Patch only the dead `apps/docs/scripts/*` paths.** Pro: smallest. Con: leaves the stale VitepPress
   step, the missing apps, and the deploy ambiguity. Rejected.
2. **Full refresh of the doc** — rewrite the docs-deployment mermaid to the real Next.js pipeline, add the
   three missing apps to the topology table, and clarify agent-web's Vercel+Firebase reality. Pro:
   accurate end-to-end. Con: larger edit (one file). Chosen.

### Decision

Alternative 2 — refresh the whole apps-and-deployment.md to match the current 7-app reality, the Next.js
docs pipeline, and the agent-web Vercel+Firebase split.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — single doc: `apps-and-deployment.md`; no `packages/*` source
- [x] Sibling scan 완료 — N/A: single-doc refresh, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records full-refresh over minimal-patch

## Solution

1. Rewrite the Documentation Deployment mermaid: `content/ + package/app docs` → `scripts/docs/prepare-docs.js`
   (`pnpm docs:build`) → `apps/docs` `next build` → `pagefind --site out` → `apps/docs/out` → Cloudflare
   Pages (Git from `main`) and manual `scripts/docs/deploy-cloudflare-pages.mjs` (`pnpm docs:deploy`).
   Remove `copy-docs.js`/`copy-public.js`/`vitepress`.
2. Add rows for `apps/action`, `apps/starter-nextjs`, `apps/www` to the hosting/topology table.
3. Change the `apps/agent-web` deploy cell to "Vercel (frontend) + Firebase/Firestore (backend)".

## Affected Files

- `.agents/specs/architecture-map/apps-and-deployment.md`

## Completion Criteria

- [x] TC-01: `rg -n 'copy-docs|copy-public|vitepress' .agents/specs/architecture-map/apps-and-deployment.md`
      returns nothing; the docs-deployment mermaid names `next build`, `pagefind`, and `apps/docs/out`.
- [x] TC-02: the doc names all 7 apps — `rg -n 'apps/(action|starter-nextjs|www)' apps-and-deployment.md`
      returns a match for each of the three previously-missing apps.
- [x] TC-03: the `apps/agent-web` row names both Vercel and Firebase; `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                            | Notes                        |
| ----- | ---------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep over apps-and-deployment.md (dead paths gone; real ones present) | Command-form                 |
| TC-02 | CI pipeline smoke test | `rg` for each of action/starter-nextjs/www                                 | Command-form: 3 apps present |
| TC-03 | CI pipeline smoke test | `rg` for Vercel+Firebase on agent-web row + `pnpm harness:scan` exit 0     | Command-form                 |

## Tasks

- [x] `.agents/tasks/completed/INFRA-008.md` — archived at GATE-COMPLETE (TC-01, TC-02, TC-03 + Test Plan)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix); `tags: [typescript]` present.
- Problem: concrete symptoms (dead `apps/docs/scripts/*` + vitepress refs, 3 undocumented apps, agent-web Vercel+Firebase ambiguity) with reproduction conditions (`ls apps/docs/scripts`, `ls apps/`, `grep` agent-web); no TBD/TODO. Claims verified: `ls apps/` shows 7 apps, `apps/docs/scripts` not found.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit `N/A: single-doc refresh`; 2 alternatives with pro/con each; Decision references full-refresh-over-minimal-patch trade-off.
- Completion Criteria: TC-01/TC-02/TC-03 all TC-N prefixed; each command-form (`rg`, `pnpm harness:scan`); covers all 3 distinct sub-items; no banned vague language.
- Test Plan: `## Test Plan` present; 3 rows match 3 TC-N (count matches); each row has non-empty Test Type and Tool/Approach; no "manual" tool so notes-criterion N/A.
- Structure: Tasks section with placeholder present; Evidence Log was empty before this run; no `## Status` or `## Classification` body sections.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval present in current conversation: user approved the follow-up sequencing plan ("승인") and then replied "진행해" (proceed) to continue executing the doc-correction backlogs in sequence (INFRA-009 → INFRA-008 → INFRA-011 → BEHAVIOR-004). "진행해" is in the explicit-approval list.
- Direct, unambiguous, and directed at this spec: INFRA-008 is the next item in the approved sequence; "진행해" authorizes advancing it.
- No Architecture Review or frontmatter type/tags modified after approval: frontmatter `type: INFRA`, `tags: [typescript]`, and all 4 Architecture Review Checklist items remain intact from the GATE-WRITE pass.
- NON-COMPLIANCE trigger clear: no implementation started — `.agents/tasks/INFRA-008.md` not yet created (Tasks section shows 미생성), no code edits/commits.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- `.agents/tasks/INFRA-008.md` created (verified: file written, did not exist before this run).
- Tasks file path recorded in `## Tasks` section of the spec (`.agents/tasks/INFRA-008.md` — created at GATE-IMPLEMENT).
- Tasks correspond to Completion Criteria: 3 tasks, one per TC-N (TC-01 docs-deployment mermaid refresh, TC-02 add action/starter-nextjs/www rows, TC-03 agent-web Vercel+Firebase + `pnpm harness:scan`). `rg` count = 3 matches 3 TC-N.
- Tasks file includes `## Test Plan` section (header at line 24, body = 542 chars ≥ 50) — satisfies the test-plans harness scan requirement [AF-24].

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks file completion: all 3 tasks in `.agents/tasks/INFRA-008.md` (TC-01/TC-02/TC-03) marked `[x]`; none blocked or pending.
- Completion Criteria: all 3 TC-N checkboxes `[x]` in the spec.
- TC-01: `rg -n 'copy-docs|copy-public|vitepress' apps-and-deployment.md` → exit 1 (no matches, dead tokens gone); `rg 'next build|pagefind|apps/docs/out'` → matches at lines 32/66/67/68 (mermaid names `apps/docs: next build`, `pagefind --site out`, `apps/docs/out`).
- TC-02: `rg -n 'apps/(action|starter-nextjs|www)' apps-and-deployment.md` → match for each: `apps/www` (line 34), `apps/starter-nextjs` (line 35), `apps/action` (line 36).
- TC-03: `apps/agent-web` row (line 30) deploy cell = "Vercel (frontend) + Firebase/Firestore (backend)"; `pnpm harness:scan` → EXIT 0 (all 24 scans passed).
- Build/test: N/A — doc-only change to `.agents/specs/architecture-map/apps-and-deployment.md`, no `packages/*` source code affected. `harness:scan` (incl. test-plans + conformance) covers the doc-only verification surface.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- **Command (dead tokens):** `rg -n 'copy-docs|copy-public|vitepress' .agents/specs/architecture-map/apps-and-deployment.md` → no output, **exit 1** (dead tokens gone).
- **Command (real tokens):** `rg -n 'next build|pagefind|apps/docs/out' …apps-and-deployment.md` → **exit 0**, matches at lines 32, 35, 66, 67, 68 (mermaid names `apps/docs: next build`, `pagefind --site out`, `apps/docs/out`).
- **Test reference:** Test Plan TC-01 row = CI pipeline smoke test (`rg` grep over apps-and-deployment.md). Automated grep assertion is the test; no separate unit-test file applies to a doc-only change.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- **Command:** `rg -n 'apps/(action|starter-nextjs|www)' .agents/specs/architecture-map/apps-and-deployment.md` → **exit 0**, one match each: `apps/www` (line 34), `apps/starter-nextjs` (line 35), `apps/action` (line 36).
- **Test reference:** Test Plan TC-02 row = CI pipeline smoke test (`rg` for each of action/starter-nextjs/www). Grep assertion is the test.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- **Command (row content):** `rg -n 'agent-web' …apps-and-deployment.md` line 30 deploy cell = `Vercel (frontend) + Firebase/Firestore (backend)`; description names `vercel.json` + `firebase.json`/`firestore.rules`.
- **Command (scan):** `pnpm harness:scan` → **exit 0**; "all 24 scans passed" (incl. build-contracts, dist, docs-structure, conformance).
- **Test reference:** Test Plan TC-03 row = CI pipeline smoke test (`rg` for Vercel+Firebase + `pnpm harness:scan` exit 0). Both assertions executed and passed.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- All 3 Completion Criteria checkboxes are `[x]` (TC-01/02/03).
- Each TC-N has a matching `[GATE-COMPLETE: TC-N]` Evidence entry with command, output, and exit code above.
- Test Plan: every TC-N row carries a test reference (CI smoke-test grep / `harness:scan`); doc-only change has no unit-test surface, so command-form assertions serve as the tests — no TC-N left unaddressed.
- User-Execution done-gate: **N/A** — doc-only correction (AF-10/18/19); no `## User Execution Test Scenarios` section in this spec.
- Tasks file archived: `.agents/tasks/INFRA-008.md` → `.agents/tasks/completed/INFRA-008.md`; `## Tasks` section updated to the archived path.
