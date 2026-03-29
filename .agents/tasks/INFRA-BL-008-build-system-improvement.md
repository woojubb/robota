---
title: Build system improvement — resolve DTS race condition and evaluate tooling
status: backlog
created: 2026-03-30
priority: high
urgency: now
packages:
  - all (48 packages use tsup)
---

## Problem

`pnpm build` intermittently fails due to DTS (TypeScript declaration) race condition. tsup runs ESM/CJS bundling (~60ms) and DTS generation (~5-20s) as a single command. pnpm starts dependent packages based on topological order, but a dependency's DTS may not be ready when the dependent package's DTS build starts.

Observed failure: `dag-adapters-local` fails because `dag-core` DTS isn't ready yet. Reproduces consistently in CI, intermittently locally.

## Scope

This is a build system architecture decision affecting all 48 packages. Requires design spec before implementation.

## Options to Evaluate

1. **Two-pass build** — split root build into JS phase (parallel, no DTS) then DTS phase (topological order)
2. **TypeScript project references** — `tsc --build` handles DTS in correct order, tsup handles JS only
3. **tsdown migration** — tsup successor with built-in monorepo/workspace support and improved DTS
4. **Hybrid** — minimal fix for the specific race condition without full rearchitecture

## Constraints

- 48 packages affected — change must be systematic, not ad-hoc
- CI must pass reliably (current intermittent failure blocks deployments)
- Individual package `pnpm --filter <pkg> build` must still work
- Publishing workflow (`pnpm publish:beta`) must not break

## Supersedes

FIX-BL-002 (dag-adapters-local race condition) — that was the symptom, this is the root cause.

## Next Step

Design spec via brainstorming, then implementation plan.
