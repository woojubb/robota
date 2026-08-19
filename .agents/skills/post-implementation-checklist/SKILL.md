---
name: post-implementation-checklist
description: Router for the mandatory post-implementation sequence — SPEC sync, build/test, README, commit/PR, publish, content/ docs, docs deploy. Each step's detail lives in its owning skill/rule; this file only fixes the order and the gates. Execute automatically after implementation work; do not wait for the user to request it.
loop: over=finding-set; escape=no-progress
invocable: true
---

# Post-Implementation Checklist (router)

Every implementation task that modifies package code MUST run this sequence before being marked
done. This file owns only the **order and the gates** — each step's how-to lives in the owning
skill/rule linked below.

## Sequence (execute in order)

1. **SPEC sync (GATE — before any verification).** Update each modified package's `docs/SPEC.md`
   to the new behavior and run the bidirectional SPEC↔code verification loop until a clean cycle, or
   until the same finding set recurs unchanged — then STOP and escalate to the user ([no-progress escape](../../rules/enforcement-architecture.md), which owns what that means) →
   [spec-code-conformance](../spec-code-conformance/SKILL.md). Do not proceed until SPECs are
   updated and committed.
2. **Auto-fix before final verification.** Stage only the intended paths, run
   `pnpm lint:fix:staged`, inspect the automatically restaged result, and make every subsequent
   verification judge that post-fix tree. Use `pnpm lint:fix` only as an intentional occasional
   whole-repository sweep; review its complete diff before staging it, then run the same verification
   sequence. The pre-commit hook repeats the staged command only as a safety net — it is not the first
   time fixes should appear.
3. **Build and test.** `pnpm build` + `pnpm test` for modified packages must pass; check for stale
   references (deleted files, renamed types, removed exports). If any part was delegated, the
   delegated "green" must be independently reproduced before it counts →
   [verification.md](../../rules/verification.md) > Delegated Verification Claims (the pipeline for a
   single delegated mechanical change is
   [delegated-refactor-green-gate](../delegated-refactor-green-gate/SKILL.md)).
4. **README.** Update each modified package's `README.md` to match the SPEC changes (create it for
   new packages).
5. **Commit + PR.** Commit SPEC + README + code; keep one coherent work-unit in ONE multi-commit PR
   per the PR Batching policy and ship per [git-branch.md](../../rules/git-branch.md).
6. **npm publish (if public packages changed)** → [version-management](../version-management/SKILL.md)
   (changesets, prerelease mode, `pnpm publish:beta` only — never `pnpm publish --filter` /
   `npm publish` / `pnpm changeset publish`).
7. **content/ docs.** Update the affected `content/guide/*.md` for any user-facing behavior change.
   `content/v2.0.0/` is frozen — never modify.
8. **Docs deploy (GATE — 4 and 7 must be complete first).** Verify every modified SPEC has a
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

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop post-implementation-checklist
node scripts/harness/loop-run.mjs round --loop post-implementation-checklist --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop post-implementation-checklist --run <id> --terminal <reason>
```
