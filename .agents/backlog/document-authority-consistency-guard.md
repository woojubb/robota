# Document Authority Consistency Guard

## Status

Backlog.

## Created

2026-05-09

## Priority

P1 - keeps architecture, design, SPEC, README, and backlog content in the right owner documents.

## Problem

The rules now define separate authority for architecture documents, design documents, package/app
SPEC files, cross-cutting specs, public docs, tasks, and backlog items. Future changes can still
leave accepted contracts only in a design note, task file, backlog item, README, or PR summary.

## Recommended Direction

Extend harness documentation scans to detect likely document-authority drift.

Recommended checks:

- architecture-map changes that include long implementation plans, rejected-option analysis, or
  package-local API inventories should be flagged for review;
- changed design documents that describe accepted public API or package boundaries should require a
  matching SPEC/API/architecture-map diff before merge;
- changed package source or package public exports should require the owning `docs/SPEC.md` to be
  inspected or updated;
- changed architecture-map dependency direction or ownership language should require the relevant
  package SPEC links to exist;
- README/content updates that introduce new behavior should require matching owner SPEC or API
  coverage.

The first version can be conservative and report warnings with file paths. Promote to hard failures
only after the false-positive rate is understood.

## Non-Goals

- Do not parse every markdown sentence as a contract.
- Do not prevent design documents from containing plans, tradeoffs, or research.
- Do not replace human review for package-specific contract correctness.

## Acceptance Criteria

- [ ] `pnpm harness:scan` includes a document-authority consistency check or warning report.
- [ ] The check distinguishes architecture maps, design documents, package/app SPEC files, public
      docs, task files, and backlog files.
- [ ] Tests cover at least one misplaced contract in a design document, one architecture-map
      implementation-plan warning, and one valid owner SPEC update.
- [ ] The check output recommends the correct owner document based on `.agents/rules/spec-workflow.md`.

## Verification Plan

- `pnpm harness:scan`
- Unit tests for the document-authority scan.
