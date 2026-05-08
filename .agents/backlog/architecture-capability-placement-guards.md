# Architecture Capability Placement Guards

## Status

Backlog.

## Created

2026-05-09

## Priority

P1 - prevents product shells from accumulating reusable behavior.

## Problem

The architecture map now defines repository-wide capability placement rules, but most enforcement is
still human review. Product shells can regress by adding lifecycle state machines, provider
semantics, command behavior, or persistence contracts directly in UI-oriented packages.

## Recommended Direction

Add harness checks that scan source and package metadata for ownership drift.

Recommended first guard set:

- flag product-shell files that declare background registries, lifecycle transition tables,
  retention policy, command descriptor semantics, provider model catalogs, or permission policy;
- flag product-shell imports of lower-level internal modules that are not public package entries;
- flag command packages importing CLI, app, or provider implementation packages;
- flag provider packages importing command, CLI, app, or SDK implementation modules when only
  `agent-core` contracts should be needed;
- require architecture-map updates when a PR adds a new product shell, transport, command package,
  provider package, app/service boundary, or cross-package dependency edge.

This should be implemented as mechanical checks before adding more prose.

## Non-Goals

- Do not block composition-root adapter imports that are explicitly allowed by the architecture map.
- Do not encode every valid import edge manually if package metadata can provide the same signal.
- Do not make this a replacement for package `docs/SPEC.md` ownership checks.

## Acceptance Criteria

- [ ] `pnpm harness:scan` includes a capability-placement ownership check.
- [ ] The check reports product-shell ownership drift with file paths and violated concern names.
- [ ] Composition-root adapter imports can be allowlisted only with a documented owner contract.
- [ ] Tests cover at least one product-shell violation, one command-package violation, and one
      allowed composition-root import.
- [ ] The architecture-map update requirement is checked for new product shells or dependency edges.

## Verification Plan

- `pnpm harness:scan`
- Unit tests for the new harness check.
