---
title: 'CATALOG-2525: the MCP catalog silently coerces a non-object tool root to accept-anything and never walks anyOf branches, so a root union or a oneOf inside a branch reaches execution unreported'
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: agent-mcp catalog / CORE-040 narrowing
depends_on: []
---

# CATALOG-2525: catalog root coercion and unwalked anyOf branches

## Objective

`toObjectParameterSchema` (`packages/agent-mcp/src/catalog/discovered-tool.ts:61-66`) replaces any
non-`object` root with `{ type: 'object', properties: {} }` before the tool exists — for the model AND for
the execution validator built on the same emptied root (`:107-110`) — with no `unenforceable` report and no
catalog `rejected` disposition; and `narrowNode` (`src/third-party-schema.ts:95`) returns an `anyOf` node
untouched without walking its branches, so a `type: 'object'` + `anyOf` root (invalid per
`agent-core/src/interfaces/tool-schema.ts:39-42`) or a branch carrying `oneOf` makes execution refuse every
payload. Both are silent ("Silence is not success"). Found by `proposal-reviewer` on MCP-005 (2026-09-22);
MCP-005's projector rejects a non-object root at the provider boundary but cannot see what the catalog
already coerced. Filed under umbrella issue #2525.

## Plan

- [ ] Make a non-object root a catalog `rejected` disposition with a reason (or an `adapted` one that reports the coercion), never a silent accept-anything.
- [ ] Walk `anyOf` branches in `narrowNode`, narrowing each branch by the same rules, and report a branch that is inexpressible.
- [ ] Extend `catalog-schema-narrowing.test.ts` / `catalog-dispositions.test.ts` with both cases.

## Test Plan

`pnpm --filter @robota-sdk/agent-mcp test`; the new cases assert the disposition and the reported reason.

## User Execution Test Scenarios

`/mcp list` shows the affected tool's disposition and reason instead of a silently emptied schema.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
