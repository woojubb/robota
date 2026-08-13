---
title: 'REFACTOR-026: published-package hygiene sweep — committed scratch files in agent-framework, an unused workspace dependency in apps/agent-web, and publish residue on private product-shell manifests'
status: todo
created: 2026-08-13
priority: low
urgency: later
area: packages/agent-framework, apps/agent-web, packages/agent-playground, packages/agent-testing, packages/agent-provider-openai
depends_on: []
---

# REFACTOR-026: manifest and file hygiene

## Problem

Several small, mechanical hygiene defects across published/private packages: junk files committed to a
published package root, a manifest dependency edge nothing imports, and publish-config residue on
packages that are `private: true`.

## Evidence

- `packages/agent-framework/only-in-a.txt` (2 bytes) and `packages/agent-framework/out.txt` (11 bytes)
  — scratch files committed in `e02479c38` (TEST-003), sitting in a published package's root.
- `apps/agent-web/package.json` — declares `@robota-sdk/agent-transport-gui` in dependencies but never
  imports it (`rg` finds zero imports; not in `next.config.ts` `transpilePackages`) — vestigial from
  the removed `/monitor` route. Under `project-structure.md:118` this manifest entry IS an edge in the
  ground-truth graph, documented by no doc and used by no source.
- `packages/agent-playground/package.json` — `"description": "Deployable Playground UI package…"` +
  `publishConfig: { access: 'public' }` + `prepublishOnly` publish check, contradicting `private:
true` and the registry's Private entry.
- `packages/agent-testing/package.json` — `private: true` but carries a stray `publishConfig: {
access: 'public' }` (its SPEC also wrongly claims it is published — that half is DOCS-024).
- `packages/agent-provider-openai/src/openai/loggers/console.ts` and `file.ts` — 9-line pass-through
  re-export shims with zero importers (`project-structure.md:232-233` bans pass-through re-exports).

## Direction

Delete the two scratch files; remove the unused `agent-transport-gui` dependency from `apps/agent-web`
(restoring manifest↔doc↔code agreement — or re-add the documented monitor mount, but GUI-007 points at
removal); align the `agent-playground` manifest description with "private product shell" and drop
`publishConfig`/`prepublishOnly`; drop the stray `publishConfig` from `agent-testing`; delete the two
unconsumed pass-through logger shims (or fold them into the owner).

## Test Plan

- `git rm` the scratch files; `rg` confirms no `agent-transport-gui` import in `apps/agent-web/src`
  before removing the dep; build of `apps/agent-web` still green.
- `pnpm harness:scan` green (pass-through-re-export scan clean after the logger-shim removal;
  publish-registry scan clean).

## User Execution Test Scenarios

Not applicable — manifest/file hygiene with no runnable user-facing behavior. Verification is the
build/scan checks in the Test Plan.
