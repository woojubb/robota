---
name: post-implementation-checklist
description: Router for the mandatory post-implementation sequence — SPEC sync, build/test, README, commit/PR, publish, content/ docs, docs deploy. Each step's detail lives in its owning skill/rule; this file only fixes the order and the gates. Execute automatically after implementation work; do not wait for the user to request it.
---

# Post-Implementation Checklist (router)

Every implementation task that modifies package code MUST run this sequence before being marked
done. This file owns only the **order and the gates** — each step's how-to lives in the owning
skill/rule linked below.

## Sequence (execute in order)

1. **SPEC sync (GATE — before any verification).** Update each modified package's `docs/SPEC.md`
   to the new behavior and run the bidirectional SPEC↔code verification loop until a clean cycle →
   [spec-code-conformance](../spec-code-conformance/SKILL.md). Do not proceed until SPECs are
   updated and committed.
2. **Build and test.** `pnpm build` + `pnpm test` for modified packages must pass; check for stale
   references (deleted files, renamed types, removed exports). If any part was delegated to a
   subagent, independently re-verify the "green" claim (typecheck, relevant scans,
   `pnpm install --frozen-lockfile` when the lockfile was touched) →
   [delegated-refactor-green-gate](../delegated-refactor-green-gate/SKILL.md).
3. **README.** Update each modified package's `README.md` to match the SPEC changes (create it for
   new packages).
4. **Commit + PR.** Commit SPEC + README + code; keep one coherent work-unit in ONE multi-commit PR
   per the PR Batching policy and ship per [git-branch.md](../../rules/git-branch.md).
5. **npm publish (if public packages changed)** → [version-management](../version-management/SKILL.md)
   (changesets, prerelease mode, `pnpm publish:beta` only — never `pnpm publish --filter` /
   `npm publish` / `pnpm changeset publish`).
6. **content/ docs.** Update the affected `content/guide/*.md` for any user-facing behavior change.
   `content/v2.0.0/` is frozen — never modify.
7. **Docs deploy (GATE — 3 and 6 must be complete first).** Verify every modified SPEC has a
   matching README update and every user-facing change a matching `content/guide/*.md` update, then
   `pnpm docs:build`; production deploys from `main` (Cloudflare Pages). `pnpm docs:deploy` is
   manual-upload only, on explicit intent.

## Rules

- The three documentation layers (SPEC.md → README.md → content/) must be in sync after every
  change — never skip a layer.
- NEVER publish without build + test passing; never deploy docs without building first.
- After a merge, the work is not done until the merge is **independently verified as landed** —
  see "Merge Landing Verification" in [git-branch.md](../../rules/git-branch.md) (dispatch the
  `merge-verifier` agent; verify each hop).
