---
title: "CORE-040: MCPTool and RelayMcpTool each hand-roll a top-level required-presence check instead of validating against the universal schema subset, so an MCP tool's declared parameter types, enums, bounds and every nested field are advertised to the model and enforced by nothing"
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-tool-mcp, packages/agent-core
depends_on: [CORE-039]
---

# CORE-040: the two MCP tool validators bypass the subset validator

Filed by [CORE-039](CORE-039-universal-schema-subset-treats-object-as-a-leaf.md), whose thesis is
"one walk owns what a node means". CORE-039 unifies the walks it can reach; these two it names and
leaves standing, so the claim is not overstated.

## Problem

`MCPTool.validateParameters` (`packages/agent-tool-mcp/src/mcp-tool.ts:125-139`) and
`RelayMcpTool.validateParameters` (`packages/agent-tool-mcp/src/relay-mcp-tool.ts:102-118`) each
implement their own validation: a presence check over the schema's **top-level `required`** list and
nothing else. No type checking, no enum, no bounds, no nested traversal.

So for an MCP tool, `parameters` is a contract the model is shown and the runtime does not hold. A
payload with the right key names and entirely wrong value types reaches the tool handler unchallenged.

## Why it was not fixed in CORE-039

Three reasons, all recorded there rather than discovered later:

- Different package (`agent-tool-mcp`, not `agent-core`), so it is outside that item's unit.
- No measured defect behind it — unlike the six walks CORE-039 does fix, nothing was observed failing.
- Absorbing it would require newly exporting `validateToolParameters` from agent-core's barrel; today
  `packages/agent-core/src/index.ts:26` exports only `validateAgainstJsonSchema`. Widening a published
  barrel is its own decision and does not belong inside a bug fix.

## Direction

Route both classes' `validateParameters` through the same validator `FunctionTool` uses, so an MCP tool's
declared schema is enforced exactly as a function tool's is. That requires deciding what agent-core
exports for the purpose — either widen the barrel with `validateToolParameters`, or have the MCP tools
call the already-exported `validateAgainstJsonSchema` directly against the whole parameter object.
Prefer the second if it holds: it needs no new published surface, and after CORE-039 that function is
the single complete walk.

Note the trust boundary this crosses that CORE-039's does not: an MCP tool's `inputSchema` is authored by
a **third-party server**, not by this repo. Enforcing it faithfully is the point, but a schema this repo
did not write is more likely to use constructs outside the universal subset — so the failure mode when
the subset cannot express an incoming schema must be decided here, not assumed.

## Test Plan

- Tests over both classes: a payload with a required key present but of the wrong type is rejected;
  a payload violating a nested requirement is rejected; a conforming payload passes.
- A test pinning the chosen behaviour for an `inputSchema` carrying a construct the subset cannot express.
- `pnpm harness:verify -- --scope packages/agent-tool-mcp` green.

## User Execution Test Scenarios

To be authored when this item is picked up. Expected to be `agent-executable` and provider-free: register
an MCP tool whose schema declares a typed parameter, invoke it through the product surface with a wrongly
typed argument, and observe the rejection naming the parameter.
