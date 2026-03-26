---
name: post-implementation-checklist
description: Mandatory checklist after completing implementation work — SPEC verification, README update, npm publish, content/ docs update, docs site deploy
---

# Post-Implementation Checklist

Every implementation task that modifies package code MUST complete this checklist before being marked as done. No exceptions. The agent MUST execute this checklist automatically after implementation — do NOT wait for the user to request it.

## When to Use

- After completing a feature, refactoring, or bug fix that changes package code
- After creating a new package
- After renaming, moving, or deleting a package

## Checklist (execute in order)

### 0. SPEC Update (MANDATORY before verification)

**This step MUST be completed before any verification begins.** Code changes without SPEC updates make verification meaningless.

- [ ] For each modified package, update `docs/SPEC.md` to reflect the new code behavior
- [ ] SPEC describes the intended final state — write it as fact, not aspiration
- [ ] If new types, methods, or behaviors were added, they MUST appear in the SPEC
- [ ] If existing behavior changed, the SPEC MUST be updated to match
- [ ] Commit SPEC updates separately before starting verification

**GATE: Do NOT proceed to Step 1 until all SPECs are updated and committed.**

### 1. Bidirectional SPEC-Code Verification Loop

This is a **repeating cycle** that runs until zero issues are found.

**Direction 1 — Is the SPEC correct?**

- [ ] Read each modified package's `docs/SPEC.md`
- [ ] Check for internal contradictions or inconsistencies
- [ ] Verify type signatures are exact (not looser/tighter than code)
- [ ] Verify descriptions match actual behavior (not aspirational)
- [ ] Verify terminology is consistent across all SPECs
- [ ] Fix any SPEC inaccuracies

**Direction 2 — Does code match the SPEC?**

- [ ] Verify every SPEC claim has matching code (file:line)
- [ ] Verify `src/index.ts` exports match SPEC's Public API Surface
- [ ] Verify `package.json` dependencies match SPEC's Dependencies
- [ ] Verify architecture diagrams are current
- [ ] Fix any code that doesn't match SPEC

**Cross-SPEC consistency:**

- [ ] Verify related claims across packages are aligned (e.g., SDK SPEC ↔ Sessions SPEC)

**Cycle rule:** After fixing issues, re-run the full check. Repeat until a clean cycle with zero issues.

### 2. Build and Test

- [ ] Run `pnpm build` for modified packages — must succeed
- [ ] Run `pnpm test` for modified packages — must pass
- [ ] Verify no stale references (deleted files, renamed types, removed exports)

### 3. README Update

For each modified package:

- [ ] Read current `README.md`
- [ ] Update to match SPEC changes (API surface, usage examples, architecture)
- [ ] Create `README.md` if missing (new packages)

### 4. Commit

- [ ] Commit all SPEC + README + code changes
- [ ] Push to current branch

### 5. npm Publish (if public packages changed)

- [ ] Create changeset (`pnpm changeset`)
- [ ] Enter prerelease mode if needed (`pnpm changeset pre enter beta`)
- [ ] Apply version bump (`pnpm changeset version`)
- [ ] Commit version bump
- [ ] Run `pnpm publish:beta` (single command — dry-run → OTP → publish all → dist-tag sync)
- [ ] NEVER use `pnpm publish --filter`, `npm publish`, or `pnpm changeset publish`

### 6. content/ Documentation Update

- [ ] Update `content/guide/architecture.md` if architecture changed
- [ ] Update `content/guide/sdk.md` if SDK API changed
- [ ] Update `content/guide/cli.md` if CLI behavior changed
- [ ] Update other `content/guide/*.md` as needed
- [ ] Do NOT touch `content/v2.0.0/` (legacy, frozen)

### 7. Documentation Site Deploy

**GATE: Steps 3 and 6 (README + content/) must be verified complete before deploying.** If any SPEC was changed in this cycle, the corresponding README.md and content/guide/\*.md MUST already be updated. If not, go back and update them first. Do NOT deploy stale documentation.

- [ ] Verify: every modified SPEC.md has a matching README.md update
- [ ] Verify: every user-facing behavior change has a matching content/guide/\*.md update
- [ ] `cd apps/docs && pnpm build` — must succeed
- [ ] Deploy to gh-pages
- [ ] Cleanup temp clone

## Abbreviated Form

For small changes (1-2 packages, no new features):

1. SPEC check → 2. Build + test → 3. README → 4. Commit → 5. Publish → 6. content/ → 7. docs deploy

## Rules

- NEVER skip SPEC verification — it catches drift before it accumulates
- NEVER skip README update — every SPEC change must be reflected in README.md
- NEVER skip content/ update — every user-facing behavior change must be reflected in content/guide/\*.md
- The three documentation layers (SPEC.md → README.md → content/) must always be in sync after every change
- NEVER publish without build + test passing
- NEVER deploy docs without building first
- content/v2.0.0/ is frozen — never modify
- gh-pages deploy must preserve CNAME and .nojekyll
