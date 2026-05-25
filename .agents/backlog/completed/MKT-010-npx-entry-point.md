---
title: 'MKT-010: npx @robota-sdk/agent-cli as primary entry point'
status: done
completed: 2026-05-23
created: 2026-05-23
priority: critical
urgency: now
area: README.md, packages/agent-cli/README.md, content/getting-started, content/guide/cli.md
depends_on: []
---

## Background

The original goal was enabling `npx robota` as a viral shortcut, but `robota` on npm is taken by an
unrelated package (Cisco Spark bot v0.2.0, hagemt). Additionally, the project uses `@robota-sdk/*`
scoped naming exclusively — creating an unscoped alias package is not permitted.

`npx @robota-sdk/agent-cli` already works: npm's npx resolves scoped package names directly.
The fix is making this command prominent in all user-facing documentation.

## Changes Made

- `README.md` (root): Added `npx @robota-sdk/agent-cli` as the first option in Quick Start
- `packages/agent-cli/README.md`: Reordered Installation — npx first, global install second
- `packages/agent-cli/docs/README-KO.md`: Same reorder in Korean
- `content/getting-started/README.md`: npx first in all three CLI install code blocks (Installation, No API key, Quick Start sections)
- `content/guide/cli.md`: Added npx above global install in Installation section

## Test Plan

- Verify `npx @robota-sdk/agent-cli --version` prints the version (requires published package)
- All code blocks in updated docs show npx as the first option

## User Execution Test Scenarios

Not applicable — documentation-only change.
