---
title: "CORE-040: MCPTool and RelayMcpTool each hand-roll a top-level required-presence check instead of validating against the universal schema subset, so an MCP tool's declared parameter types, enums, bounds and every nested field are advertised to the model and enforced by nothing"
status: done
created: 2026-08-16
completed: 2026-08-17
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

**The preferred option held: no new agent-core surface.** Both classes call the already-exported
`validateAgainstJsonSchema` against the whole parameter object; agent-core's barrel is untouched.

**The trust-boundary failure mode, decided rather than assumed.** The walk REJECTS a node outside the
subset — `unsupported schema type`, or `declares neither a type nor anyOf` for `oneOf` / `allOf` /
`$ref`. Handing a third-party `inputSchema` to it unchanged would therefore refuse **every** payload
for that tool, breaking a working third-party tool over a limitation that is this repo's rather than
the server's. Refusing is wrong; ignoring is wrong. So the schema is **narrowed**:

1. An inexpressible property subtree is REPLACED with an accepts-anything `anyOf` node, not deleted.
   Deleting it looked right and is wrong: an object node that declares `properties` is CLOSED, so a
   deleted key turns the server's own declared parameter into an "unexpected additional property"
   and refuses the payload for the opposite reason. This was caught by the scenario, not by
   reasoning — the first implementation deleted, and the case went red.
2. `required` is carried through untouched: a narrowed property is one whose VALUE cannot be checked,
   not one that stopped being required.
3. Everything expressible is enforced completely — nested objects, array items, enums, bounds.
4. The dropped paths are REPORTED — once per tool, since narrowing is a pure function of a schema
   that does not change. With no injected reporter it logs a warning; it is never silent
   (`enforcement-architecture.md`).

**One validator, not two.** The two classes carried the same hand-rolled check character for
character — the shape PROV-004 catalogues as how drift starts. `ThirdPartySchemaValidator` is the
single owner, and it lives in the package that owns the trust boundary.

**Also fixed, surfaced by the scenario:** `packages/agent-tool-mcp/package.json` declared no `source`
export condition, alone among its sibling packages. A `--conditions=source` consumer silently got the
BUILT output instead — which is how the scenario's first run reported pre-fix behaviour against
post-fix source.

## Test Plan

`packages/agent-tool-mcp/src/__tests__/third-party-schema-enforcement.test.ts` — every enforcement
case runs against BOTH classes, because this is one defect implemented twice. **12 of 43 package
tests red** against the unfixed code:

```
× MCPTool / RelayMcpTool: rejects a required key present with the wrong type
× MCPTool / RelayMcpTool: rejects a value outside the declared enum
× MCPTool / RelayMcpTool: rejects a value outside the declared bounds
× MCPTool / RelayMcpTool: rejects a violation NESTED below the top level
× MCPTool / RelayMcpTool: still enforces the nodes it CAN express
× warns once per tool, not once per call
Tests  12 failed | 31 passed (43)
```

The inexpressible-schema cases pin all three halves of the decision: the expressible nodes are still
enforced, the inexpressible one does not refuse the payload, and the key is still required to be
present. `warns once per tool, not once per call` exists because a per-call warning on a hot path is
how a correct report becomes noise someone silences.

`packages/agent-tool-mcp/src/__tests__/relay-mcp-tool.test.ts` pinned the hand-rolled message
(`Missing required parameter: text`) and is updated to the walk's (`.text: required property
missing`) — a deliberate contract change, not a rewritten expectation.

`agent-tool-mcp` 43 tests pass; `pnpm harness:scan` 122 passed.

## User Execution Test Scenarios

**Applies.** `agent-tool-mcp` has no in-repo product wiring — it is a published SDK package, so a
consumer of the package IS the product surface here (`backlog-execution.md`: "public SDK/example
usage for SDK-only features"). `agent-executable` and provider-free: the tool's executor is a local
stub that records whether it was ever reached, so no API key and no network.

### Scenario — a wrongly-typed argument is rejected, naming the parameter

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-040.ts`

**Evidence:** EXIT:0

```
a tool declaring types, enums, bounds and a nested object:
  limit: "ten" (declared integer): REJECTED -> .limit: expected number, got string
  limit: 500 (declared max 50): REJECTED -> .limit: value 500 is above maximum 50
  filters.since: 20260101 (declared string): REJECTED -> .filters.since: expected string, got number
  query omitted entirely: REJECTED -> .query: required property missing
  a conforming payload: ACCEPTED
a third-party schema the subset cannot fully model:
  known: "nope" (declared enum a|b): REJECTED -> .known: value "nope" is not one of the allowed enum values
  exotic: 12345 (declared oneOf — cannot be checked): ACCEPTED
  exotic omitted entirely: REJECTED -> .exotic: required property missing
  reported unenforceable: [["exotic-server-tool",[".exotic"]]]
PASS a declared type is enforced, not just advertised
PASS declared bounds are enforced
PASS a violation NESTED below the top level is caught — the old check never looked
PASS a missing required key is still reported
PASS a conforming payload is still accepted
PASS a schema the subset CANNOT model still has its expressible parts enforced
PASS and its inexpressible part does not refuse the payload — the tool keeps working
PASS while the key is still REQUIRED to be present
PASS the gap is reported once, naming the tool and the path — not passed over in silence
PASS no wrongly-typed payload ever reached a tool handler
CORE-040 SCENARIO PASS
```

**Red-proof.** Re-run with the two classes' edits stashed — 5 of 10 fail, and every wrongly-typed
payload is ACCEPTED:

```
  limit: "ten" (declared integer): ACCEPTED
  limit: 500 (declared max 50): ACCEPTED
  filters.since: 20260101 (declared string): ACCEPTED
  known: "nope" (declared enum a|b): ACCEPTED
  reported unenforceable: []
CORE-040 SCENARIO FAIL (5)
```

The five that PASS pre-fix are the ones the old check already covered (top-level presence) plus the
two that describe the narrowing outcome — which a check enforcing nothing also satisfies, for the
wrong reason. That is why they are not the load-bearing assertions.
