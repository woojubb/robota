---
name: post-implementation-checklist
description: Mandatory checklist after completing implementation work — SPEC verification, README update, npm publish, content/ docs update, docs site deploy
---

# Post-Implementation Checklist

Every implementation task that modifies package code MUST complete this checklist before being marked as done. No exceptions.

## When to Use

- After completing a feature, refactoring, or bug fix that changes package code
- After creating a new package
- After renaming, moving, or deleting a package

## Checklist (execute in order)

### 1. SPEC Verification

For each modified package:

- [ ] Read `docs/SPEC.md`
- [ ] Verify SPEC matches actual `src/index.ts` exports
- [ ] Verify SPEC matches actual `package.json` exports/dependencies
- [ ] Verify architecture diagrams are current
- [ ] Verify type names, function signatures, and descriptions match code
- [ ] Fix any mismatches — SPEC is SSOT, update SPEC first if behavior changed intentionally

### 2. Code-SPEC Conformance

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

- [ ] Version bump for changed packages
- [ ] `pnpm build` for packages to publish
- [ ] `pnpm publish --dry-run` — verify contents
- [ ] `pnpm publish --tag beta` with OTP
- [ ] Commit version bump, push

### 6. content/ Documentation Update

- [ ] Update `content/guide/architecture.md` if architecture changed
- [ ] Update `content/guide/sdk.md` if SDK API changed
- [ ] Update `content/guide/cli.md` if CLI behavior changed
- [ ] Update other `content/guide/*.md` as needed
- [ ] Do NOT touch `content/v2.0.0/` (legacy, frozen)

### 7. Documentation Site Deploy

- [ ] `cd apps/docs && pnpm build` — must succeed
- [ ] Deploy to gh-pages (clone → copy dist → push)
- [ ] Cleanup temp clone

## Abbreviated Form

For small changes (1-2 packages, no new features):

1. SPEC check → 2. Build + test → 3. README → 4. Commit → 5. Publish → 6. content/ → 7. docs deploy

## Rules

- NEVER skip SPEC verification — it catches drift before it accumulates
- NEVER publish without build + test passing
- NEVER deploy docs without building first
- content/v2.0.0/ is frozen — never modify
- gh-pages deploy must preserve CNAME and .nojekyll
