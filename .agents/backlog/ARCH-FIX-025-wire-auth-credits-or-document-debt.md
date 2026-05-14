---
title: 'ARCH-FIX-025: Wire auth/credits packages or formally document as forward-declared debt'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/auth, packages/credits, apps/agent-server
---

## Problem

Neither `@robota-sdk/auth` nor `@robota-sdk/credits` is depended on by any production package
or app. `apps/agent-server/src/websocket-server.ts` lines 4, 66, 178–191 implement inline JWT
verification using `jsonwebtoken` directly with inline JWT secret handling, bypassing the auth
port entirely.

The architecture states that auth/credits policy is centralized in these packages, but this
policy is not enforced at runtime anywhere.

**Evidence**: Zero hits for `@robota-sdk/auth` or `@robota-sdk/credits` in any production
`package.json`. `apps/agent-server/src/websocket-server.ts` uses `jsonwebtoken` directly.

**Source**: ARCH-SA-003 (System Architect review 2026-05-15)

## Decision Required

Choose one path:

**Option A — Wire**: Add `@robota-sdk/auth` as a dependency of `apps/agent-server`. Replace
inline JWT verification in `websocket-server.ts` with the auth verifier port from the package.
Ensure the auth contract is actually enforced at the WebSocket connection boundary.

**Option B — Document debt**: Classify `auth` and `credits` as forward-declared contracts not
yet wired. Add a `## Status` section to `packages/auth/docs/SPEC.md` and
`packages/credits/docs/SPEC.md` stating: "Forward-declared contract. Not wired in production as
of YYYY-MM-DD." Document `apps/agent-server` inline auth as acknowledged technical debt with a
migration path and a tracking backlog item.

## Test Plan

**If Option A**:

- `pnpm --filter @robota-sdk/agent-server build` passes
- Unit tests for `websocket-server.ts` validate auth via the port, not via direct `jsonwebtoken`
- `pnpm test` passes

**If Option B**:

- `packages/auth/docs/SPEC.md` and `packages/credits/docs/SPEC.md` updated with Status section
- `apps/agent-server/docs/SPEC.md` updated with inline auth debt acknowledgement

## User Execution Test Scenarios

**Scenario (Option A)**: Auth enforcement via package

Prerequisites: `apps/agent-server` wired with `@robota-sdk/auth`

Steps:

1. Start `agent-server` locally
2. Connect to WebSocket endpoint without a valid JWT
3. Observe connection is rejected with auth error

Expected: Connection rejected. No inline `jsonwebtoken` usage in server code.

Evidence: (to be filled after implementation)
