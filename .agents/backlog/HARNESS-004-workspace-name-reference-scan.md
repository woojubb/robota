---
title: 'HARNESS-004: Workspace package-name reference resolution scan'
status: todo
created: 2026-06-11
priority: high
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-004: Workspace package-name reference resolution scan

## Problem

The REFACTOR-024 rename (agent-web → agent-web-ui) left `@robota-sdk/agent-web` references in
agent-cli's package.json build script and scripts/copy-web-assets.mjs — develop was locally
unbuildable (`No projects matched the filters`) and nobody noticed because CI uses a different
build path.

## Proposed Check

`harness:scan:workspace-refs` — collect `@robota-sdk/*` (and `robota-*` app name) tokens from
all `package.json` scripts and `scripts/**/*.mjs`, and fail when a token does not resolve to an
existing workspace package name.

## Test Plan

- Scanner unit test with fixture (resolvable name passes, renamed-away name fails).
- Live dry run over the repo.

## User Execution Test Scenarios

Not applicable — harness/internal tooling.
