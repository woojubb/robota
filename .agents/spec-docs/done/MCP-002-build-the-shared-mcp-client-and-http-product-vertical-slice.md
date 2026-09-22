---
status: done
type: API
lane: L2
issue: 2521
tags: [mcp, typescript]
---

# MCP-002: build the shared MCP client and HTTP product vertical slice

## Problem

**Symptom.** No configured MCP server's capabilities are reachable. MCP-001 shipped the typed
definition control plane, which performs no I/O by design — `definition-no-side-effects.test.ts`
asserts that parse/resolve/list/get/status open no socket and spawn no process. So a user can
configure a server, see it listed, approve its activation, and still call nothing.

**Reproduction.** Configure any MCP server and attempt to use one of its tools. There is no code
path from a resolved definition to a tool invocation.

**Two client stacks, neither authoritative.** The source issue's constraint — "two independent MCP
client stacks cannot remain authoritative" — is the current state, measured:

| stack                                                              | size      | what it does                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-mcp/src/{mcp-protocol,mcp-tool,relay-mcp-tool}.ts` | 762 lines | hand-written JSON-RPC over HTTP; performs `initialize` + `notifications/initialized`; calls a **predeclared** tool. **No discovery at all** — no `tools/list`, `prompts/list` or `resources/list`                                                                            |
| `packages/dag-nodes/mcp-tool/src/index.ts`                         | 277 lines | official SDK client inside a workflow node the command-form DAG never loads. **Out of this unit's scope** since the owner's decision of 2026-09-22: it is removed with the other DAG↔MCP surfaces by issue #2817, so its stack disappears with it rather than being migrated |

`packages/agent-transport-mcp` also depends on the SDK but contains **no client reference in its shipped source** (its tests import `Client`) — it
is the server side (`mcp-server.ts`, `mcp-session.ts`) and is not a competing client stack.

The hand-written path cannot be extended to satisfy this item's acceptance criteria without being
rewritten: paginated discovery, capability negotiation and a canonical catalog are exactly what it
does not have.

## Prior Art Research

### References consulted

| #   | Source                                                                                                                                       | Revision     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| R1  | [MCP — Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)                                                | 2025-06-18   |
| R2  | [MCP — Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)                                                  | 2025-06-18   |
| R3  | [MCP — Pagination](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/pagination)                                     | 2025-06-18   |
| R5  | [MCP — Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)                                                         | 2025-11-25   |
| R6  | [MCP — Security Best Practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)                      | 2025-11-25   |
| R7  | [MCP — Key Changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog)                                                      | 2026-07-28   |
| R9  | [MCP — Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)                              | 2026-07-28   |
| S2  | [TypeScript SDK v1.x client guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/client.md)                          | SDK v1       |
| S3  | [`StreamableHTTPClientTransport` API](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/client/client/streamableHttp.html) | SDK v2 ref   |
| H1  | [Claude Code — MCP](https://code.claude.com/docs/en/mcp)                                                                                     | product docs |
| H2  | [Gemini CLI — MCP servers](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)                                            | product docs |
| H3  | [OpenAI Agents SDK — MCP](https://openai.github.io/openai-agents-python/mcp/)                                                                | product docs |

### Observed common behaviour

**Transport baseline converges completely.** Every spec revision from 2025-06-18 to 2026-07-28
defines exactly two standard transports, stdio and Streamable HTTP, and says clients **SHOULD**
support stdio whenever possible (R1). HTTP+SSE has been deprecated since `2025-03-26` and was
formally reclassified Deprecated-with-a-removal-window in 2026-07-28 (R7). All four surveyed hosts
match, and where SSE appears it is labelled legacy — the OpenAI SDK marks `MCPServerSse`
"deprecated" (H3), and the TypeScript SDK documents SSE fallback as an application-level 4xx
pattern you write yourself, not an SDK feature (S2). **No comparable reference found** for a
WebSocket MCP transport in any surveyed host.

**Capability absence is a hard gate, not a soft one.** R2: both parties **MUST** "only use
capabilities that were successfully negotiated." There is no documented probe-anyway fallback, so an
absent `prompts` key is categorically different from a declared-but-empty list.

**Pagination is the caller's loop.** R3 defines opaque cursors that clients **MUST NOT** parse,
modify or persist across sessions, with a missing `nextCursor` meaning end-of-results and an invalid
cursor returning `-32602`. Neither SDK generation documents an auto-paginating iterator (S2) — the
cursor loop is code the caller writes.

**Cross-server name uniqueness is not a protocol guarantee.** R5 requires uniqueness only _within_ a
server, so collision handling is definitionally the host's job. Claude Code prefixes
unconditionally — `mcp__<server>__<tool>`, non-`[A-Za-z0-9_-]` replaced with `_` (H1). Gemini CLI
gives the first registrant the unprefixed name and prefixes only later ones (H2). OpenAI makes it
opt-in (H3). They converge on the `__` separator, ASCII sanitization and a length budget; they
diverge on _when_ to prefix.

**Reconnection is owned by the transport.** S3 documents `StreamableHTTPReconnectionOptions` with
defaults (1 s initial, 30 s max, 1.5 growth, 2 retries) plus session termination, stream resumption
and 401 refresh-and-retry.

**SSRF guidance is addressed to clients.** R6 has a dedicated section naming internal IP access,
cloud metadata (`169.254.169.254`), localhost services, DNS rebinding and redirect chains, with the
explicit instruction: "Avoid implementing IP validation manually. Attackers exploit encoding tricks
(octal, hex, IPv4-mapped IPv6) that custom parsers often miss."

### Constraints that apply to Robota

**The SSRF policy the acceptance criteria say to reuse exists.**
`packages/agent-core/src/utils/egress-policy.ts` with `packages/agent-core/src/utils/ip-address.ts`
already carries `IEgressPolicy`, `TEgressLookup`, `BLOCKED_HOSTNAMES` and typed rejection reasons,
and already reasons about redirects and DNS (redirects across 15 lines, DNS across 6; figures re-measured after a review found my first count wrong). This spec reuses it
rather than writing a second admission path — R6's own instruction not to hand-roll IP validation
points the same way.

**The era split is the one thing that must be written down now.** Revision 2026-07-28 removes
`initialize`/`notifications/initialized`, removes `Mcp-Session-Id`, moves protocol version into
per-request `_meta`, and adds a mandatory `server/discover` (R7). R9 names the two worlds legacy and
modern and states plainly that **legacy client + modern server fails, with no fall-forward.** This
repository pins `@modelcontextprotocol/sdk@^1.29.0`, which is legacy-era. That is shippable and
internally consistent with the acceptance criteria, which are themselves written in legacy
vocabulary — but it is the older of two live eras, and the follow-up is a known item rather than a
future surprise.

**Provider name limits bind tighter than MCP's.** R5 allows 128 characters; provider function-name
limits are commonly 64. A prefix scheme must budget for the tighter ceiling.

### Recommendation

Implement **Streamable HTTP here and stdio in MCP-2522**, and nothing else; reject deprecated SSE and custom WebSocket
with recorded reasons rather than deferring them ambiguously. Prefix tool names **unconditionally**
(Claude Code's scheme, H1) rather than first-come-wins (H2), because the acceptance criteria demand
_stable_ naming and first-come-wins makes a tool's exposed name depend on registration order and on
which unrelated servers happen to be configured. Model capability state in three values, not two.
Write the cursor loop; do not re-implement reconnection. Reuse `egress-policy` for URL admission.
Keep transport construction and the discovery driver behind a narrow seam so the modern era is an
adapter swap rather than a rewrite — but do not attempt dual-era support here.

## Architecture Review

### Affected Scope

- `packages/agent-mcp/package.json` — gains `@modelcontextprotocol/sdk`
- `packages/agent-mcp/src/client/` — new: transport construction, session, discovery driver
- `packages/agent-mcp/src/catalog/` — new: canonical tools/prompts/resources catalogs, naming, provenance
- `packages/agent-mcp/src/supervisor/` — new (absorbs MCP-003): connection and catalog lifecycle. Files are named for their concern, not their directory, matching `definition/{decode,registry,precedence}.ts`
- `packages/agent-mcp/src/mcp-activation.ts` — `requiresTrustedWorkspace` inverted to deny-by-default
  ONLY. The union `TMCPActivationSource` is deliberately NOT widened; it is aliased as
  `TMCPDefinitionSource` (`definition/types.ts:20`) and keys the trust predicate, the
  workspace-binding branch and the definition-precedence table
- `packages/agent-mcp/src/third-party-schema.ts` — retained: `catalog/` calls
  `narrowToUniversalSubset` at registration, so the CORE-040 boundary keeps a caller when
  `mcp-tool.ts` and `relay-mcp-tool.ts` (its only two today) are deleted
- `.agents/project-structure.md` + `ARCHITECTURE.md` — `agent-mcp`'s one-line classification changes:
  it loses "tools" (`MCPTool` / `RelayMcpTool` are deleted) and gains client, catalog and
  connection supervision
- `packages/agent-mcp/src/{mcp-protocol,mcp-tool,relay-mcp-tool}.ts` — the 762-line hand-written path, **removed** (§ Decision settles this; folding is not available for the connection-state type)
- `packages/agent-core/src/utils/egress-policy.ts` — reused, not modified
- `packages/agent-cli` — composes the manager; owns no protocol, catalog, retry or policy logic
- `.agents/publish-registry.md` + `packages/agent-mcp/package.json` — `agent-mcp` moves from the
  Private table to Published

**Sibling scan.** `packages/dag-nodes/mcp-tool` is the other official-SDK client in the repository and
is **out of this unit's scope**: the command-form DAG (`agent-cli` `/workflows` via
`agent-command-workflows`) never loads it, and on the owner's decision of 2026-09-22 it is removed with
`dag-mcp-server` and `dag-cli/src/mcp` by issue #2817 rather than migrated. ADR-005 is amended
accordingly; the target graph is `agent-mcp → agent-core`, `agent-cli → agent-mcp`, and the edge
`dag-node-mcp-tool → agent-mcp` is withdrawn with the node. `packages/agent-transport-mcp` is
server-side and out of scope.

### Alternatives Considered

1. **Adopt the official SDK as the canonical client owner inside `agent-mcp`; fold the hand-written
   path behind it.**
   - Pro: the SDK already owns the protocol mechanics this item needs and that the hand-written path
     lacks entirely — paginated discovery, capability negotiation, reconnection with documented
     backoff (S3), session termination. `dag-nodes/mcp-tool` already proves the SDK works in this
     repository. One authoritative stack, which is the source issue's explicit constraint.
   - Con: a new dependency edge for `agent-mcp`, and the SDK's legacy-era generation pins the
     package to the older of two live protocol eras (R7, R9).

2. **Extend the hand-written 762-line path to add discovery and catalogs.**
   - Pro: no new dependency; full control of the wire format.
   - Con: it is a rewrite wearing an extension's clothes — the path has no discovery, no
     pagination, no capability negotiation and no reconnection, so nearly all of it would be new
     code. It also re-implements what R6 warns against hand-rolling and what S3 shows the transport
     already owns, and it leaves two SDK-based clients in the repository judging it by a third
     standard.

3. **Make `dag-nodes/mcp-tool` the canonical owner and have `agent-mcp` consume it.**
   - Pro: reuses working SDK code immediately.
   - Con: inverts the dependency direction ADR-005 fixes — it would make the agent product depend on a
     DAG node. Moot since 2026-09-22: the node is out of scope and slated for removal (issue #2817), so
     there is nothing to consume. The target graph is `agent-mcp → agent-core`, `agent-cli → agent-mcp`.

4. **Defer the transport entirely and ship only catalogs against a fake server.**
   - Pro: smallest diff; no network surface.
   - Con: does not deliver the acceptance criterion that a configured Streamable HTTP server
     completes initialization and paginated discovery. Configuration that still calls nothing is the
     problem this item exists to end.

### Decision

**Alternative 1.**

The deciding fact is measured, not assumed: the hand-written path performs `initialize` and calls a
**predeclared** tool, and contains no `tools/list`, `prompts/list` or `resources/list` at all. Every
capability this item must deliver is absent from it, so "extend" and "rewrite" are the same amount of
work — and alternative 2 pays that cost while also re-implementing reconnection and IP admission that
the SDK and `egress-policy` already own, against explicit guidance not to (R6, S3).

**ADR-005's MCP-002 obligations, as amended on 2026-09-22.** An independent `proposal-reviewer` pass
found an earlier draft had dropped three things [ADR-005](../../../.design/decisions/ADR-005-shared-mcp-owner-and-migration-boundary.md)
assigned to MCP-002 by name: publication of `agent-mcp`, migration of the DAG node onto the shared seam,
and a typed refusal for DAG stdio. The owner first chose to carry all three (`이 유닛에 다 넣기`). Later
the same day, after stating that the DAG is delivered in **command form** (`agent-cli` `/workflows`) and
not MCP form, the owner decided (verbatim) **`MCP-002에서 분리, 별도 제거 유닛`**. Measured on that date:
the command-form DAG has zero references to `dag-node-mcp-tool`, the node is absent from the product's
default catalog, no user documentation names it, and its only construction outside its own factory and
tests is `dag-cli`'s local runner — a private shell with no consumer. So:

- **Publication of `agent-mcp`** stays, on ADR-005 alone. The owner approved the transition on
  2026-09-22. This unit moves the registry row and clears `private`; the npm release runs later through
  `version-management`. A second ground this document asserted for three revisions — that the
  `agent-cli → agent-mcp` edge would trip `scan-publish-registry` rule 4 — was **false**: `agent-cli`
  publishes as a self-contained bundle under INFRA-028 (0 runtime `@robota-sdk` deps, 26 dev) and rule 4
  excludes `devDependencies`. The edge kind is therefore `devDependencies` (TC-21).
- **DAG node migration and DAG stdio refusal are withdrawn.** ADR-005 is amended in this branch; the
  node, `dag-mcp-server` and `dag-cli/src/mcp` are removed by `MCP-2817` (issue #2817); `MCP-2816`
  (issue #2816) is superseded. This unit neither migrates nor deletes the node. Its target graph is
  `agent-mcp → agent-core`, `agent-cli → agent-mcp`.

**The hand-written connection-state model is REMOVED, not folded.** `mcp-protocol.ts:73` exports
`TMCPConnectionStatus`, consumed at `mcp-tool.ts:58` and re-exposed by `getConnectionStatus()`. With
the supervisor owning connection state, "fold" is the option that breaks this spec's own SSOT claim —
it would leave `agent-mcp` shipping two exported connection-state unions. The invariant is stated at
**package scope**: `packages/agent-mcp/src/**` declares exactly one connection-state union, and it is
the supervisor's. "Fold" remains available only for mechanics genuinely absorbed, never for a type.

**Connection-state ownership is allocated before implementation.** `client/session.ts` owns one
protocol session's negotiated facts — `protocolVersion`, `serverInfo`, `instructions`, capabilities,
`Mcp-Session-Id` — and is **stateless about liveness**.
`supervisor/connection-supervisor.ts` owns open, reuse and close, all retry state, and the single
connection-state union. Stated here because the package-scope one-union invariant is otherwise
preserved on paper by whichever file gets written first putting a liveness boolean pair on the
session, and TC-24 reads exported unions rather than that pair.

**The transport seam is admit-then-construct, not construct-only.** Each transport contributes a
typed admission step whose result feeds the constructor, so the two transports occupy the same slot
with different policies: HTTP admits a URL through `egress-policy`; stdio admits an executable, an
environment allowlist and a cwd authority, which is what ADR-005 requires to happen "before
environment access, transport construction, network action, or process spawn". Shaping it this way
now is what keeps MCP-2522 a second adapter rather than a reshaping of the seam — the failure mode a
one-implementation seam is normally accused of. The seam sits BENEATH the existing
`IMCPActivationAdmission` port and mirrors its fail-closed idiom.

**Why `requiresTrustedWorkspace` is inverted in this unit, although no new host reaches the gate.** While
the DAG node was in scope, the placement review considered minting a sixth `TMCPActivationSource` member
for host-declared servers and found the hole it would open: `requiresTrustedWorkspace`
(`mcp-activation.ts:137-139`) is an allowlist of the sources that REQUIRE trust, so a new member is
`false` by omission; `:145-148` then matches such a source only when `record.repositoryKey === undefined
&& record.workspaceGeneration === undefined`, and `:316-322` attaches those fields only when trust is
required — an approval recorded **unbound to any repository or trust generation**. The union is also
aliased as `TMCPDefinitionSource` (`definition/types.ts:20`), so widening it silently reaches the
definition-precedence table. The host-declared case left with the DAG node; the predicate's fail-open
shape did not, and it is one type edit from the next reader. That is why the inversion stays (TC-29).

**The predicate is inverted to deny-by-default in this unit.** `requiresTrustedWorkspace` becomes an
explicit allowlist of the sources that do NOT require trust (`managed`, `user`), so the answer for every
other value — including any member a later unit adds — is "trust required". Behaviour for all five
current members is identical; what changes is which way the next addition fails. This is in scope
because the near-miss above is the evidence for it: the hole was reachable in one type edit, and fixing
only the instance leaves the next one exactly as reachable.

**Independent architecture-placement validation — `proposal-reviewer`, 2026-09-22: ENDORSE.** Required
before approval for a change of this blast radius (spec-workflow.md, "Validated Recommendation Before
Approval"); this document reached GATE-APPROVAL once without it, which the gate recorded as
NON-COMPLIANCE rather than FAIL. Three rounds, terminal verdict ENDORSE, with the verdict naming what
it endorses: `agent-mcp` as client/catalog/supervision owner; the three intra-package surfaces
including the supervisor; the `@modelcontextprotocol/sdk` edge, singular on the client side once the
DAG node consumes the seam; the single-connection-state instrument as a package-local compiler-API
test rather than a repository scan; Streamable HTTP alone behind the SDK's own two-implementation
`Transport` contract, shaped admit-then-construct; and `dag-node-mcp-tool → agent-mcp` mirroring the existing `dag-node-tool → agent-tools` — the last of these, with TC-25/26/28, was withdrawn later that day when the owner took the DAG node out of scope (issue #2817); the rest stands.

The three rounds each closed a defect the criteria could not see, and each is recorded where it was
fixed rather than only here: TC-21 and TC-12 were mutually unsatisfiable until TC-27 existed; TC-25 and
TC-26 were jointly satisfied by a migrated node that refused every call, until TC-28 existed; and the
rejected sixth-source member would have recorded approvals unbound to `repositoryKey` and
`workspaceGeneration`, until the `project` mapping and TC-29 existed. The reviewer's earlier ENDORSE on
ARCH-1985 (2026-09-21) settled package-level ownership only and does not discharge this one.

**Delivery mode:** `single`

**Scope absorbed from the regrouping.** This unit delivers two Task records, on the owner's
decision to regroup the remaining MCP graph into five units rather than twelve:

- `MCP-002` — the shared client and the Streamable HTTP vertical (this spec's paired Task)
- `MCP-003` — the connection and capability-catalog supervisor

They are combined because they share one seam: MCP-003 supervises the very catalog MCP-002 builds, so
splitting them means building a catalog and immediately reworking its lifecycle. The checkpoint
contract pairs one spec with one Task, so MCP-002 is the paired record and MCP-003 is closed against
this delivery. Its nine acceptance conditions are carried as TC-13 through TC-17, TC-10, TC-22, TC-23 and TC-24 below, not assumed.

**`MCP-2522` was in the first draft of this grouping and is removed from it.** GATE-WRITE refused
that draft, and the ground holds: [issue #2522](https://github.com/woojubb/robota/issues/2522) states
in its own priority line that the stdio transport "requir[es] **independent subprocess-security
acceptance**", and its eight acceptance conditions are a security boundary — fail-closed executable
policy, allowlisted environment with no secret echo, cwd authority against traversal and symlink
confusion, spawn-only-after-activation-trust — not a second transport adapter. Carrying them on this
spec's criteria would have shipped a claim that they were verified when only initialization and
discovery were. `MCP-2520`, its dependency, is `done`, so it is unblocked and ships as its own unit.

The general lesson, recorded because it governs the rest of the regrouping: combining units reduces
the fixed cost per unit — one gate pipeline, one pull request, one review loop — and does **not**
reduce the acceptance surface. A combined spec must carry every absorbed record's conditions.

**Transport set: Streamable HTTP here; stdio in MCP-2522.** The spec's transport seam is built to
take both — R1 makes stdio the transport clients SHOULD support whenever possible — but the stdio
adapter ships with its subprocess-security acceptance rather than ahead of it.

- **Deprecated HTTP+SSE — rejected**, not deferred. Deprecated since `2025-03-26`, formally
  Deprecated-with-removal-window since 2026-07-28 (R7), and offered by neither SDK generation as a
  built-in fallback (S2). The cost is a second transport lifecycle and a probe path for servers the
  spec is actively removing. Revisitable only on evidence of a specific required SSE-only server.
- **Custom WebSocket — rejected.** MCP defines no WebSocket binding, and no surveyed host documents
  one. It would be an interop dead end with zero documented peers.

Both rejections are surfaced in the catalog's `rejected` bucket with a reason rather than being
silent, which is what every host that documents collisions does.

**Naming: unconditional prefix.** `<server-id>__<tool-name>`, sanitized to `[A-Za-z0-9_-]` with `_`
substitution, deterministically middle-truncated to a 64-character budget. Claude Code's scheme (H1)
over Gemini CLI's first-come-wins (H2), because the acceptance criteria demand _stable_
collision-safe naming and first-come-wins makes an exposed name a function of registration order and
of which other servers are configured — the same server yields different names in different
sessions. Residual collisions after sanitization or truncation resolve deterministically and the
loser is recorded as `rejected` with its reason.

**Capability state is three-valued**, because R2 makes absence a hard gate: `unsupported` (key absent
— never called), `supported/empty` (declared, zero items), `supported/N`. A two-valued model would
make a server that does not offer prompts indistinguishable from one that offers none, and would
invite a call that violates "only use capabilities that were successfully negotiated."

**URL admission reuses `packages/agent-core/src/utils/egress-policy.ts`.** No second admission path
is written. R6's instruction against hand-rolled IP validation and the acceptance criterion pointing
at an existing policy agree.

**The era split is recorded, not handled.** This unit ships legacy-era against the pinned
`@modelcontextprotocol/sdk@^1.29.0`. R9 documents that a legacy client against a modern server fails
with no fall-forward. Transport construction and the discovery driver sit behind a narrow internal
seam so the modern adapter is a swap rather than a rewrite, and the follow-up is filed rather than
discovered later.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `agent-mcp` (owner), `agent-core` (reused unchanged), `agent-cli` (composes), `.agents/publish-registry.md` (`agent-mcp` Private → Published); `dag-nodes/mcp-tool` is out of scope (issue #2817)
- [x] Sibling scan 완료 — `dag-nodes/mcp-tool` is a sibling consumer, `agent-transport-mcp` is server-side and out of scope; both inspected
- [x] 대안 최소 2개 검토 완료 — four alternatives (1–4)
- [x] 결정 근거 문서화 완료 — alternative 1, decided on the measured absence of discovery in the hand-written path

## Fallback & Degradation Declaration

None.

Two DAG degradations were declared here while the DAG node was in scope (HTTP DAG execution moving
behind the trust gate; DAG stdio fail-closed pending MCP-2522). Both left with the node on 2026-09-22
(issue #2817); this unit ships no DAG behaviour and introduces no fallback.

The rejected transports are refusals, not fallbacks: an SSE-only or WebSocket server is reported as
`rejected` with a reason, never silently retried down a second path. Capability absence likewise
refuses rather than probing.

## Solution

1. Add `@modelcontextprotocol/sdk` to `agent-mcp` and construct `Client` with
   `StreamableHTTPClientTransport` behind an internal **admit-then-construct** transport seam: a
   per-transport admission step returns a typed admission result that feeds the constructor, so
   MCP-2522's stdio adapter fills the same slot with executable/env/cwd authority rather than
   reshaping the seam.
2. Admit an HTTP server URL through `egress-policy` in that admission slot, before any connection
   attempt.
3. Complete `initialize`, store `protocolVersion`, `serverInfo`, `instructions` and the negotiated
   capabilities on the catalog entry.
4. Drive paginated discovery for tools, prompts and resources with a caller-owned cursor loop, a
   bounded page count, and per-request timeouts.
5. Build canonical catalogs with server provenance, unconditional prefixed naming, and explicit
   adopted / adapted / rejected buckets carrying reasons.
6. Register discovered tools through the existing generic dynamic-tool contract; add no MCP-only
   runtime path.
7. Supervise connection and catalog lifecycle (absorbed MCP-003): classify transient / auth /
   config / not-found failures distinctly, retry only the transient class under bounded exponential
   backoff with observable pending / failed / manual-retry states, refresh on `listChanged` without
   reconnecting, preserve the last-known-good catalog with stale/error metadata when a refresh fails,
   and keep startup / per-call / global-default / idle timeouts distinct and typed.
8. Remove the hand-written 762-line path, including its exported `TMCPConnectionStatus`, so
   `packages/agent-mcp/src/**` declares exactly one connection-state union and exactly one client
   stack is authoritative.
9. Expose the `agent-cli` composition and the deployable manifest dependency edge that
   [issue #2521](https://github.com/woojubb/robota/issues/2521) requires, so the vertical is reachable
   from a product rather than only from tests.
10. Publish `agent-mcp`: clear `private` in its manifest and move its row from the Private table to
    Published in `.agents/publish-registry.md`, so the `agent-cli → agent-mcp` edge does not create a
    published-depends-on-private violation (ADR-005; owner-approved 2026-09-22).

## Affected Files

- `packages/agent-mcp/package.json`
- `packages/agent-mcp/src/client/transport.ts`, `session.ts`, `discovery.ts`
- `packages/agent-mcp/src/catalog/types.ts`, `naming.ts`, `build.ts`
- `packages/agent-mcp/src/supervisor/connection.ts`
- `packages/agent-mcp/src/{mcp-protocol,mcp-tool,relay-mcp-tool}.ts`
- `packages/agent-mcp/src/index.ts`
- `packages/agent-mcp/docs/SPEC.md`
- `packages/agent-mcp/src/__tests__/` — new suites, and three existing ones that do not survive the
  deletions, enumerated rather than discovered mid-implementation:
  - `mcp-protocol.test.ts`, `mcp-tool.test.ts`, `relay-mcp-tool.test.ts` — their subjects are deleted,
    so these go with them
  - `third-party-schema-enforcement.test.ts` — **re-pointed, not deleted.** It imports `MCPTool` and
    `RelayMcpTool` (`:24-25`) as the vehicles it enforces CORE-040 through, so the deletions take the
    boundary's production callers AND its enforcement coverage in the same stroke. It is re-pointed at
    the `catalog/` registration path; TC-30 is what makes that non-optional
  - `mock-mcp-server.ts` — **extended and kept.** It already speaks `initialize`,
    `notifications/initialized` and `Mcp-Session-Id` over HTTP, and is a test helper rather than part
    of the deleted path. It answers zero discovery methods today (measured: no `tools/list`,
    `prompts/list`, `resources/list` or `nextCursor`), so TC-01/02/04/07/19 extend it with paginated
    discovery, an invalid cursor, declared-vs-absent capabilities and an unbounded cursor chain
- `packages/agent-mcp/examples/` — the scripted end-to-end product path
- `packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts` — new, the instrument
  TC-24 names: a package-local TypeScript-compiler-API assertion over `packages/agent-mcp/src/**`
- `.agents/publish-registry.md` — `@robota-sdk/agent-mcp` row moves Private → Published
- `packages/agent-cli/package.json` — gains the `@robota-sdk/agent-mcp` dependency edge
- `packages/agent-mcp/src/mcp-activation.ts` — deny-by-default trust predicate
- `packages/agent-mcp/src/third-party-schema.ts` — re-attached to the `catalog/` registration path
- `packages/agent-mcp/tsconfig.json` / `package.json` — `@modelcontextprotocol/sdk` in
  `dependencies` (a runtime value import of a now-published package, `^1.29.0` to match the four
  existing declarations), and `@types/node` declared rather than resolved by workspace hoisting
- `.agents/project-structure.md`, `ARCHITECTURE.md` — `agent-mcp` reclassified
- `packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts` — new, TC-29

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-initialize.test.ts` → exits 0 — a Streamable HTTP server completes `initialize`, the negotiated `protocolVersion`, `serverInfo` and capabilities are stored, and a server answering with an unsupported version is disconnected rather than used
- [x] TC-02: `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-pagination.test.ts` → exits 0 — a three-page `tools/list` is fully drained by following `nextCursor` until absent, a missing `nextCursor` ends the loop, and an invalid cursor surfaces `-32602` as a named domain failure rather than a partial catalog reported as complete
- [x] TC-03: `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-naming.test.ts` → exits 0 — two servers exposing the same tool name both resolve to distinct `<server>__<tool>` names, characters outside `[A-Za-z0-9_-]` become `_`, a name over the 64-character budget is middle-truncated deterministically, and a residual collision records the loser as `rejected` with a reason
- [x] TC-04: `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-capability.test.ts` → exits 0 — a server declaring no `prompts` capability yields `unsupported` and is never called, a server declaring `prompts` with zero items yields `supported/empty`, and the two are distinguishable in the catalog
- [x] TC-05: `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-url-admission.test.ts` → exits 0 — an `http://` non-loopback URL, a private-range host, and `169.254.169.254` are each refused through `egress-policy` BEFORE any connection attempt, and the refusal names the policy's reason
- [x] TC-06: `grep -rn 'StreamableHTTPClientTransport' packages/agent-mcp/src` returns hits, and `grep -rnE 'StdioClientTransport|SSEClientTransport|WebSocket' packages/agent-mcp/src --exclude-dir=__tests__` returns none — this unit's transport set is exactly Streamable HTTP. Two things the command must do, both verified by running it against a file that ships all three: `-E`, because without it `grep` reads `|` as a literal and the absence half can never fail; and `--exclude-dir=__tests__`, because TC-07's own fixture must name SSE and WebSocket to record them as rejected. The stdio adapter is absent ON PURPOSE — it ships with MCP-2522, which carries the subprocess-security conditions this unit does not
- [x] TC-07: `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts` → exits 0 — an SSE-only and a WebSocket server each appear in the `rejected` bucket with a reason, not silently absent
- [x] TC-08: `pnpm exec vitest run packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts` → exits 0 — a discovered tool registers through the existing generic dynamic-tool contract — and `git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src` is EMPTY, proving no MCP-specific runtime branch was added. A diff against the base, not a bare grep: `grep -rn 'mcp' packages/agent-framework/src` already returns 93 hits today, so it reports the same thing before and after and decides nothing. Red the moment this unit edits that package at all
- [x] TC-09: `pnpm exec vitest run packages/agent-mcp/src/__tests__/connection-supervisor.test.ts` → exits 0 — the supervisor opens, reuses and closes a connection, and a `listChanged` notification marks the affected catalog domain stale (absorbed MCP-003)
- [x] TC-11: `grep -rnE 'sendMCPRequest|initializeMCPSession|TMCPConnectionStatus' packages/agent-mcp/src packages/agent-cli/src` returns NO hit, and `pnpm --filter @robota-sdk/agent-mcp build` exits 0 — the hand-written stack and its connection-state type are removed, not folded, so exactly one client stack is authoritative. An earlier draft counted files instead, because § Affected Scope then permitted folding; § Decision now decides removal, so the plain absence check is the correct instrument and the weaker count is gone. `-E` for the reason TC-06 records. Red today: `mcp-protocol.ts:73`, `mcp-tool.ts:58` and the two entry points all match
- [x] TC-12: `pnpm --filter @robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-mcp build` → exits 0, and `node scripts/harness/run-all-scans.mjs --affected --context pr` reports no NEW failure relative to the base
- [x] TC-10: `pnpm exec vitest run packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts` → exits 0 — the RUNTIME half: a failed connection exposes one failed value carrying its classification, and the same classification is readable from it rather than re-derived by the caller (MCP-003 condition 8)
- [x] TC-23: `pnpm --filter @robota-sdk/agent-mcp typecheck` → exits 0, and deleting the failed member from the supervisor's exported connection-state union makes it exit non-zero — the TYPE half, asserted by `tsgo --noEmit` rather than by `vitest run`. The runner matters: vitest erases type assertions unless `--typecheck` is set, and `expect-type` binds every matcher to a function returning `true`, so a false type assertion under `vitest run` throws nothing. This package's `tsconfig.json` includes `src/**/*`, so a `__tests__` type assertion is enforced by the typecheck script
- [x] TC-24: `pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts` → exits 0, and adding a second exported union modelling connection state ANYWHERE under `packages/agent-mcp/src/**` makes it exit non-zero — the "no second status model" half of MCP-003 condition 8. Three properties, each bought by a specific earlier defect: it **parses with the TypeScript compiler API** rather than asserting a type, because the claim is a negative existential over every type the package declares and TypeScript can only speak about types an assertion names; it is **invoked directly**, because the first draft asked that `run-all-scans --affected` report no new finding, which a non-existent instrument satisfies by never reporting one; and it is scoped to **`src/**`, not `src/supervisor`**, because § Decision permits mechanics to be folded and a subdirectory-scoped check reports green on exactly the outcome that breaks the invariant — `mcp-protocol.ts:73`'s surviving `TMCPConnectionStatus`. It is a package-local test rather than a repository scan because the invariant is one package's internal type, backs no repository-wide rule, and a path-literal scan in `scripts/harness/` is the shape `scan-harness-scope-literal` exists to discourage. Red today
- [x] TC-22: `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts` → exits 0 — a retained last-known-good catalog carries an explicit identity (server id plus negotiated `protocolVersion` plus `serverInfo.version`), a reconnect whose identity differs invalidates it rather than reusing it, and nothing is inferred from a stale session id (MCP-003 condition 9)
- [x] TC-13: `pnpm exec vitest run packages/agent-mcp/src/__tests__/failure-classification.test.ts` → exits 0 — a transient, an authentication, a configuration and a not-found failure each classify distinctly, and only the transient class is retried; the other three are refused on first response rather than retried blindly (MCP-003)
- [x] TC-14: `pnpm exec vitest run packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts` → exits 0 under a fake clock — reconnect uses bounded exponential backoff, the observable state moves pending → failed → manual-retry, the retry bound is reached rather than looping, and every timer is deterministic with no foreground polling (MCP-003)
- [x] TC-15: `pnpm exec vitest run packages/agent-mcp/src/__tests__/last-known-good.test.ts` → exits 0 — a `listChanged` notification refreshes the affected catalog domain WITHOUT reconnecting, and a refresh that fails preserves the prior catalog and exposes `stale` plus the error rather than emptying it (MCP-003)
- [x] TC-16: `pnpm exec vitest run packages/agent-mcp/src/__tests__/timeout-semantics.test.ts` → exits 0 — startup, per-call, global-default and idle timeouts are four distinct typed settings, each independently configurable, and a value set for one does not change another (MCP-003)
- [x] TC-17: `pnpm exec vitest run packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts` → exits 0 — after cancellation and after session shutdown the transport's own close is asserted called and no reconnect timer remains armed under the fake clock (MCP-003)
- [x] TC-18: `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-provenance.test.ts` → exits 0 — every catalog entry carries its originating server id, the negotiated `protocolVersion` and `serverInfo.version`, and the `adopted` and `adapted` buckets are populated with reasons, not only `rejected`
- [x] TC-19: `pnpm exec vitest run packages/agent-mcp/src/__tests__/discovery-bounds.test.ts` → exits 0 — a server returning an unbounded cursor chain stops at the declared page bound with a named refusal rather than looping, and a per-request timeout fires as its own classified failure
- [x] TC-20: `pnpm scenario:verify:mcp-client` from `packages/agent-mcp` → exits 0 and prints one line `result=transport=streamable-http; discoveredTools=<n>; invoked=<tool>; catalogSource=<server-id>` with `discoveredTools` greater than zero. A NEW script name, and field values only the HTTP vertical can produce. The first draft named the existing `pnpm scenario:verify`, which already exits 0 today and prints three `result=` lines from MCP-001's scenarios — it was satisfied by work this unit has not done. Red today because the script does not exist
- [x] TC-30: `grep -rn 'narrowToUniversalSubset\|ThirdPartySchemaValidator' packages/agent-mcp/src --include='*.ts' --exclude-dir=__tests__` returns a hit OUTSIDE `third-party-schema.ts` and `index.ts`, and `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts` exits 0 — a discovered tool whose `inputSchema` carries a construct the runtime cannot enforce is narrowed and the unenforceable construct is reported. The CORE-040 third-party trust boundary has exactly two call sites today (`mcp-tool.ts:18,206`, `relay-mcp-tool.ts:3,128`) and this unit DELETES both files, so without a named successor an enforcement step that runs on every MCP tool invocation today disappears with its callers while `docs/SPEC.md:198` still documents it. The grep excludes the definition and the barrel because an exported-but-uncalled validator is exactly the state being prevented. Red today — the only non-test callers are the two files being deleted
- [x] TC-29: `pnpm exec vitest run packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts` → exits 0 — a `project`-sourced MCP server in an UNTRUSTED workspace is refused, and an approval granted under one `workspaceGeneration` does NOT admit after the generation changes. Plus the deny-by-default half: a source value absent from `requiresTrustedWorkspace`'s not-required allowlist requires trust rather than skipping it. This criterion exists because no other criterion exercises the trust predicate's DEFAULT: every other test either supplies an explicit admission or never reaches the gate, so a permissive default — the fail-open hole a new source member would have opened — is invisible to the rest of the set. Red today: the file does not exist, and `mcp-activation.ts:137-139` is still the require-list form, so the deny-by-default half fails on the current tree
- [x] TC-27: `node -e` over `packages/agent-mcp/package.json` shows no `private` field, `grep -n '@robota-sdk/agent-mcp' .agents/publish-registry.md` shows its row in the Published table and not the Private table, and `node scripts/harness/scan-publish-registry.mjs` exits 0 — `agent-mcp` is published, as ADR-005 assigns to this unit by name and the owner approved on 2026-09-22. The scan half is an ordinary regression check, NOT the resolution of a criteria conflict: an earlier draft of this criterion claimed it was the check TC-21 would otherwise turn red, which the structure-channel audit falsified and § Decision now records as struck. The published dependency closure is what the scan actually protects here — `agent-mcp`'s only workspace edge is a `peerDependency` on `agent-core`, which is itself Published. Red today — `packages/agent-mcp/package.json:59` is `"private": true`
- [x] TC-21: `node -e` over `packages/agent-cli/package.json` shows `@robota-sdk/agent-mcp` in **`devDependencies`** and NOT in `dependencies`, `node scripts/harness/check-publish-safety.mjs` exits 0, and `grep -rnE 'StreamableHTTPClientTransport|tools/list|prompts/list|resources/list' packages/agent-cli/src --exclude-dir=__tests__` returns none — the product composes the manager without owning protocol logic. The edge KIND is asserted, not just its presence: `agent-cli` publishes as a self-contained bundle under INFRA-028 (measured: 0 runtime `@robota-sdk` deps, 26 dev), and `check-publish-safety.mjs:139-149` errors on any `@robota-sdk/*` in its runtime `dependencies` — so the naive form of this edge is a NEW failure TC-12 forbids. An earlier draft asserted only that an edge existed, on a rationale § Decision now records as false. `-E` for the reason TC-06 records. The term `catalog` is deliberately NOT banned: composing and rendering a catalog is exactly what the CLI is supposed to do, so banning it would fail on correct code

## Test Plan

Strategy derived from `type: API` + `tags: [mcp, typescript]` → MCP protocol integration tests
against an in-process mock server, plus type-level assertions on the catalog contracts.

**Every criterion below names the condition that turns it red, and that requirement is written here because six GATE-WRITE rounds were spent on its absence.** The failures were not six mistakes but one, in four tool families: a `grep` whose `|` was literal without `-E` and passed against a file shipping everything it forbade; a type assertion under `vitest run`, which erases them because `expect-type` binds every matcher to a function returning `true`; a scan satisfied by its own absence; and a scenario command that already exited 0 on a previous unit's work. An instrument that cannot fail is not a weaker check than one that can — it is the absence of a check wearing one's clothes.

| TC-ID | Test Type            | Tool / Approach                                                                          | Notes                                                                                                                                                                                                                                                                                                          |
| ----- | -------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | protocol integration | vitest + in-process mock MCP server over the SDK transport                               | Test: `packages/agent-mcp/src/__tests__/client-initialize.test.ts` > openMcpSession — initialize (TC-01) — Version-mismatch disconnect is the negative half                                                                                                                                                    |
| TC-02 | protocol integration | mock server returning three cursor pages, then an invalid cursor                         | Test: `packages/agent-mcp/src/__tests__/client-pagination.test.ts` > MCP discovery pagination (TC-02) — The invalid-cursor case is what stops a partial catalog reading as complete                                                                                                                            |
| TC-03 | unit                 | vitest over the naming function                                                          | Test: `packages/agent-mcp/src/__tests__/catalog-naming.test.ts` > canonicalName — Two servers, one shared tool name — the collision case the protocol does not prevent                                                                                                                                         |
| TC-04 | protocol integration | mock servers with capability absent vs declared-empty                                    | Test: `packages/agent-mcp/src/__tests__/catalog-capability.test.ts` > capability state is three-valued and distinguishable — Two-valued models cannot express this; the test is what keeps the third state honest                                                                                              |
| TC-05 | unit                 | vitest with a stubbed `TEgressLookup`                                                    | Test: `packages/agent-mcp/src/__tests__/client-url-admission.test.ts` > admitHttpEndpoint — URL admission (TC-05) — Asserts refusal happens before connection, not after                                                                                                                                       |
| TC-06 | config assertion     | `grep` over `packages/agent-mcp/src`                                                     | Skipped: command-form criterion (grep/manifest/scan); the exact command and its output are the [GATE-COMPLETE] evidence entry — Absence half is the load-bearing one: no SSE, no WebSocket                                                                                                                     |
| TC-07 | unit                 | vitest over the disposition buckets                                                      | Test: `packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts` > deprecated and unsupported transports are rejected, not silently absent — Rejected-with-reason rather than silently absent                                                                                                             |
| TC-08 | integration          | vitest registering a discovered tool through the generic contract                        | Test: `packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts` > a discovered MCP tool satisfies the runtime tool slot — Plus an absence grep proving no MCP-only branch was added to `agent-framework`                                                                                            |
| TC-09 | integration          | vitest over the supervisor lifecycle                                                     | Test: `packages/agent-mcp/src/__tests__/connection-supervisor.test.ts` > MCPConnectionSupervisor — open / reuse / close / listChanged (TC-09) — Absorbed MCP-003                                                                                                                                               |
| TC-11 | migration assertion  | absence `grep -E` for the entry points and the old type + package build                  | Skipped: command-form criterion (grep/manifest/scan); the exact command and its output are the [GATE-COMPLETE] evidence entry — Removal, not folding: § Decision settled it, so the weaker per-file count is gone                                                                                              |
| TC-12 | build / scan         | package test + build + affected scans                                                    | Skipped: package test+build+affected scans; recorded as the [GATE-COMPLETE] evidence entry — Base-state advisories are tolerated; the criterion is no NEW failure                                                                                                                                              |
| TC-10 | unit                 | vitest over the exposed failed value                                                     | Test: `packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts` > MCPConnectionSupervisor — canonical failed state (TC-10) — Runtime half only — the type half is TC-23, because vitest erases type assertions                                                                                         |
| TC-23 | type-level           | `tsgo --noEmit` via the package typecheck script                                         | Skipped: type-level criterion asserted by the package typecheck script, not a vitest file — Red-proof is deleting the failed member; `vitest run` would report nothing                                                                                                                                         |
| TC-24 | unit (compiler API)  | vitest parsing `packages/agent-mcp/src/**` with the TypeScript compiler API              | Test: `packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts` > package-scope invariant — exactly one connection-state union (TC-24) — Red-proof is adding a second union anywhere in the package; package scope, not `src/supervisor`                                                        |
| TC-22 | unit                 | vitest reconnecting with a changed server identity                                       | Test: `packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts` > MCPConnectionSupervisor — last-known-good catalog identity (TC-22) — Invalidation is the half that silently serves a stale catalog if untested                                                                                       |
| TC-13 | unit                 | vitest over the classifier with four induced failure shapes                              | Test: `packages/agent-mcp/src/__tests__/failure-classification.test.ts` > classifyMcpFailure — pure classification (TC-13) — The negative half is what stops an auth failure being retried as if transient                                                                                                     |
| TC-14 | unit (fake clock)    | vitest with `vi.useFakeTimers`                                                           | Test: `packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts` > MCPConnectionSupervisor — reconnect backoff (TC-14) — Fake clock is the requirement, not a convenience: real timers make the bound untestable                                                                                             |
| TC-15 | integration          | mock server emitting `listChanged`, then failing the refresh                             | Test: `packages/agent-mcp/src/__tests__/last-known-good.test.ts` > MCPConnectionSupervisor — last-known-good on listChanged (TC-15) — Preserving last-known-good is the half that fails silently if untested                                                                                                   |
| TC-16 | unit                 | vitest over the typed settings surface                                                   | Test: `packages/agent-mcp/src/__tests__/timeout-semantics.test.ts` > MCPConnectionSupervisor — four distinct timeouts (TC-16) — Four distinct timeouts; asserts independence, not just presence                                                                                                                |
| TC-17 | unit (fake clock)    | vitest asserting transport close and no armed timer                                      | Test: `packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts` > MCPConnectionSupervisor — shutdown leaves no live request (TC-17) — Deliberately NOT `getActiveResourcesInfo` — MCP-001 recorded why that measurement is invalid                                                                  |
| TC-18 | unit                 | vitest over catalog entries                                                              | Test: `packages/agent-mcp/src/__tests__/catalog-provenance.test.ts` > catalog provenance — `adopted`/`adapted` were asserted nowhere in the first draft                                                                                                                                                        |
| TC-19 | protocol integration | mock server returning an endless cursor chain                                            | Test: `packages/agent-mcp/src/__tests__/discovery-bounds.test.ts` > MCP discovery bounds (TC-19) — A bound with no test is a bound nobody knows the value of                                                                                                                                                   |
| TC-20 | scenario             | `pnpm scenario:verify` from the package                                                  | Skipped: scenario criterion, not a vitest file — verified by running `pnpm scenario:verify:mcp-client` (`examples/verify-mcp-client.ts`); the command and its exact `result=` line are the `[GATE-COMPLETE: TC-20]` evidence entry — The end-to-end product path issue #2521 requires; a user-runnable surface |
| TC-21 | config + grep        | manifest read plus an absence grep over `agent-cli`                                      | Skipped: command-form criterion (grep/manifest/scan); the exact command and its output are the [GATE-COMPLETE] evidence entry — Both halves: the edge exists AND the CLI owns no protocol logic                                                                                                                |
| TC-29 | unit (security)      | vitest over admission with an untrusted workspace and a rotated generation               | Test: `packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts` > MCP activation host admission trust binding — Only this criterion exercises the trust predicate's default, so only it can see a fail-open hole                                                                                 |
| TC-30 | unit                 | vitest over catalog registration + a caller grep excluding the definition and the barrel | Test: `packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts` > CORE-040 narrowing at catalog registration — The CORE-040 boundary loses both call sites to this unit's deletions; an exported-but-uncalled validator is the state prevented                                                       |
| TC-27 | config + scan        | manifest read, registry row grep, `scan-publish-registry.mjs`                            | Skipped: command-form criterion (grep/manifest/scan); the exact command and its output are the [GATE-COMPLETE] evidence entry — An ordinary regression check on the published closure; an earlier row claimed it resolved a criteria conflict that never existed                                               |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

**Why this surface:** the product composition this unit adds (`agent-cli → agent-mcp`, TC-21) wires
the manager without a rendering command of its own — `/mcp` gains a supplier but no new user-visible
verb in this unit — so the surface a person can execute to observe the delivered behaviour is the
package's `examples/` runner, the same `public-sdk-example` surface MCP-001 and MCP-2520 ship in this
package. The paired Task's `## User Execution Test Scenarios` carries the same scenario with its
`DONE-GATE-STAGE-1` PASS and the bound `doneGateStageOne` record; this section mirrors it.

### Scenario 1: discover and invoke a tool over Streamable HTTP through the shared client

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-mcp` are built; run from `packages/agent-mcp`; the example starts the repository's in-process mock MCP server on loopback (`127.0.0.1`, an ephemeral port) exposing three tools and admits it through an injected loopback-allowing `TEgressLookup`; it points `HOME` at a fresh temporary directory before anything reads settings; no network beyond loopback, no MCP server other than the mock, no provider credential and no external service is required. The runner `examples/verify-mcp-client.ts` is built by this unit (TC-20).
- Command: `pnpm exec tsx examples/verify-mcp-client.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp
- Cleanup: the example closes the mock server and the MCP session and removes its temporary `HOME` before exiting; it leaves no files, processes or connections
- Evidence: pending implementation — recorded at DONE-GATE-STAGE-2 with the command, its exit code and the single printed `result=` line

## Tasks

- [x] `.agents/tasks/completed/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` — done

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › At least 1 criterion per distinct feature or sub-item (`semantic`): the spec
  declares three Task records as one delivery unit, but carries one criterion each for two of them and
  no criterion for several named sub-items. Found: MCP-2522 (stdio) is covered by TC-10 alone, which
  asserts initialization and discovery and explicitly excludes admission ("no URL admission applied");
  MCP-003 is covered by TC-09 alone, which asserts open/reuse/close plus a `listChanged` staleness mark.
  Required by the absorbed records: issue #2522 lists eight acceptance criteria — fail-closed executable
  policy, allowlisted environment inheritance with no secret echo, cwd/project-root authority proof
  against traversal and symlink confusion, spawn-after-activation-trust, bounded deterministic spawn /
  stderr / exit / cancellation / timeout / shutdown, denied-command and untrusted-source tests, and a
  no-agent-to-DAG-dependency check — none of which appear in this spec's Problem, Solution, Affected
  Files, Completion Criteria or Test Plan; `.agents/tasks/MCP-2522-*.md` additionally names a
  `scenario:verify:stdio-transport` public scenario with two drafted user-execution scenarios that no
  TC references. Issue #2523 lists nine acceptance criteria — transient/auth/config/not-found failure
  classification, bounded retry that does not blindly retry auth/config/not-found, backoff with
  observable pending/failed/manual-retry states, last-known-good catalog preservation with stale/error
  metadata on a failed refresh, four distinct configurable timeout semantics, cancellation/shutdown
  leaving no hidden live requests or reconnect loops, fake-clock determinism, the canonical failed state
  for issue #1990, and cache identity/invalidation — of which only `listChanged` staleness is asserted.
  The Decision's "do not re-implement reconnection" (S3) is left unreconciled with issue #2523's demand for
  observable retry states under a fake clock. Sub-items of MCP-002 itself that carry no TC: catalog
  server provenance and the `adopted` / `adapted` buckets (TC-07 asserts only `rejected`); the bounded
  page count and per-request timeouts of Solution step 4; the scripted end-to-end product path named in
  Affected Files (`packages/agent-mcp/examples/`), which issue #2521 requires to have tests; `agent-cli`
  composition, named in Affected Scope but absent from Affected Files and from every TC; and the
  issue #2521 criterion "a deployable product/workspace manifest gains an intentional dependency edge to the
  shared MCP client owner" — verified unsatisfied today (`@robota-sdk/agent-mcp` is `private: true` and
  no `agent-cli` or app manifest references it) and asserted by no TC.
  **Required action:** either add completion criteria covering the absorbed records' acceptance
  conditions and the uncovered MCP-002 sub-items, or narrow the declared scope to what the twelve
  criteria actually verify and re-file the remainder; then re-run GATE-WRITE.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. Names a specific wrong behaviour ("configure a server, see it
  listed, approve its activation, and still call nothing") and grounds it in verified measurements:
  `wc -l` over `packages/agent-mcp/src/{mcp-protocol,mcp-tool,relay-mcp-tool}.ts` is exactly 762; a grep
  for `tools/list|prompts/list|resources/list|listTools|listPrompts|listResources` over those three
  files returns zero hits, confirming "no discovery at all"; `mcp-protocol.ts:221-241` confirms
  `initialize` + `notifications/initialized` and `:90` confirms a `tools/call` on a predeclared tool;
  the cited `packages/agent-mcp/src/__tests__/definition-no-side-effects.test.ts` exists.
- Problem › reproduction condition — PASS. "Configure any MCP server and attempt to use one of its
  tools. There is no code path from a resolved definition to a tool invocation." States when and where,
  and is corroborated by the discovery grep above.
- Prior Art › research feeds Alternatives/Decision — PASS, derived rather than decorated. Each decision
  traces to a cited finding and is refutable by it: the transport set to R1/R7 (stdio + Streamable HTTP
  only; SSE deprecated-with-removal-window) plus S2 (no built-in SDK fallback); the WebSocket rejection
  to the survey's own "no comparable reference found"; the caller-owned cursor loop to R3 plus S2's
  absence of an auto-paginating iterator; the three-valued capability model to R2's "only use
  capabilities that were successfully negotiated"; "do not re-implement reconnection" to S3's documented
  `StreamableHTTPReconnectionOptions` defaults. The naming choice is the clearest case of derivation:
  the research records that the hosts converge on `__`, ASCII sanitization and a length budget but
  diverge on WHEN to prefix (H1 unconditional, H2 first-come-wins, H3 opt-in), and the Decision resolves
  the divergence against an external criterion — issue #2521's demand for STABLE collision-safe naming, which
  first-come-wins violates by making an exposed name a function of registration order — rather than by
  copying the most prominent host. The 64-character budget likewise follows the recorded finding that
  provider function-name limits bind tighter than R5's 128.
- Architecture Review › Decision references the trade-off — PASS. Alternative 1's Con names both costs
  (a new dependency edge for `agent-mcp`; the SDK's legacy-era generation pinning the package to the
  older of two live eras), and the Decision states the trade that settled it — with no discovery in the
  hand-written path, "extend" and "rewrite" cost the same, so alternative 2 pays a rewrite AND
  re-implements reconnection and IP admission against explicit guidance (R6, S3). The era cost is
  carried forward under "The era split is recorded, not handled" rather than dropped.
- Architecture Review › new-surface placement — PASS (applies; not N/A). The condition fires: the spec
  adds new interface surfaces (`src/client/`, `src/catalog/`, `src/supervisor/` exported through
  `src/index.ts`) whose ownership could plausibly sit elsewhere, as Alternative 3 itself demonstrates.
  (a) The Sibling scan names the analogous existing layer — `packages/dag-nodes/mcp-tool`, the other
  official-SDK client — and classifies it as a sibling consumer with DAG and agent products as separate
  families; Alternative 3 states the direction being preserved (`agent-mcp → agent-core`) and rejects
  inverting it. (b) Reuse is at the shared core, not on a sibling product: `egress-policy` is consumed
  from `agent-core` and a DAG-node dependency is explicitly rejected. Verified independently that
  `packages/agent-transport-mcp` is not a third client stack — its shipped source imports only
  `@modelcontextprotocol/sdk/server/index.js` and contains no case-insensitive match for "client"
  outside `__tests__/`.
- Completion Criteria › Command form or Observable behavior form — PASS. All twelve are command-first
  with a named observable: TC-01…TC-05 and TC-07…TC-10 are `pnpm exec vitest run <path>` → exits 0 with
  the asserted behaviour spelled out including its negative half; TC-06 and TC-11 are greps with stated
  hit / no-hit expectations; TC-12 names package test, build and `run-all-scans.mjs --affected` with
  "no NEW failure relative to the base" as the observable. No vague form.

**Verified claims carrying imprecise figures (not gate-failing, correct before the next gate reads them):**

- `packages/agent-core/src/utils/egress-policy.ts` exists and exports `IEgressPolicy`,
  `TEgressLookup`, `BLOCKED_HOSTNAMES`, `TEgressRejectionReason`, `rejectDestination` and
  `fetchWithEgressPolicy`, and `ip-address.ts:41` blocks link-local "incl. 169.254.169.254" — so
  issue #2521's "HTTP URL admission reuses a safe network-boundary/SSRF policy" is satisfiable by reuse, as
  claimed. But the stated reference counts do not reproduce: redirects are 15 lines / 18 occurrences
  (the 15 checks out), while DNS is 6 lines / 7 occurrences in that file and 9 across both files, not 16.
- "`packages/agent-transport-mcp` … contains zero client references" is true of shipped source and
  false if tests are counted: `__tests__/remote-command-admission.test.ts:15` and
  `__tests__/turn-correlation.test.ts:15` import `Client` from the SDK to drive the server in-memory.
  The conclusion — not a competing client stack — stands.
- "`MCP-2520`, which MCP-2522 depends on, is `done`" — verified:
  `.agents/tasks/completed/MCP-2520-require-trust-approval-before-project-or-plugin-mcp-activation.md`
  carries `status: done`, `completed: 2026-09-09`. The dependency is clear, but the spec consumes
  MCP-2520 only as dependency clearance; its activation-trust admission contract is never wired into a
  spawn path, which is part of the coverage failure above.
- "This repository pins `@modelcontextprotocol/sdk@^1.29.0`" — verified in `agent-transport-mcp`,
  `dag-cli` and `dag-mcp-server`; `packages/agent-mcp/package.json` does not yet declare it, consistent
  with "gains".

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `7a172bd3e9b707e7afb380599b1eb49c1704d58d` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › At least 1 criterion per distinct feature or sub-item (`semantic`): the
  re-scope removed stdio from this unit's § Decision but not from its criteria, so the in-scope
  transport feature has no correct criterion and an out-of-scope one has a binding criterion. Found:
  § Decision line 205 states "**Transport set: Streamable HTTP here; stdio in MCP-2522**", while
  TC-06 requires `grep -rn "StreamableHTTPClientTransport\|StdioClientTransport" packages/agent-mcp/src`
  to return **hits** and states the observable as "the transport set is exactly stdio plus Streamable
  HTTP". The two cannot both hold. As written TC-06 is satisfiable only by constructing
  `StdioClientTransport` inside `packages/agent-mcp/src` — which this unit now carries **zero**
  subprocess-security criteria for, MCP-2522's eight conditions having been deliberately removed. That
  reinstates precisely the hazard the narrowing was performed to eliminate, through the one artifact
  that binds at verification time. Two further statements still instruct stdio delivery: § Prior Art ›
  Recommendation line 114 ("Implement **stdio + Streamable HTTP and nothing else**") and Solution step 1
  line 260 ("construct `Client` with `StreamableHTTPClientTransport` or `StdioClientTransport`"). What
  was required instead: a criterion asserting THIS unit's transport set — Streamable HTTP present,
  `StdioClientTransport` provably ABSENT pending MCP-2522, alongside the existing SSE/WebSocket absence
  grep — so that the seam "built to take both" is distinguished from the adapter that ships later.
  Secondary, same criterion: § Decision line 190 claims MCP-003's "nine acceptance conditions are
  carried as TC-13 through TC-18", but two of the nine are neither carried nor declared N/A —
  issue #2523's "issue #1990 consumes the canonical failed state rather than deriving a second status model"
  (no TC, and issue #1990 is named nowhere in the document) and "cache/persistence, if adopted, has explicit
  identity/invalidation and is not inferred from stale session data" (not obviously N/A, since TC-15
  adopts a retained last-known-good catalog and asserts its `stale` metadata but not its identity or
  invalidation).
  **Required action:** correct TC-06 (and Recommendation line 114, Solution step 1) to this unit's
  actual transport set, and either add criteria for issue #2523 conditions 8 and 9 or record them as N/A
  with a reason; then re-run GATE-WRITE.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. Section unchanged from the prior run and re-verified: 762 lines
  exact across the three files; zero hits for
  `tools/list|prompts/list|resources/list|listTools|listPrompts|listResources`; `mcp-protocol.ts:221-241`
  and `:90` confirm `initialize` + `notifications/initialized` + a predeclared `tools/call`.
- Problem › reproduction condition — PASS. Unchanged and still corroborated by the discovery grep.
- Prior Art › research feeds Alternatives/Decision — PASS. The derivations verified in the prior run
  stand. The Decision now diverges from § Recommendation on stdio, and does so legitimately: the ground
  is issue #2522's own priority line requiring "independent subprocess-security acceptance", which is a
  stronger and differently-sourced reason than the R1 transport survey that produced the Recommendation.
  A Decision overriding its own research recommendation on a stated, stronger ground is sound. The
  Recommendation's stale "and nothing else" wording is folded into the failed criterion above.
- Architecture Review › Decision references the trade-off — PASS, and strengthened. The narrowing names
  what it costs (stdio ships later, the transport set is smaller than R1's baseline) against what it
  buys (the eight subprocess-security conditions get verified rather than claimed), and records the
  governing generalisation — combining units reduces fixed cost per unit, not acceptance surface.
- Architecture Review › new-surface placement — PASS, and strengthened. (a) and (b) as verified in the
  prior run, plus TC-21 now makes (b) checkable rather than asserted: it requires the `agent-cli`
  manifest to carry the edge to `@robota-sdk/agent-mcp` AND
  `grep -rn "StreamableHTTPClientTransport|tools/list|catalog" packages/agent-cli/src` to return no
  hit — the product composes the shared owner without absorbing its protocol or catalog logic.
- Completion Criteria › Command form or Observable behavior form — PASS on form for all 20. Each is
  command-first with a named observable; TC-06's form is valid and its CONTENT is what fails above.
  The MCP-003 set is not happy-path, which was the specific risk raised: TC-13 asserts the negative
  half (auth/config/not-found "refused on first response rather than retried blindly"), TC-14 asserts
  the bound "is reached rather than looping" under a fake clock with all three observable states named,
  TC-15 asserts the failing refresh "preserves the prior catalog and exposes `stale` plus the error
  rather than emptying it", TC-16 asserts independence ("a value set for one does not change another")
  rather than mere presence, TC-19 asserts an unbounded cursor chain "stops at the declared page bound
  with a named refusal". TC-17's Test Plan note was checked, not taken: MCP-001's done spec records at
  line 280 that the `process.getActiveResourcesInfo()` counters were dropped in review because they
  "would have printed 0 over a run that did all three, and the receipt certified a property it could
  not observe" — so choosing transport-close plus no-armed-timer over that measurement is a real
  repository lesson applied, not a preference.

**MCP-003 coverage, condition by condition (issue #2523's nine):** (1) classification of transient / auth /
config / not-found — TC-13 ✓; (2) bounded retry, other classes not blindly retried — TC-13 + TC-14 ✓;
(3) bounded exponential backoff with pending/failed/manual-retry — TC-14 ✓, all three states named;
(4) `listChanged` refresh without reconnect, failed refresh preserves last-known-good with stale/error
metadata — TC-15 ✓ (TC-15 says "the affected catalog domain"; issue #2523 says tool, prompt AND resource —
mechanism covered, the three domains not enumerated); (5) four distinct typed timeouts — TC-16 ✓
(issue #2523 says "per-server/per-call"; TC-16 says "per-call", dropping per-server); (6) no hidden live
requests or reconnect loops after cancellation/shutdown — TC-17 ✓ for reconnect timers and transport
close, in-flight requests not directly asserted; (7) fake-clock determinism, no foreground polling —
TC-14 ✓; (8) issue #1990 consumes the canonical failed state — ✗ not carried, not declared N/A;
(9) cache/persistence identity and invalidation — ✗ not carried, not declared N/A. Seven of nine are
genuinely covered with their negative halves; two are not, against an explicit claim that all nine are.

**Accuracy defects that mislead a later reader about what shipped (recorded, not the decider):**

- § Decision line 181 still reads "This unit delivers **three** Task records" and is followed by **two**
  bullets, then contradicted six lines later by the paragraph removing MCP-2522.
- § Decision line 190 says MCP-003's conditions are "TC-13 through **TC-18**"; TC-18 is catalog
  provenance, an MCP-002 gap. The MCP-003 range is TC-13 through TC-17, as each of those five is tagged.
- Completion Criteria skip **TC-10**: the list runs TC-01…TC-09, TC-11…TC-21 (20 items, confirmed by
  `gate.mjs`). TC-10 was the removed stdio criterion. The hole is legitimate in origin but reads as a
  silently dropped criterion.
- The prior run's imprecisions are uncorrected and were raised by the coordinator. On the two questions
  asked: the claim "redirects and DNS are already reasoned about" **stands independently of the figure**
  — `egress-policy.ts` exports `TEgressLookup` and resolves hostnames before admission, and
  `ip-address.ts:41` blocks link-local "incl. 169.254.169.254" — so only the parenthetical "(15 and 16
  references respectively)" is wrong (measured: redirects 15 lines / 18 occurrences; DNS 6 lines / 7
  occurrences, 9 across both files). "Zero client references" in `agent-transport-mcp` is true of
  shipped source and false if `__tests__/` is counted, and its conclusion stands. Both are citation
  defects rather than claim defects; whether they are corrected now is the orchestrator's call, not
  this gate's — but a figure known to be wrong and left in place is read differently by the next gate
  than one not yet noticed.

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `1387784d25cf69ae26eb863f4804860bbf79393f` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › Each criterion uses Command form or Observable behavior form (`semantic`):
  three criteria state an absence observable that their command cannot establish, because the pattern
  uses unescaped `|` in a basic-regex `grep`. `|` is a literal character to `grep` without `-E`, so
  each searches for one literal string containing pipes, which matches nothing — the absence assertion
  passes unconditionally and its failure is invisible, since "returns NONE" is also what success looks
  like. Demonstrated, not inferred: a file containing
  `import { StdioClientTransport } …`, `import { SSEClientTransport } …`,
  `new WebSocket(…)` and `return new StdioClientTransport({ command: 'x' })` was written to a
  scratch tree and searched with TC-06's command exactly as the criterion writes it —
  `grep -rn "StdioClientTransport|SSEClientTransport|WebSocket" <dir>` → no output, exit 1, i.e.
  **criterion satisfied by a file that blatantly ships all three**. The same pattern with `\|` or
  with `-E` returns all four lines, exit 0.
  - **TC-06** — `grep -rn "StdioClientTransport|SSEClientTransport|WebSocket" packages/agent-mcp/src`
    returns NONE. This is the criterion carrying the entire subprocess-security argument for removing
    MCP-2522, and it is inert. Its presence half (`StreamableHTTPClientTransport`, a single term with
    no alternation) works, so the criterion will look like it is doing something while the half that
    matters never fires. Note the prior draft's pattern was `"SSEClientTransport\|WebSocket"` — correct
    BRE alternation; the rewrite dropped the backslashes.
  - **TC-10** — `grep -rn "status|state" packages/agent-mcp/src/supervisor` shows no second status
    enum. Vacuous as written, and not a discriminator if repaired: `status` and `state` match
    near-everything in a connection supervisor, so the fixed form is a false-failure generator rather
    than a test for "a second status model derived from the canonical value".
  - **TC-21** — `grep -rn "StreamableHTTPClientTransport|tools/list|catalog" packages/agent-cli/src`
    returns no hit. Vacuous as written; if repaired, `catalog` would also match legitimate composition
    and rendering in `agent-cli`, which the criterion explicitly permits.
  - TC-11's `"sendMCPRequest\|initializeMCPSession"` is escaped and does work, which is what makes the
    other three a slip rather than a convention.
    **Coverage consequence (recorded here rather than failed twice):** because these three commands
    cannot fail, this unit's transport set is effectively unasserted and MCP-003 condition 8 is carried
    in appearance only — which is the specific question asked of TC-10. Condition 8's split is honest in
    its REASONING: issue #2523's parent-checklist line does scope model projection to issue #1990, so "supplies the
    failed state, does not own its consumption" is a correct reading, and asserting one canonical value
    with no second enum derived from it is the right residue for this unit. It is the instrument, not
    the split, that fails.
    **Repairing TC-06 needs more than backslashes — it collides with TC-07.** With working alternation,
    `WebSocket` must be absent from `packages/agent-mcp/src`, but TC-07 requires
    `packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts` to show "an SSE-only and a WebSocket
    server each appear in the `rejected` bucket with a reason" — a fixture and a reason string that must
    name the transport, inside TC-06's own search path. Verified the tree is clean today
    (`grep -rn "StdioClientTransport\|SSEClientTransport\|WebSocket" packages/agent-mcp/src` → exit 1,
    no output; `WebSocket` appears nowhere under `packages/agent-mcp/`), so the collision is created by
    TC-07's deliverable, not pre-existing.
    **Required action:** give each of TC-06, TC-10 and TC-21 a command that can fail — `-E`, or `\|`, or
    separate single-term greps — and scope TC-06 so that TC-07's test fixture does not trip it (exclude
    `__tests__/`, or assert absence over non-test source), then re-run GATE-WRITE. On the question asked
    directly: as written, TC-06 is satisfiable not merely by a comment or a type-only import but by a
    complete working stdio implementation. Once the alternation is repaired, `grep` is line-based and
    text-only, so it WOULD match a comment and an `import type` line — for an absence assertion that is
    over-strict (a false failure), never vacuous, which is the safe direction; the cost is precisely the
    TC-07 collision above.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. Re-verified unchanged: 762 lines exact; zero hits for the six
  discovery method names; `mcp-protocol.ts:221-241` and `:90`.
- Problem › reproduction condition — PASS. Unchanged and still corroborated.
- Prior Art › research feeds Alternatives/Decision — PASS. The stale Recommendation is corrected and
  now reads "Streamable HTTP here and stdio in MCP-2522, and nothing else", so § Recommendation and
  § Decision agree while the R1 finding that clients SHOULD support stdio is preserved as the reason
  the seam is shaped for a second adapter. Both citation defects are corrected and both corrections
  verify against my own measurements: "redirects across 15 lines, DNS across 6" matches exactly what I
  measured, and the `agent-transport-mcp` sentence now reads "no client reference in its shipped
  source (its tests import `Client`)", which is the precise state I found.
- Architecture Review › Decision references the trade-off — PASS, unchanged and still sound.
- Architecture Review › new-surface placement — PASS. (a) and (b) as before. TC-21 still expresses (b)
  as a checkable pair — the manifest edge must exist AND `agent-cli` must own no protocol or catalog
  logic — though its absence half is one of the three inert commands above; the placement REASONING is
  unaffected, only its instrument.
- Completion Criteria › At least 1 criterion per distinct feature or sub-item — PASS. The gap that
  failed run 1 and the inversion that failed run 2 are closed. 22 criteria, TC-01…TC-22 with no hole
  (TC-10 and TC-22 are placed after TC-12 rather than in sequence — a readability nit, not a defect).
  MCP-003's nine conditions now map completely: (1)(2) TC-13, (3)(7) TC-14, (4) TC-15, (5) TC-16,
  (6) TC-17, (8) TC-10, (9) TC-22. Solution step 1 no longer instructs stdio construction, and § Decision
  line 181 now reads "two Task records" above two bullets with the range corrected to
  "TC-13 through TC-17, TC-10 and TC-22".

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `8c04e725d45d71797f16df6e69364597904a0f56` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › Each criterion uses Command form or Observable behavior form (`semantic`):
  TC-06 and TC-21 are repaired and verified; **TC-10 is not**. Its property is the right one and is
  assertable in this codebase, but the command it names cannot establish it, and one half of it cannot
  be expressed as a type assertion at all.
  - **Wrong runner.** TC-10 names `pnpm exec vitest run packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts`
    → exits 0 to establish a TYPE property. Vitest evaluates type assertions only under `--typecheck`;
    neither `vitest.config.ts` nor `vitest.shared.ts` enables it, and `agent-mcp`'s `test` script is
    `vitest run --passWithNoTests` with no such flag. At runtime the assertions are inert — verified in
    the installed dependency, not assumed: `node_modules/.pnpm/expect-type@1.3.0/node_modules/expect-type/dist/index.js`
    defines `const fn = () => true;` and binds every matcher to it (`toBeAny: fn`, `toBeString: fn`,
    `toEqualTypeOf`, …), so a FALSE assertion returns `true` and throws nothing. The named command
    therefore exits 0 whether the union has one failed member or five — the same "command that cannot
    fail" defect as the prior run, with a new cause: right property, wrong instrument.
  - **The property IS enforceable here — by a different command.** `packages/agent-mcp/tsconfig.json`
    has `"include": ["src/**/*"]` and excludes only `dist`/`node_modules`, so `src/__tests__/` is
    typechecked by `pnpm --filter @robota-sdk/agent-mcp typecheck` (`tsgo --noEmit`). The repository's
    own precedent states this in terms:
    `packages/agent-interface-execution/src/__tests__/type-ssot-parity.test.ts` documents in its header
    that "This package's tsconfig typechecks `__tests__`, so every assertion below is enforced by
    `pnpm typecheck` — … this file stops compiling." So "exactly one failed member in one exported
    union" is writable and enforceable; it just is not what `vitest run` measures.
  - **"No second union is derived from it" is not expressible as written.** It is a negative
    existential over the module's entire type surface, and TypeScript cannot quantify over "every type
    declared in a module" — an assertion can only speak about types it names. The precedent shows the
    achievable form: name each status-bearing type and assert equality, so a hand re-declaration stops
    compiling — "These assertions are tautologies while the types are defined as `Omit<…>`, and that is
    exactly what makes them worth writing: they fail the moment either type is re-declared by hand."
    That catches drift in NAMED types; it cannot catch a newly added, unnamed second union, which needs
    a scan or lint instrument rather than a type assertion.
    **Required action:** name the command that actually decides the type property —
    `pnpm --filter @robota-sdk/agent-mcp typecheck`, or `vitest run --typecheck` — keeping `vitest run`
    for TC-10's runtime half ("a failed connection exposes ONE canonical failed value carrying its
    classification"); and restate the second half either in the named-equality form the precedent uses or
    as a scan. Then re-run GATE-WRITE.

**TC-06 and TC-21 — verified repaired, in both directions:**

- TC-06's absence half was reproduced hermetically. Against a `src/` containing
  `import { StdioClientTransport }` and `new WebSocket(...)`:
  `grep -rnE 'StdioClientTransport|SSEClientTransport|WebSocket' <src> --exclude-dir=__tests__` →
  both lines reported, **exit 0, correctly caught**. With only a TC-07-style fixture left in
  `__tests__/` naming `SSEClientTransport` and `WebSocket` → **exit 1, correctly clean**. The same
  command WITHOUT `--exclude-dir=__tests__` → exit 0 on that fixture alone, i.e. it would have failed
  on correct code: the exclusion is load-bearing, not decoration. Against the real tree the shipped
  command returns exit 1, so it is not pre-broken.
- TC-21's absence half returns exit 1 against the real `packages/agent-cli/src` today. Dropping
  `catalog` from the banned terms is correct and the criterion says why: composing and rendering a
  catalog is the CLI's job, so banning it would fail on correct code. The remaining terms are protocol
  terms only.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. Re-verified unchanged: 762 lines exact; zero hits for the six
  discovery method names; `mcp-protocol.ts:221-241` and `:90`.
- Problem › reproduction condition — PASS. Unchanged and still corroborated.
- Prior Art › research feeds Alternatives/Decision — PASS. Unchanged from the prior run; Recommendation
  and Decision agree, and both citation corrections match my own measurements.
- Architecture Review › Decision references the trade-off — PASS. Unchanged.
- Architecture Review › new-surface placement — PASS. (a) and (b) unchanged; TC-21's instrument is now
  sound, so requirement (b) is checkable as well as reasoned.
- Completion Criteria › At least 1 criterion per distinct feature or sub-item — PASS. 22 criteria,
  TC-01…TC-22, no hole; MCP-003's nine still map completely (1,2→TC-13; 3,7→TC-14; 4→TC-15; 5→TC-16;
  6→TC-17; 8→TC-10; 9→TC-22). Condition 8's scope split remains honest — issue #2523's parent-checklist line
  scopes model projection to issue #1990 — and TC-10's defect is its instrument, not its coverage.

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `44c1fdb0b334b50d1864e8fd5546d93c7e49ebee` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 22 rows vs 24 TC criteria; no row for TC-23, TC-24
  **Required action:** one row per TC-NN, same ids

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `b00a14f96ef5` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › Each criterion uses Command form or Observable behavior form (`semantic`):
  **TC-23 is sound and was proved so; TC-24 is vacuous.** TC-24's observable is
  `node scripts/harness/run-all-scans.mjs --affected --context pr` reporting "**no new finding** from a
  scan asserting that `packages/agent-mcp/src/supervisor` declares exactly one exported union modelling
  connection state". That scan does not exist — no file under `scripts/harness/` matches
  supervisor / connection-state / status-model / single-union — and it is this unit's own deliverable.
  An absence observable over an instrument that has not been written is satisfied BY the instrument's
  absence: with no scan registered, `run-all-scans` reports no finding from it, and the criterion
  passes. So the answer to the question asked is that naming an unwritten instrument is legitimate,
  but **only when the criterion states what must make it fail**, and TC-24 does not. The contrast is
  inside this same document:
  - TC-01…TC-22 name test files that do not exist yet, and are NOT vacuous: their observable is
    `pnpm exec vitest run <path>` → exits 0, and `vitest run` on a missing path exits non-zero
    ("No test files found") because these invoke `vitest` directly rather than the package's
    `--passWithNoTests` script. Absence makes them red, which is the correct direction.
  - TC-23 names an instrument that does not exist yet and is also NOT vacuous, because it carries a
    red-proof: "deleting the failed member from the supervisor's exported connection-state union makes
    it exit non-zero" cannot hold unless the union and the assertion both exist.
  - TC-24 has neither property. It is the defect caught in the two prior runs, one level further out:
    a command that cannot fail until someone writes the thing that makes it fail.
    **Affected Files does not list the instrument either.** TC-24 requires a new
    `scripts/harness/scan-<name>.mjs` plus its registration in `scripts/harness/run-all-scans.mjs`, and
    § Affected Files lists only `packages/agent-mcp/**`. The deliverable TC-24 depends on is absent from
    the file inventory, so nothing else in the spec forces it to be written either.
    **Required action:** give TC-24 a red-proof naming the condition that must turn it non-zero —
    introducing a second exported connection-state union under `packages/agent-mcp/src/supervisor` — and
    have it invoke the scan directly (`node scripts/harness/scan-<name>.mjs`) in addition to the
    `--affected` run, so the criterion fails when the scan is missing rather than passing because it is.
    Add the scan and its `run-all-scans.mjs` registration to § Affected Files. Then re-run GATE-WRITE.

**TC-23 — red-proof verified achievable, by running it:**

The concern raised was that the assertion might have to be written in a form `tsgo` accepts but does
not enforce. It does not. Using the repository's own `tsgo` (`node_modules/.bin/tsgo`,
`7.0.0-dev.20260707.2`) and its installed `expect-type@1.3.0`, against a union of exactly the shape
TC-23 describes:

- GREEN — union carries `{ kind: 'failed'; classification: … }`, assertion holds → **exit 0**, no output.
- RED — the failed member deleted from the union, which is TC-23's stated red-proof verbatim →
  **exit 1**, one error:
  `error TS2344: Type '{ kind: "failed"; classification: "auth" | "config" | "not-found" | "transient"; }'
does not satisfy the constraint '"Expected: ..., Actual: never"'`.

So `tsgo --noEmit` genuinely enforces `toEqualTypeOf`, the red-proof is achievable as stated, and
TC-23's move of the type half off `vitest run` is correct. One caveat for whoever writes the suite,
not a gate finding: this holds for `toEqualTypeOf` against a named `Extract<…>`; `toMatchTypeOf` is
weaker and an `any` on either side passes vacuously — the red-proof TC-23 states is what pins the
form, which is why stating it was the right thing to do.

**Semantic criteria checked (the other six):**

- Problem › concrete symptom — PASS. Unchanged; re-verified (762 lines; zero discovery hits).
- Problem › reproduction condition — PASS. Unchanged.
- Prior Art › research feeds Alternatives/Decision — PASS. Unchanged.
- Architecture Review › Decision references the trade-off — PASS. Unchanged.
- Architecture Review › new-surface placement — PASS. Unchanged.
- Completion Criteria › At least 1 criterion per distinct feature or sub-item — PASS. 24 criteria,
  TC-01…TC-24, Test Plan rows matching. MCP-003's nine still map completely, condition 8 now across
  TC-10 (runtime), TC-23 (type) and TC-24 (no-second-model). The split across three instruments is the
  right decomposition — each part is now assigned to a tool that can decide it; only TC-24's is stated
  in a form that cannot go red.

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c96668060c8142cf291111b04225af85b5ac7010` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** draft
**Failed criteria:**

- Completion Criteria › Each criterion uses Command form or Observable behavior form (`semantic`):
  the three repaired criteria are sound, but a sweep of the other 21 for the same shape found three
  more instruments that cannot decide their observable. TC-20 is the worst of them: it is not merely
  undecidable, it is **affirmatively green today against the very state it exists to change**.
  - **TC-20 — passes today with zero MCP-002 work.** It names `pnpm scenario:verify` from
    `packages/agent-mcp`, but that script already exists and already runs MCP-001's scenarios:
    `"scenario:verify": "… verify-mcp-activation-admission.ts --status && … --lifecycle && …
verify-mcp-definition-control-plane.ts"`. Run just now from `packages/agent-mcp` under an isolated
    `HOME`: **exit 0**, printing **three** `result=` lines —
    `result=status=untrusted; activationAttempts=0`,
    `result=approved=true; changedDefinitionDenied=true; …`, and
    `result=winner=alpha:managed; …`. Zero of them mention Streamable HTTP, discovery, or a tool
    invocation (`grep -ci "streamable\|tools/list\|discovered"` → 0). So both halves of the criterion's
    command — "exits 0" and "prints one `result=` line" — are satisfied by MCP-001's shipped work.
    The required-vs-found: the criterion must name a NEW scenario script (the convention this repo
    already uses — `.agents/tasks/MCP-2522-*.md` declares `scenario:verify:http-vertical`-style names
    with an `allow-undeclared-script` marker) or assert the specific `result=` field values that only
    the HTTP vertical can produce.
  - **TC-08 — a delta with no baseline.** Its second half is `grep -rn "mcp" packages/agent-framework/src`
    with the observable "shows no MCP-specific runtime branch **added**". "Added" is a comparison, and
    a bare grep makes none. Measured today: **93 hits** already exist in that tree
    (`bundle-plugin-types.ts:15 mcp?: boolean`, `:41 mcpConfig?`, …). The command therefore returns
    hits both before and after the change and can distinguish nothing. Required instead: assert
    against the base (a count or a diff the `--affected` run can carry), or assert the specific
    absence — no MCP-named branch in the dynamic-tool registration path — with a term that is not
    already present 93 times.
  - **TC-11 — the search path contains the thing it is measuring.**
    `grep -rn "sendMCPRequest\|initializeMCPSession" packages/agent-mcp/src apps/*/src` with the
    observable "returns no hit **outside the canonical owner**". The alternation is correctly escaped
    and `apps/*/src` does glob (`apps/action/src`, `apps/agent-app/src`, `apps/agent-server/src`), so
    neither of those is the defect — but `packages/agent-mcp/src` **is where the canonical owner
    lives**, so hits from inside it are indistinguishable from hits outside it by exit code. Measured
    today: 8 hits, all in `mcp-protocol.ts` (4) and `mcp-tool.ts` (4) — exactly the files § Affected
    Scope says are "folded behind the canonical owner **or removed**". If they are folded, the grep
    returns hits and the criterion looks failed; if removed, it returns none. Either way the command
    does not decide the stated observable. Required instead: exclude the canonical owner's path from
    the search, or assert against the specific call sites that must not survive.
    **Required action:** give TC-20 a scenario script that does not exist yet (or pin the `result=`
    field values unique to the HTTP vertical); give TC-08 a baseline comparison or a term not already
    present; scope TC-11's search to exclude the canonical owner. Then re-run GATE-WRITE.

**The three repaired criteria — verified, not accepted:**

- **TC-24** now invokes `node scripts/harness/scan-single-connection-state-union.mjs` directly. Run
  today: **exit 1**, because the scan does not exist. That is the correct direction and the exact
  inversion of the previous form, which passed because the scan was missing. It also now carries a
  red-proof, states why the form changed, and § Affected Files lists both the scan and the
  `run-all-scans.mjs` registration.
- **TC-23** — red-proof proved in the prior run with the repo's own `tsgo`: GREEN exit 0, RED exit 1
  with `TS2344 … does not satisfy the constraint '"Expected: ..., Actual: never"'`.
- **TC-06 / TC-21** — both proved in prior runs in both directions.

**Sweep of the remaining criteria — the assumption underpinning them is now measured, not asserted.**
TC-01–05, 07, 09, 10, 13–19 and 22 all take the form `pnpm exec vitest run <path>` → exits 0. I had
claimed a missing path makes these red; I verified it:
`pnpm exec vitest run packages/agent-mcp/src/__tests__/client-initialize.test.ts` → **exit 1**
("No test files found"). `passWithNoTests` is set only in the package's `test` script, and these
criteria invoke `vitest` directly, so it does not apply. Those 18 are sound. TC-12's scan half
("no NEW failure relative to the base") is a delta, but `run-all-scans --affected --context pr`
implements the base comparison itself, which is what distinguishes it from TC-08's bare grep;
it is also paired with a test-and-build half that can fail. TC-21's `node -e` manifest half goes red
today, since `agent-cli` carries no edge to `@robota-sdk/agent-mcp`.

**Semantic criteria checked (the other six):** Problem › concrete symptom — PASS (unchanged, 762 lines,
zero discovery hits). Problem › reproduction condition — PASS (unchanged). Prior Art › research feeds
Alternatives/Decision — PASS (unchanged). Architecture Review › Decision trade-off — PASS (unchanged).
Architecture Review › new-surface placement — PASS (unchanged). Completion Criteria › at least 1
criterion per distinct feature or sub-item — PASS: 24 criteria, 24 Test Plan rows, MCP-003's nine still
mapped, condition 8 correctly decomposed across TC-10 / TC-23 / TC-24. The coverage is right; three
instruments cannot measure what they cover.

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `7e63858ee9c63d17c6810f4085ead29871acaac7` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

- GATE-WRITE — Problem contains a concrete symptom (`semantic`): names a specific wrong behaviour —
  "configure a server, see it listed, approve its activation, and still call nothing" — grounded in
  measurements re-verified this run. `wc -l` over
  `packages/agent-mcp/src/{mcp-protocol,mcp-tool,relay-mcp-tool}.ts` is exactly **762**; a grep for
  `tools/list|prompts/list|resources/list|listTools|listPrompts|listResources` across those three files
  returns **zero hits**, confirming "no discovery at all"; `mcp-protocol.ts:221-241` confirms
  `initialize` + `notifications/initialized` and `:90` a `tools/call` on a predeclared tool; the cited
  `definition-no-side-effects.test.ts` exists.
- GATE-WRITE — Problem contains a reproduction condition (`semantic`): "Configure any MCP server and
  attempt to use one of its tools. There is no code path from a resolved definition to a tool
  invocation." States when and where, corroborated by the discovery grep above.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (`semantic`): derived, not
  decorated. Each choice traces to a cited finding and is refutable by it — transport set to R1/R7 plus
  S2; the WebSocket rejection to the survey's own "no comparable reference found"; the caller-owned
  cursor loop to R3 plus S2's absence of an auto-paginating iterator; three-valued capability state to
  R2's "only use capabilities that were successfully negotiated"; "do not re-implement reconnection" to
  S3. The naming choice is the clearest case: the research records convergence on `__`, ASCII
  sanitization and a length budget but divergence on WHEN to prefix (H1 unconditional, H2
  first-come-wins, H3 opt-in), and the Decision resolves it against an external criterion — issue #2521's
  demand for STABLE naming, which first-come-wins violates by making an exposed name a function of
  registration order — rather than by copying the most prominent host. Where § Decision diverges from
  § Recommendation (stdio), it does so on a stronger, differently-sourced ground: issue #2522's own
  priority line requiring "independent subprocess-security acceptance". Both earlier citation defects
  are corrected and match my own measurements: "redirects across 15 lines, DNS across 6", and
  "no client reference in its shipped source (its tests import `Client`)".
- GATE-WRITE — Decision references the trade-off that drove the choice (`semantic`): Alternative 1's Con
  names both costs (a new dependency edge for `agent-mcp`; the SDK's legacy-era generation pinning the
  package to the older of two live eras), and the Decision states the trade that settled it — with no
  discovery in the hand-written path, "extend" and "rewrite" cost the same, so alternative 2 pays a
  rewrite AND re-implements reconnection and IP admission against explicit guidance (R6, S3). The era
  cost is carried under "The era split is recorded, not handled" rather than dropped, and the MCP-2522
  narrowing names what it costs (a smaller transport set) against what it buys (eight security
  conditions verified rather than claimed).
- GATE-WRITE — New-surface placement (`semantic`): applies (not N/A) — new interface surfaces
  (`src/client/`, `src/catalog/`, `src/supervisor/` exported via `src/index.ts`) whose ownership could
  plausibly sit elsewhere, as Alternative 3 demonstrates. (a) The Sibling scan names the analogous
  existing layer, `packages/dag-nodes/mcp-tool`, classifies it a sibling consumer with DAG and agent
  products as separate families, and Alternative 3 states the direction preserved (`agent-mcp →
agent-core`). (b) Reuse is at the shared core — `egress-policy` from `agent-core`, verified to export
  `IEgressPolicy`, `TEgressLookup`, `BLOCKED_HOSTNAMES`, `TEgressRejectionReason`, with
  `ip-address.ts:41` blocking link-local "incl. 169.254.169.254" — and a DAG-node dependency is
  explicitly rejected. TC-21 makes (b) checkable rather than asserted. Verified independently that
  `packages/agent-transport-mcp` is not a third client stack: its shipped source imports only
  `@modelcontextprotocol/sdk/server/index.js`.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item (`semantic`): 24 criteria,
  TC-01…TC-24, with 24 Test Plan rows. MCP-003's nine acceptance conditions map completely —
  (1)(2)→TC-13, (3)(7)→TC-14, (4)→TC-15, (5)→TC-16, (6)→TC-17, (8)→TC-10 (runtime) + TC-23 (type) +
  TC-24 (no second model), (9)→TC-22. MCP-002's own sub-items that were uncovered in the first draft
  now carry criteria: provenance and the `adopted`/`adapted` buckets (TC-18), bounded page count and
  per-request timeout (TC-19), the `examples/` end-to-end path (TC-20), and `agent-cli` composition
  plus the deployable manifest dependency edge (TC-21). MCP-2522 is out of scope by an explicit,
  sourced decision rather than by omission.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (`semantic`): all 24 are
  command-first with a named observable, and — the point six rounds were spent on — **every instrument
  now has a red condition that was measured, not asserted**:
  - The 18 `pnpm exec vitest run <path>` criteria (TC-01–05, 07, 09, 10, 13–19, 22) go red while
    unwritten: `pnpm exec vitest run …/client-initialize.test.ts` → **exit 1** ("No test files found").
    `passWithNoTests` is set only in the package `test` script; these invoke `vitest` directly.
  - TC-06 — reproduced in both directions: against a `src/` importing `StdioClientTransport` and
    calling `new WebSocket(...)` → **exit 0, caught**; with only a TC-07-style `__tests__` fixture →
    **exit 1, clean**; without `--exclude-dir=__tests__` that fixture alone → exit 0, so the exclusion
    is load-bearing.
  - TC-08 — `git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src`
    measured **0 lines** today; red on any edit to that package. Replaces a bare grep that returned
    **93 hits** today and so decided nothing.
  - TC-11 — `grep -rln … | wc -l` measured **2** today (`mcp-protocol.ts`, `mcp-tool.ts`), failing
    "at most 1"; the `index.ts` half measures 0. Counting per file rather than asserting absence is
    what makes the permitted "folded behind the canonical owner" outcome pass and two stacks fail.
  - TC-20 — `pnpm scenario:verify:mcp-client` measured **exit 1** today, script absent. Replaces
    `pnpm scenario:verify`, which I measured at **exit 0** printing **three** `result=` lines from
    MCP-001's scenarios, none mentioning Streamable HTTP, discovery or invocation.
  - TC-21 — the `agent-cli` manifest carries no edge to `@robota-sdk/agent-mcp` today (red); the
    absence grep measured exit 1.
  - TC-23 — red-proof executed with the repo's own `tsgo` 7.0.0-dev.20260707.2 and `expect-type@1.3.0`:
    GREEN **exit 0**; the failed member deleted → **exit 1**, `error TS2344: … does not satisfy the
constraint '"Expected: ..., Actual: never"'`.
  - TC-24 — `node scripts/harness/scan-single-connection-state-union.mjs` measured **exit 1** today,
    scan absent, which is the exact inversion of the earlier `--affected` form that passed because the
    scan was missing.
  - TC-12's scan half is a delta, but `run-all-scans --affected --context pr` implements its own base
    comparison and is paired with a test-and-build half that can fail.

**Caveat recorded, not a finding.** TC-08's three-dot diff decides correctly at the time it is
evaluated (pre-merge), but `origin/integration/agreement-014...HEAD` becomes empty once the base
absorbs HEAD, since the merge base then equals HEAD. Re-run after merge it would pass vacuously —
the same family as the diff defect this spec's Test Plan preamble names. It is sound as a completion
criterion for this delivery and should not be reused as a post-merge check.

**Scope of this verdict.** GATE-WRITE only: `draft → review-ready`. It authorizes no implementation.
Per the prior-gate map, GATE-APPROVAL reads this entry under the `recorded-pass` rule, which requires
this entry's `X → Y` to match the document's CURRENT `status:` — so the frontmatter must actually carry
`review-ready` before GATE-APPROVAL can open. This gate did not change it; a status change follows a
verdict rather than forming part of one.

**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/draft/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `1d7fc861d9b9da374222cc96ed2e1387af9748f5` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 000ba216397c (review bc61b60f, type/tags 1f7f9da9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (000ba216397c) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `ee211585973b` (untracked)

### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-09-22

**Status remains:** review-ready
**Violation:** The spec introduces new interface surfaces (`packages/agent-mcp/src/client/`,
`src/catalog/`, `src/supervisor/`, exported via `src/index.ts`), a new third-party dependency edge
(`@modelcontextprotocol/sdk` into `agent-mcp`) and a new harness instrument
(`scripts/harness/scan-single-connection-state-union.mjs` plus its `run-all-scans.mjs` registration),
so the conditional "Independent architecture validation" criterion ARMS. `spec-workflow.md` §
New-Surface Architecture Placement requires all four of its points to be recorded in the spec's
Architecture Review **before GATE-APPROVAL**, point 3 being an independent `proposal-reviewer` /
`architecture-audit-fanout` verdict. This document's Evidence Log contains **no** `proposal-reviewer`
verdict, no `architecture-audit-fanout` structure-channel result, and no reference to either: a
case-insensitive search of the whole document for `proposal-reviewer`, `architecture-audit-fanout`,
`structure-channel` and `ENDORSE` returns zero hits. The owner's `승인함` was therefore solicited and
recorded against a placement decision that had never been independently validated, which is the
process violation the rule names in terms ("Presenting a new surface for approval without an explicit,
independently-validated, owner-surfaced placement decision is a process violation"). This is prior
evidence the rule requires to exist before this gate, missing — not work merely left unfinished.

**Semantic criteria (the three the mechanical evaluator deferred as PENDING-GUARDIAN):**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document
  (`semantic`): **MET.** `**Instruction (verbatim):** "승인함"` is on this catalogue's own list of what
  counts ("승인"), carries no condition or question, and route `DIRECT` is named with its date and
  session as § GATE-APPROVAL requires. The staleness question was judged, not assumed. The record shows
  **eight** GATE-WRITE runs (seven ❌ FAIL, then ✅ PASS), each bound to a distinct document blob;
  `승인함` was given after the fourth, so four further runs followed it — one of them
  (blob `b00a14f96ef5`) mechanical-only. What changed across those runs is confined to § Completion
  Criteria, § Test Plan and § Affected Files: TC-10 split into TC-10/TC-23/TC-24 because `vitest run`
  erases type assertions; TC-24 given a red-proof, a direct scan invocation and its instrument added to
  § Affected Files; TC-20, TC-08 and TC-11 re-instrumented after a sweep found they could not go red
  (TC-20 measured **exit 0** on MCP-001's existing scenarios, TC-08's bare grep **93 hits** today,
  TC-11 searching the path containing the thing it measured); and the Test Plan preamble paragraph
  requiring every criterion to name its red condition. § Architecture Review is unchanged: the six
  design choices `승인함` was directed at — the official SDK as canonical owner, folding the 762-line
  hand-written path, stdio deferred to MCP-2522 on its independent subprocess-security acceptance,
  unconditional prefix naming over first-come-wins, three-valued capability state, reuse of
  `egress-policy`, and the era split recorded rather than handled — are all present verbatim in
  § Decision now and were all already present at GATE-WRITE run 1 (they are quoted in that run's own
  entry). Runs 4, 6, 7 and 8 each independently recorded "Architecture Review › Decision trade-off —
  PASS (unchanged)" and "new-surface placement — PASS (unchanged)" at the time they ran. Note that the
  mechanical `**Review fingerprint:** 000ba216397c` proves **nothing** about this question: it was
  captured when `gate.mjs approve` ran, after run 8, so it binds only the interval since then. The
  per-run record above is what carries this criterion, not the fingerprint and not the assurance given
  to the owner afterwards — "they did not object" is on this catalogue's NOT-counts list ("Silence or
  lack of objection") and was given no weight. **Recorded as an irregularity, not as this criterion's
  finding:** `승인함` was solicited while the document carried `status: draft` and had just recorded
  ❌ FAIL at GATE-WRITE run 4, i.e. before it was in the `review-ready` state this gate expects as input.
- GATE-APPROVAL — The item is inside the class as the registry defines it (`semantic`): **N/A, with
  reason.** This is a Route CLASS criterion and the approval took Route DIRECT, named as such in the
  recorded entry. No delegated class is invoked, so there is no registry boundary to evaluate; the
  criterion is inapplicable rather than unexamined. No relay was relied on either — the instruction was
  given in this document's own conversation, not reported from another session.
- GATE-APPROVAL — Independent architecture validation, conditional (`semantic`): **NOT MET — the
  finding above.** The condition arms: GATE-WRITE's own PASS entry judged new-surface placement as
  applying ("applies (not N/A)"), and § Alternatives Considered, alternative 3 (make `dag-nodes/mcp-tool` the
  canonical owner) demonstrates the ownership could plausibly sit elsewhere, which is the rule's test.
  Points 1 and 2 of the rule ARE satisfied in § Architecture Review — the Sibling scan names
  `packages/dag-nodes/mcp-tool` as the analogous layer and classifies it a sibling consumer, and reuse
  is at the shared core (`egress-policy` from `agent-core`, with a DAG-node dependency explicitly
  rejected). Point 3 is not. Recorded so the remediation is not searched for twice: an independent
  `proposal-reviewer` `REVIEW VERDICT: ENDORSE` dated 2026-09-21 **does** exist in
  `.agents/spec-docs/done/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`,
  and it validated the lower product family, the `agent-session` analog, the acyclic sibling-consumer
  graph and DAG ownership, "after explicit DAG ownership and MCP-002/MCP-2522 corrections". It does not
  discharge this criterion as written: it is not in **this** document's Evidence Log, this document does
  not cite it, and it settled package-level ownership and migration — not this spec's new intra-package
  surfaces, and not the new `@modelcontextprotocol/sdk` dependency edge or the new harness scan, none of
  which existed as decisions when it was issued.

**Required action:** obtain an independent `proposal-reviewer` verdict on the placement of
`src/client/`, `src/catalog/` and `src/supervisor/` within `agent-mcp`, of the
`@modelcontextprotocol/sdk` dependency edge, and of the new harness scan's location, and record the
verdict in this Evidence Log — a bare "reviewed" claim is insufficient, and retain an
`architecture-audit-fanout` structure-channel result alongside it since the surface is new. Citing
ARCH-1985's existing ENDORSE as the prior placement ground is appropriate and cheap, but it is an input
to that review, not a substitute for it. Because the owner's `승인함` was solicited before that
validation existed and while the document was still a failing draft, re-confirm the approval against
the validated placement rather than carrying the existing instruction forward; the placement decision
is the one the rule says the owner most needs to weigh and is "least able to reconstruct after the
fact". This entry records the semantic set only; it does not disturb the mechanical `✅ PASS` entry
above it, and the gate's composite verdict is NON-COMPLIANCE. No status change is made by this verdict.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `46a6a6d8e0ddc6a2838ce51efdd97cfe05b33ac4` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-22

**Status remains:** review-ready
**Failed criteria:**

- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-APPROVAL], [GATE-APPROVAL]
  **Required action:** a first GATE-WRITE run expects an empty log

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `1d4cd86b9c7d` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 291a4b2c04dd (review b98a1c90, type/tags 1f7f9da9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (291a4b2c04dd) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `1f6d2abfe239` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-22

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — Independent architecture validation, conditional (`semantic`): the condition ARMS
  (new interface surfaces `src/client/`, `src/catalog/`, `src/supervisor/`; a new
  `@modelcontextprotocol/sdk` edge into `agent-mcp`; a new exported host-neutral admission composition
  in `mcp-activation.ts`; a publication reclassification of `@robota-sdk/agent-mcp` from Private to
  Published; and the new `dag-node-mcp-tool → agent-mcp` cross-family edge). **Found:** the
  `proposal-reviewer` terminal `ENDORSE` of 2026-09-22 is recorded at
  § Architecture Review › Decision, lines 302–318 — in the document body, inside the fingerprinted
  review region, but **not in the `## Evidence Log`**. A case-sensitive search of the Evidence Log
  (lines 569 onward) for `proposal-reviewer`, `ENDORSE`, `architecture-audit-fanout` and
  `structure-channel` returns hits at lines 1220–1224 and 1272–1286 ONLY, and every one of them is
  inside the previous `🔴 NON-COMPLIANCE` entry — i.e. the text asserting the verdict's ABSENCE and
  prescribing its recording, not the verdict itself. **Required instead:** this catalogue's criterion
  reads "the Evidence Log MUST contain an independent `proposal-reviewer` verdict that ENDORSED the
  recommendation and explicitly covered the placement"; `spec-workflow.md` § New-Surface Architecture
  Placement point 3 states the same location independently ("the review and its verdict must be
  recorded in the Evidence Log"), and it is additive to that section's closing line about the
  Architecture Review, not an alternative to it. The prior NON-COMPLIANCE's own Required action named
  the same surface verbatim: "record the verdict in this Evidence Log". Second, unmet sub-requirement:
  "Retain an `architecture-audit-fanout` structure-channel result as additional placement evidence when
  the surface is new" — no structure-channel result appears anywhere in the document, and the surface
  is new by the reviewer's and GATE-WRITE's own finding.
  **Required action:** append the `proposal-reviewer` verdict to this `## Evidence Log` — the three
  rounds, the terminal `REVIEW VERDICT: ENDORSE`, and what the verdict covers — rather than leaving it
  only in § Decision, and record an `architecture-audit-fanout` structure-channel result beside it.
  Both are recordings of validation that has already occurred; nothing about the design needs to
  change, and **the owner's approval does not need to be solicited a third time** (see the staleness
  finding below, which is affirmatively MET). Note that appending the verdict edits `## Evidence Log`,
  which sits outside the review fingerprint (`gate-operations.mjs:2213-2214`), so it does not disturb
  the recorded `291a4b2c04dd` and does not re-open the "modified after approval" criterion.

**Semantic criteria checked — the other two (both MET):**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document
  (`semantic`): **MET.** Route `DIRECT`; `**Instruction (verbatim):** "승인 — 구현 진행"`, given
  2026-09-22 in this document's own conversation. "승인" is on this catalogue's own list of what counts
  and "구현 진행" authorizes implementation; the utterance carries no condition, question or hedge, and
  it is not the answer to a clarifying question. It is not a relay: it was given here, not reported from
  another session. **Staleness was measured, not assumed** — this is the criterion the prior
  NON-COMPLIANCE left standing while faulting the placement, and the document has changed materially
  since (24 → 29 criteria; scope widened from one package to three). Independently recomputed
  `reviewFingerprint()` from `scripts/harness/gate-operations.mjs` over the current document:
  `291a4b2c04dd (review b98a1c90, type/tags 1f7f9da9)` — byte-identical to the
  `**Review fingerprint:**` the approval entry recorded, and DIFFERENT from the superseded approval's
  `000ba216397c (review bc61b60f, …)`. Two things follow that a bare fingerprint match would not give:
  the § Architecture Review the owner approved is the post-review one, not the one `승인함` was
  solicited against; and because that fingerprint hashes the whole `## Architecture Review` body, the
  `proposal-reviewer` ENDORSE paragraph (lines 302–318) and the ADR-005 carry decision
  (`이 유닛에 다 넣기`) were demonstrably present in the text at the moment of approval. The two
  further disclosures — `agent-mcp` becoming a published package, and headless/CI DAG runs returning
  `pending` until an approval is supplied out-of-band — are recorded in the document at § Decision
  (publication, "owner approved the transition … on 2026-09-22") and § Fallback & Degradation
  Declaration (1) respectively, so what was disclosed is auditable rather than asserted. **No weight
  was given to non-objection**: every element above rests on an explicit recorded utterance or on a
  hash I recomputed myself. Input-state irregularity that faulted the previous approval is CURED: the
  document carried `status: review-ready` at this approval (the intervening `[GATE-WRITE] — ❌ FAIL`
  entry records "Status remains: review-ready"), and it sits in `.agents/spec-docs/backlog/`, the
  folder `spec-workflow.md` maps to that status.
- GATE-APPROVAL — The item is inside the class as the registry defines it (`semantic`): **N/A, with
  reason — checked affirmatively rather than waived on the route label.** This is a Route CLASS
  criterion and the recorded route is `DIRECT`, so no delegated class is invoked and no registry
  boundary is argued. Checked against the registry itself (`backlog-execution.md` § Delegated Approval
  Classes, the SSOT this catalogue points at), which holds exactly two rows: `LANE-L0-L1` (registered
  2026-08-28) and `BACKLOG-ZERO-MIGRATION` (registered 2026-08-28). Neither could have carried this
  item even had one been claimed — the document declares `lane: L2`, which is outside `LANE-L0-L1`'s
  scope by construction, and this item edits package source, manifests and a publication registry, which
  `BACKLOG-ZERO-MIGRATION` excludes in terms ("excludes package/app source, APIs/contracts, policy/gate
  documents"). The criterion is inapplicable, and would also have been unsatisfiable.

**Coverage of the ENDORSE against this document's new surfaces — recorded because it was the question
put to this run, and it is NOT the reason for the FAIL.** Judged adequate on substance. Named directly
in the verdict as § Decision reports it: `agent-mcp` as client/catalog/supervision owner; the three
intra-package surfaces; the `@modelcontextprotocol/sdk` edge; the single-connection-state instrument as
a package-local compiler-API test rather than a repository scan (which retires the
`scripts/harness/scan-single-connection-state-union.mjs` surface the prior NON-COMPLIANCE flagged — TC-24
and § Affected Files now name a package-local test, so that surface no longer exists); Streamable HTTP
alone behind an admit-then-construct seam; and `dag-node-mcp-tool → agent-mcp` mirroring
`dag-node-tool → agent-tools`. Two boundary changes are NOT named in the verdict's own enumeration —
the Private → Published reclassification of `agent-mcp`, and the host-neutral admission composition with
the deny-by-default `requiresTrustedWorkspace` inversion. Both are nevertheless reached: each is
traceable to a numbered reviewer round in the same paragraph (round 1 produced TC-27, the publication
criterion, as the resolution of the TC-21/TC-12 contradiction; round 3 produced the `project` mapping and
TC-29 after rejecting the sixth source member), and the terminal ENDORSE is round 3's, i.e. issued after
both had entered the document. Corroborated against the document rather than taken on the paragraph's
word: TC-27, TC-28 and TC-29 exist in § Completion Criteria with matching § Test Plan rows, and the
criteria count moved 24 → 29, which is the change the three rounds claim to have produced. The
reviewer's ruling that the ARCH-1985 ENDORSE of 2026-09-21 does not discharge this criterion is
independently correct and is adopted here: that verdict settled package-level ownership and migration,
and predates the sdk edge, the intra-package surfaces, the publication move and the admission
composition as decisions.

**Why FAIL and not NON-COMPLIANCE.** The process was not bypassed this time: the independent review ran
BEFORE the re-confirmation (the fingerprint proves the ENDORSE text was in the approved review body),
the owner answered explicitly rather than by silence, the document was in the `review-ready` state the
gate expects, and no implementation exists — `git status --porcelain` over the whole worktree at
HEAD `9eb7ea8fdb88` returns exactly one path, this spec document, untracked. What is missing is the
recording of validation that has already happened, on the surface the criterion names. That is
finishable work followed by a re-run, which is FAIL.

**Scope of this verdict.** Semantic set only. It does not disturb the mechanical `✅ PASS` entry above
it; the gate's composite verdict is FAIL. No status change is made by this verdict, and none follows
from it.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `d4de024863aeaa1c24a37fb6f9b69bf4de812c98` (untracked)

### Independent architecture validation — `proposal-reviewer`: ENDORSE (2026-09-22)

Recorded here because the gate catalogue's conditional criterion names the Evidence Log as the
location, and an earlier GATE-APPROVAL run returned NON-COMPLIANCE for its absence. The verdict is
also summarized in § Architecture Review › Decision; this is the authoritative record.

**Condition armed:** the spec introduces new intra-package surfaces (`src/client/`, `src/catalog/`,
`src/supervisor/`), a new external dependency edge, two new workspace dependency edges, and a
Private → Published reclassification of `@robota-sdk/agent-mcp`.

**Rounds:** three. Terminal verdict **ENDORSE**. Each round closed a defect this document's own
criteria could not observe, and each fix is recorded at the criterion it produced rather than only
here:

| Round | Verdict     | What it found                                                                                                                                                                                                                                                                                  | What closed it                                                          |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | REVISE      | Three ADR-005 obligations dropped; TC-21 and TC-12 mutually unsatisfiable (a published `agent-cli` depending on a Private `agent-mcp` trips `scan-publish-registry` rule 4, which TC-12 then forbids)                                                                                          | TC-27, and owner decision `이 유닛에 다 넣기`                           |
| 2     | REVISE      | TC-25 and TC-26 jointly satisfied by a migrated DAG node that refuses every call — the one outcome the migration exists to prevent; stale `folded or removed` permission contradicting § Decision                                                                                              | TC-28, § Affected Scope corrected                                       |
| 3     | REVISE      | A sixth `TMCPActivationSource` member is `false` by omission in `requiresTrustedWorkspace` (`mcp-activation.ts:137-139`), so host-declared approvals would record unbound to `repositoryKey` and `workspaceGeneration` (`:145-148`, `:316-322`) — a cross-clone grant revocation never reaches | `project` mapping instead of widening; deny-by-default inversion; TC-29 |
| 4     | **ENDORSE** | —                                                                                                                                                                                                                                                                                              | —                                                                       |

**What the ENDORSE explicitly covers**, quoted from its placement verdict: `agent-mcp` as
client/catalog/supervision owner; the three intra-package surfaces including the supervisor; the
`@modelcontextprotocol/sdk` edge, singular on the client side once the DAG node consumes the seam;
the single-connection-state instrument as a package-local compiler-API test rather than a repository
scan; Streamable HTTP alone behind the SDK's own two-implementation `Transport` contract, shaped
admit-then-construct; and `dag-node-mcp-tool → agent-mcp` mirroring the existing
`dag-node-tool → agent-tools`.

**Not discharged by prior art.** The reviewer ruled that the `proposal-reviewer` ENDORSE of
2026-09-21 on `ARCH-1985` settled package-level ownership only, and reaches neither this spec's
intra-package surfaces, nor the SDK dependency edge, nor the new instrument. That ruling is adopted
rather than argued around.

**Hand-over items carried into implementation, neither altering a § Decision choice:** the admission
composition must set `origin` to the declaring workflow artifact (§ Decision states this), and the
move of HTTP DAG execution behind the trust gate is declared as degradation (1) in § Fallback.

### Structure-channel placement evidence — `architecture-structure-auditor` (2026-09-22)

Retained as the additional placement evidence the gate catalogue's conditional criterion asks for
when the surface is new. Read-only audit of the six proposed structural surfaces.

`AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=4 medium=5 low=2 coverage=42/42 uncovered=none`

**Package-level placement: confirmed correct**, independently of the `proposal-reviewer` ENDORSE and
by different means (42 target × criterion cells, each cited to file:line). Verified healthy: the three
intra-package directories against the package's own `definition/` + `management/` precedent; the
public-surface mechanism (`index.ts` has no `export *`, and the package has no
`spec-surface-baseline.json` row, so its undocumented-export allowance is 0); the cross-family edge
`dag-node-mcp-tool → agent-mcp` (`family-siblings.mjs:58` — `if (!dep.startsWith(dagPrefix)) continue;`
— with `dag-node-tool → agent-tools` as a live analog); the published dependency closure (`agent-mcp`'s
only workspace edge is a `peerDependency` on the Published `agent-core`); and that removing the
762-line path breaks no consumer (`grep` for `@robota-sdk/agent-mcp` across `packages`, `apps` and
`examples` returns zero).

**It also verified the singular-client-edge claim by direction rather than by count**: of the four
existing `@modelcontextprotocol/sdk` declarations, `dag-cli` and `dag-mcp-server` import only the
server half and `agent-transport-mcp` has no client reference at all, so after the DAG migration the
client-side edge count is exactly one.

**Nine document findings, all applied in this revision; none altered a placement decision.** The four
`high` ones are recorded here because three of them describe checks that could not fail:

| ID  | What it found                                                                                                                                                        | Where it landed                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| F1  | The publication rationale was **false**: `agent-cli` publishes as a self-contained bundle (INFRA-028), so the edge is a `devDependency` and rule 4 never reads it    | § Decision (struck in place), TC-21, TC-27     |
| F2  | The admission composition had no carrier for workspace-trust facts on the DAG side — `INodeExecutionContext` holds none, and a leaf cannot reach workspace authority | § Decision (composition root injects the port) |
| F3  | The node's own `validateHttpUrl` private-range regex survived the migration, leaving two admission paths against § Decision; TC-25's alternation could not see it    | Solution step 11, TC-25                        |
| F4  | Deleting `mcp-tool.ts` and `relay-mcp-tool.ts` removes **both** call sites of the CORE-040 third-party schema boundary, with no successor named                      | TC-30, § Affected Files                        |

The five `medium` findings (the node's type-only SDK import invisible to `check-dep-kind`; the two
SSOT classification documents; the composition's placement inside the 354-line policy file; the
unallocated `session` / `supervisor` connection-state boundary; the unsatisfied `agent-core` peer on
the node manifest) and the two `low` ones (file-name stutter; `@types/node` undeclared) are applied in
§ Decision, § Affected Scope, § Affected Files and Solution step 11.

**F1 is the finding that matters most to read**, and not for its size. It falsified a ground this
document had asserted for three revisions and that had been reported to the owner as measured fact.
The audit measured it the other way — 0 runtime `@robota-sdk` deps against 26 dev, rule 4's own
comment excluding `devDependencies`, and two Private packages already dev-depended on with the scan
green. Publication remains correct; it rests on ADR-005 alone, which was always sufficient.

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-22

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the Architecture Review section changed since the approval (b98a1c90 → 2c79f717)
  **Required action:** re-run approve on the revised review

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `52afd9435d30` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-22

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the Architecture Review section changed since the approval (b98a1c90 → 2c79f717)
  **Required action:** re-run approve on the revised review

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `6851c21aa1d5` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 갱신 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 8af92f399efe (review 2c79f717, type/tags 1f7f9da9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8af92f399efe) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `5aba56c078d8` (untracked)

### Measured base state for TC-12 (2026-09-22)

TC-12 is worded "no NEW failure relative to the base". A criterion phrased that way is unjudgeable
until the base is measured, so it is measured here rather than assumed at verification time.

Base: `origin/integration/agreement-014@9eb7ea8f`, worktree clean apart from this untracked document.

- `pnpm --filter @robota-sdk/agent-mcp test` → **14 test files, 126 tests, all passing**
- `pnpm --filter @robota-sdk/agent-mcp build` → exit 0
- `node scripts/harness/scan-publish-registry.mjs` → passed, 90 workspace packages reconciled

So the base is green on every instrument TC-12 names, and **any failure after this unit's changes is
a NEW one**. There is no tolerated base-state advisory to argue about here, unlike INFRA-2804.

**Expected test-count delta, recorded so a drop is not mistaken for a regression.** The four suites
this unit removes or re-points carry **45** of those 126 tests:

| Suite                                                                | Disposition                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------ |
| `mcp-protocol.test.ts`, `mcp-tool.test.ts`, `relay-mcp-tool.test.ts` | deleted with their subjects                            |
| `third-party-schema-enforcement.test.ts`                             | re-pointed at the `catalog/` path, not deleted (TC-30) |

The floor after implementation is therefore **81 surviving tests plus the new suites**, not 126. A
run reporting fewer than 81 has lost coverage this unit did not intend to remove.

### Independent architecture validation, second reviewer — `proposal-reviewer` (Sonnet): REVISE → applied (2026-09-22)

**Why a second reviewer.** The first reviewer's session became unreachable after its ENDORSE — three
consecutive API 529s on retry — at the point where two things needed its judgement: the structure-channel
audit had falsified a premise it and this author had both asserted (rule 4 / `devDependencies`), and the
F2 disposition (admission injected at the DAG composition root) had never been judged by it. Rather than
carry an ENDORSE whose ground had moved, a fresh reviewer was dispatched on the **current** text with
both prior records in front of it and an explicit instruction not to trust them.

**Verdict: REVISE**, narrow. It independently re-derived every placement conclusion — `agent-mcp` as
owner, the three intra-package surfaces, the `dag-node-mcp-tool → agent-mcp` direction, the `project`
mapping, the deny-by-default inversion (verified behaviour-identical for the five current sources), and
publication on ADR-005 alone — and confirmed the rule-4 correction by its own measurement. It found one
thing no prior pass had reached:

> **The DAG composition root can inject an admission, but nothing on the DAG line can bind one.**
> `dag-cli` has no dependency on `agent-framework`, the sole owner of workspace-trust computation; no
> `dag-*` package or `apps/dag-runtime-server` mentions `trustState`, `repositoryKey` or
> `workspaceGeneration`; the agent line's granting surface (`workspace-trust-command.ts`) has no DAG
> analogue. So the injected admission is fail-closed for **every** DAG run, not only headless ones, and
> all thirty criteria can go green — TC-28 through an injected test double — while the real `dag-cli`
> ships a feature no user can switch on.

Each premise was re-verified by this author before acting: 0 `agent-framework` hits in
`packages/dag-cli/package.json`; 0 files under `dag-cli/src`, `dag-core/src`, `dag-framework/src`,
`apps/dag-runtime-server/src` touching the three trust fields; `agent-cli/src/startup/` carries
`workspace-trust-admission.ts` and `workspace-trust-command.ts`.

**Applied, all outside the review fingerprint (`8af92f399efe` unchanged, owner approval intact):**

1. § Fallback declaration (1) rewritten from "headless or CI runs return `pending`" to "every DAG run
   returns `pending` until a DAG-side trust-granting surface exists", and states plainly that the
   "product-reachable HTTP vertical" is reachable for the agent family and **not yet for the DAG family**.
2. TC-27's Test Plan row no longer claims to resolve the TC-21/TC-12 conflict that never existed.
3. The DAG-side trust-granting surface is filed as its own root item, **issue #2816**, under umbrellas
   issue #2525 and issue #1989 — on the reviewer's explicit instruction not to fold it into this unit, and after
   searching both umbrellas and `.agents/tasks/` and finding no existing owner.

**What this does not change.** No § Decision choice, no package placement, no criterion count. The
design was right; its disclosure of one consequence was too narrow, and the unit's self-description
("first product-reachable HTTP vertical slice") was true of one product family and silently false of the
other.

### Correction to the second reviewer's finding — the DAG product path is embedded, not `dag-cli` (2026-09-22)

The second `proposal-reviewer` finding ("the DAG line has no surface to grant MCP activation trust") and
this author's verification of it both measured `packages/dag-cli` and concluded from it. The owner asked
why `dag-cli` figured at all, since the DAG had been designed as embedded in the agent product behind
`agent-command`. Measured:

| Claim in the finding                            | Verified                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dag-cli` is the DAG composition root           | **False for the product.** `dag-cli` is `private`, has no consumer but itself, and its README calls it an internal shell. `agent-cli` dev-depends on `agent-command-workflows`, not `dag-cli`                                                                |
| The DAG line cannot reach workspace-trust facts | **False for the product.** `agent-command-workflows` depends on `agent-framework`, the workspace-trust owner. (True that no code there touches them today — 0 hits — because nothing there constructs this node)                                             |
| Every DAG run returns `pending` after this unit | **Wrong shape.** The product's `/workflows` registry is `dag-nodes-default` (`local-dag-runtime-provider.ts:148`), which declares fifteen nodes and **not** `dag-node-mcp-tool`. The product cannot load the node at all today; `pending` never arises there |

What survives of the finding: the migrated node is a library the product does not yet load; wiring it into
the `nodeRegistry` seam at `workspace-runtime.ts:41` with an admission bound from `agent-framework` is
real, unowned work. That — not a missing trust surface — is now what issue #2816 and `MCP-2816` describe.
§ Fallback (1), § Affected Files and TC-28 are rewritten to the measured picture; § Decision is untouched
(its F2 paragraph names "the composition root" without naming `dag-cli`, and remains true of both roots).
Review fingerprint unchanged.

Recorded because two independent readers converged on the same wrong file, and the correction came from
the owner's memory of the design rather than from either review. The failure was not a false measurement
but a true measurement of the wrong subject.

### Independent architecture validation, second reviewer — final verdict: ENDORSE (2026-09-22)

The second `proposal-reviewer` re-read the current text after its three REVISE items were applied and
after its own central finding had been reframed on the owner's correction. It re-verified ten premises of
the reframe against code and manifests (every one reproduced, with file:line), and answered the two
questions put to it:

- **(a)** The disposition — map the host declaration onto `project`, inject at the composition root,
  `origin` = the declaring `.dag.json` — is unchanged by the root being `agent-command-workflows` rather
  than `dag-cli`. § Decision's F2 wording was root-agnostic, and the correction supplies what was missing:
  `agent-command-workflows → agent-framework` is a live edge, so a non-fail-closed binding is reachable
  from the product root at all, which `dag-cli` alone could never offer.
- **(b)** Scoping the `/workflows` registry wiring out to issue #2816 is textually faithful to ADR-005:
  "first product-reachable HTTP vertical slice" sits in the agent-line sentence ending in
  `agent-cli → agent-mcp`; the DAG sentence uses "migrates / retains / depends / removes"; and the ADR's
  explicit three-edge target graph names neither `dag-nodes-default → dag-node-mcp-tool` nor
  `agent-command-workflows → dag-node-mcp-tool`.

**Residual it named and asked to leave:** § Decision still says "for a headless run the injected admission
is fail-closed", narrower than the corrected § Fallback (1). Not a contradiction; inside the review
fingerprint, so left for the next legitimate reopening of § Architecture Review. Recorded here so it is
not rediscovered.

### Repair record — 25 bare `#N` references qualified; two advisories classified as base state (2026-09-22)

`scan-reference-kind-qualified` requires a document the baseline does not know to start at zero
unqualified references; this one had 25. All are at line 476 or later — outside the review fingerprint —
and 19 of them sit inside earlier gate entries that quoted this document's own former wording. Each was
qualified in place by prefixing `issue ` to the number on its exact line (`#1990` → `issue #1990`, etc.),
and one `Alternatives Considered #3` became `Alternatives Considered, alternative 3`. No other character
in any entry changed; the repair is recorded here rather than done silently for the same reason the
INFRA-2804 backtick repair was.

The affected run (`HARNESS_BASE_REF=origin/integration/agreement-014 run-all-scans --affected --context pr`)
reported 38 passed and two advisories. After this repair the remaining findings are both **base state**,
verified rather than assumed: `task-merged-citation` names `SECRET-2664` and commit `9aa6e2c3a`, which is
an ancestor of `origin/develop` and touches nothing in this unit; `reference-kind-qualified` names
`.agents/spec-docs/done/INFRA-2772-…md:513`, which exists on the base with the same bare `pre-#2375`.
Neither is a NEW failure for TC-12, and neither is this unit's to edit.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 갱신 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 8af92f399efe (review 2c79f717, type/tags 1f7f9da9) — recomputed by this
guardian, not read from the entry

Semantic set only (the three `gate.mjs judge` returned as PENDING-GUARDIAN). It does not disturb the
mechanical `✅ PASS` above it; composite verdict PASS. No status change is made by this verdict.

**Ordering check — passed.** Prior gate GATE-WRITE shows `✅ PASS` at this log's eighth GATE-WRITE
entry with `**Status upgrade:** draft → review-ready`; the row's declared `recorded-pass` rule is
satisfied because that entry's `Y` (`review-ready`) equals the document's current `status:`, so the
later `[GATE-WRITE] — ❌ FAIL` (empty-log criterion, the structurally-guaranteed re-run the rule
names) does not block. Input state matches: frontmatter `status: review-ready`, file in
`.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Spec-Document Status and Lifecycle
Folders maps to that status. NON-COMPLIANCE trigger checked and not fired: `git status --porcelain`
over the whole worktree returns four paths — this spec, `.agents/tasks/MCP-2816-…md`,
`.agents/memory/MEMORY.md` and one memory note — and no implementation path.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document
  (`semantic`): **MET.** Route `DIRECT`; `"승인 갱신 — 구현 진행"` given 2026-09-22 in this document's
  own conversation — "승인" is on this catalogue's list of what counts, "구현 진행" authorizes
  implementation, and the utterance carries no condition, question or hedge. Not a relay. The question
  this run was asked to test is whether that renewal is directed at the text as it now stands, given
  the post-approval edits to § Fallback, § Affected Files and two Test Plan rows. Judged **yes**, on
  four grounds, each measured:
  1. The approved region is byte-identical. `reviewFingerprint()` from
     `scripts/harness/gate-operations.mjs` recomputed over the current file by this guardian returns
     `{"review":"2c79f717","typeTags":"1f7f9da9","combined":"8af92f399efe"}` — equal to the fingerprint
     recorded with the renewal. Every § Architecture Review choice the owner re-approved (§ Decision,
     § Alternatives, § Affected Scope, the checklist) and `type:`/`tags:` are unchanged.
  2. The § Fallback change **narrows** the harm disclosed at solicitation rather than widening it. The
     owner was told product DAG headless/CI runs would return `pending`; the corrected text says no
     product DAG path loads this node at all. Re-measured here rather than accepted: `dag-nodes-default`
     declares 19 dependencies and `@robota-sdk/dag-node-mcp-tool` is not among them;
     `packages/dag-cli/package.json` is `"private": true`; `packages/agent-cli/package.json:110` names
     `@robota-sdk/agent-command-workflows` and no `dag-cli`; `agent-command-workflows` depends on
     `@robota-sdk/agent-framework`; the registry seam is
     `local-dag-runtime-provider.ts:148` (`this.options.nodeRegistry ?? loadDefaultNodeRegistrySync()`).
     So the only site that constructs the node is the private dev shell, and no shipped product run
     degrades — strictly less than the disclosed degradation.
  3. The approved region never promised what the correction removed. § Decision's only headless
     sentence (line 334, "For a headless run the injected admission is fail-closed") remains true of
     that one construction site, and § Decision asserts no DAG product reachability; the too-broad
     claim lived in § Fallback's self-description and became more accurate, not less.
  4. The correction originated with the owner in this same conversation (entry "Correction to the
     second reviewer's finding"), and the residual is a real filed item, not a promise:
     `gh issue view 2816` returns state `OPEN`, created `2026-09-22T01:37:23Z`, titled "The /workflows
     product path never loads dag-node-mcp-tool, and nothing binds an MCP activation admission where it
     would be constructed" — i.e. the issue already carries the corrected framing.
     A third solicitation is therefore not required. No weight was given to non-objection.
- GATE-APPROVAL — The item is inside the class as the registry defines it (`semantic`): **N/A, with
  reason, checked against the registry rather than waived on the route label.** The recorded route is
  `DIRECT`, so no delegated class is invoked. `backlog-execution.md` § Delegated Approval Classes holds
  exactly two rows, `LANE-L0-L1` and `BACKLOG-ZERO-MIGRATION`, both Registered 2026-08-28; neither could
  carry this item had it been claimed — the frontmatter declares `lane: L2`, outside `LANE-L0-L1` by
  construction, and this unit edits package source, manifests and `.agents/publish-registry.md`, which
  `BACKLOG-ZERO-MIGRATION` excludes in terms. Inapplicable, and would also have been unsatisfiable.
- GATE-APPROVAL — Independent architecture validation, conditional (`semantic`): **MET.** The condition
  arms (three new intra-package surfaces, the `@modelcontextprotocol/sdk` edge, two new workspace edges,
  and the Private → Published reclassification — `.agents/publish-registry.md:70` still lists
  `@robota-sdk/agent-mcp` under "Private Packages", so the reclassification is live scope). Both halves
  are now on the surface the criterion names, the `## Evidence Log`:
  - **Reviewer verdict.** Two `proposal-reviewer` ENDORSE records, each its own entry with what it
    covers. The one that discharges the criterion is the **second** reviewer's, because it is the only
    ENDORSE issued on the current text: its REVISE entry enumerates the placement conclusions it
    re-derived independently (`agent-mcp` as owner, the three surfaces, the
    `dag-node-mcp-tool → agent-mcp` direction, the `project` mapping, the deny-by-default inversion,
    publication on ADR-005 alone), and its final entry records the ENDORSE after re-verifying the
    reframe's ten premises. Independence was tested, not assumed: the reframe it accepted came from the
    owner, so four of its premises were re-measured here (item 2 above) and all reproduce. The first
    reviewer's ENDORSE stands as corroboration only — it rests partly on the rule-4 ground F1 later
    falsified — and its rounds table cites real code: `requiresTrustedWorkspace`
    (`packages/agent-mcp/src/mcp-activation.ts:137-139`) does return
    `source === 'project' || 'plugin' || 'local'`, so a sixth source member would indeed be `false` by
    omission, which is the round-3 finding TC-29 closes.
  - **Structure channel.** The retained `architecture-structure-auditor` result is the structure channel
    of `architecture-audit-fanout` (`.agents/skills/architecture-audit-fanout/SKILL.md:12`) and its line
    is in that skill's exact terminal form:
    `AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=4 medium=5 low=2 coverage=42/42 uncovered=none`.
    Five of its named checks were reproduced here: `packages/agent-mcp/src/index.ts` contains zero
    `export *`; `scripts/harness/spec-surface-baseline.json` has no `agent-mcp` row;
    `family-siblings.mjs:58` is the `if (!dep.startsWith(dagPrefix)) continue;` line it cites;
    `packages/dag-nodes/tool/package.json:51` is the live `dag-node-tool → agent-tools` analog; and a
    grep for `@robota-sdk/agent-mcp` across `packages`, `apps` and `examples` finds no consumer outside
    the package itself, so removing the 762-line path breaks nothing. Four `@modelcontextprotocol/sdk`
    manifest declarations exist (`dag-cli`, `dag-nodes/mcp-tool`, `agent-transport-mcp`,
    `dag-mcp-server`), as the singular-client-edge argument states.
    **Qualification recorded, not waived:** the run is **not ledger-bound** — `.agents/loop-runs/` has no
    run opened on 2026-09-22 in any loop, and `architecture-audit-fanout.jsonl` ends at 2026-09-11 — so
    the channel was dispatched directly rather than through the fanout pipeline, which would have left an
    expectation/observation pair. No rule or scan requires one for a directly-dispatched channel
    (`scan-architecture-refresh-signals.mjs` governs ledger runs only and exits 0), and the criterion asks
    for the result to be retained as _additional_ evidence, which it is; the corroboration above is by
    content, not by ledger.

**Third question put to this run — whether qualifying `#N` inside earlier gate entries edits the record
impermissibly: it does not.** No rule in `spec-workflow.md`, `backlog-execution.md` or this catalogue
declares Evidence Log entries immutable. `scripts/harness/reference-kind.mjs:85-92` decides the boundary
that exists: fenced blocks, inline code spans and `**Instruction (verbatim):**` lines are excluded from
the rule precisely because "the record IS the exact words" — so the three verbatim approval instructions
were structurally out of reach of the repair (and carry no `#N` in any case), while gate-entry prose is
this document's own prose and is in scope. The two bare forms remaining (`` `#1990` ``, `` `pre-#2375` ``)
sit inside inline spans, which is consistent. The repair is disclosed in a dated entry naming its count
and region, and it changed no verdict, criterion, measurement or `Judged at` line.

**Observation recorded, not a criterion finding.** § Affected Files and § Fallback call
`packages/dag-cli/src/local-runner/node-registry.ts:28` "the repository's only
`new McpToolNodeDefinition()`"; `packages/dag-nodes/mcp-tool/src/index.ts:276` also constructs one (the
node's own factory), as do four sites in `mcp-tool-node.test.ts`. The conclusion the sentence supports is
unaffected — none of those registers the node, and `dag-nodes-default` does not depend on the package —
so it changes no verdict here, but the word "only" is inaccurate as written and is the author's to
correct at the next legitimate edit.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `e581b6597447b1c25b7a67086ad55feb3dea8d38` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-22

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/30 TC ids and carries 4 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 3 path(s) outside the paired spec/Task: .agents/memory/MEMORY.md, .agents/memory/a-true-measurement-of-the-wrong-subject.md, .agents/tasks/completed/MCP-2816-dag-line-has-no-surface-to-grant-mcp-activation-trust-so-every-dag-json-mcp-serv.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `948a47fccdeb` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS, superseded by the owner-directed reset (recorded against the 30-criterion text; the live PASS is the later entry) | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (30)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1614 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
  "specPath": ".agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-23"
    },
    {
      "kind": "tc-id",
      "value": "TC-24"
    },
    {
      "kind": "tc-id",
      "value": "TC-22"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    },
    {
      "kind": "tc-id",
      "value": "TC-15"
    },
    {
      "kind": "tc-id",
      "value": "TC-16"
    },
    {
      "kind": "tc-id",
      "value": "TC-17"
    },
    {
      "kind": "tc-id",
      "value": "TC-18"
    },
    {
      "kind": "tc-id",
      "value": "TC-19"
    },
    {
      "kind": "tc-id",
      "value": "TC-20"
    },
    {
      "kind": "tc-id",
      "value": "TC-30"
    },
    {
      "kind": "tc-id",
      "value": "TC-29"
    },
    {
      "kind": "tc-id",
      "value": "TC-28"
    },
    {
      "kind": "tc-id",
      "value": "TC-25"
    },
    {
      "kind": "tc-id",
      "value": "TC-26"
    },
    {
      "kind": "tc-id",
      "value": "TC-27"
    },
    {
      "kind": "tc-id",
      "value": "TC-21"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
    ".agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `53989cbdbf6f` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `42cc8f71e008` (untracked)

### Scope reduction on owner decision — the DAG node leaves this unit (2026-09-22)

The owner, on being shown that the placement work had been reasoning about `dag-cli`, stated that the
DAG is wired in command form and asked whether the MCP form should be removed. Measured before asking:
the command-form DAG (`agent-command-workflows`, `dag-nodes-default`, `dag-builder`, `dag-framework`)
has **zero** references to `dag-node-mcp-tool`; the node is absent from the product's default catalog;
no user documentation names it; `dag-mcp-server` has no consumer; `AGREEMENT-015` / issue #1986 owns
Robota-sessions-as-MCP-server, not these. Put to the owner as a two-option question; the answer,
verbatim: **`MCP-002에서 분리, 별도 제거 유닛`**.

**Applied.** TC-25, TC-26 and TC-28 removed (30 → 27 criteria). § Fallback returns to "None". The
host-neutral admission composition module, the DAG composition-root injection, the `origin` constraint
and Solution steps 11–12 are withdrawn; the deny-by-default inversion of `requiresTrustedWorkspace` and
TC-29 stay, with § Decision now stating the ground without the host case. ADR-005 is amended in place
(Decision amendment paragraph, struck Consequences bullets, References). Issue #2817 / `MCP-2817` files
the removal of `dag-node-mcp-tool`, `dag-mcp-server` and `dag-cli/src/mcp`; issue #2816 / `MCP-2816` is
superseded by it.

**Why the standing independent validation still covers the design.** Every placement the two
`proposal-reviewer` ENDORSEs and the structure channel named — `agent-mcp` as owner, the three
intra-package surfaces, the SDK edge, the `agent-cli → agent-mcp` composition, publication, the
single-connection-state instrument, the admit-then-construct seam, the inversion — is unchanged. The
change is a pure subtraction of one surface and one edge; nothing new was placed. The review fingerprint
changes because § Architecture Review was edited, so the owner's approval is re-solicited on the reduced
text and GATE-APPROVAL's guardian judges whether a subtraction needs a fresh verdict; this entry is the
input to that judgement, not a substitute for it.

**Not lost.** Everything learned about the DAG line while it was in scope — the wrong-subject
measurement, the trust-binding gap, the catalog absence — is recorded in the entries above and in
`MCP-2817`'s Problem table, so the removal unit starts from measured facts.

### Owner-directed reset to `review-ready` for the re-plan (2026-09-22)

This document had advanced `review-ready → approved → in-progress` on the 30-criterion design when the
owner reduced its scope (entry above). The rules define no transition for a design change on an
in-progress spec, `gate.mjs advance` is one-directional, and editing `status:` or moving the file by hand
is otherwise forbidden. No commit exists on this branch yet. The owner was asked whether to reset the
status so GATE-APPROVAL and GATE-IMPLEMENT run properly on the reduced text, and answered (verbatim):

> **지시함 — review-ready로 되돌리고 게이트 재실행 (권장)**

Applied on that instruction: file moved `active/ → backlog/`; `status: in-progress → review-ready`; the
paired Task's `status:` returns to `todo` and its spec-path reference to `backlog/` once the
`DONE-GATE-STAGE-1` guardian currently writing that file has finished. The earlier
`[GATE-APPROVAL] — ✅ PASS` and `[GATE-IMPLEMENT] — ✅ PASS` entries stand as records of the 30-criterion
design and are superseded by the entries this re-run produces. This is a recorded owner directive, not an
agent exemption.

**Approval of the reduced design, given the same day (verbatim):** `승인 — 축소 설계로 구현 진행` — recorded
by `gate.mjs approve` immediately below, against the reduced text's review fingerprint.

### Independent architecture validation on the reduced design — `proposal-reviewer` (Sonnet): ENDORSE (2026-09-22)

Asked two things only: whether every placement its ENDORSE named survives the subtraction, and whether
keeping the `requiresTrustedWorkspace` inversion + TC-29 without the host case is speculative generality.
It re-read the reduced text (§ Affected Scope, § Alternatives, § Decision including the amended block,
§ Fallback, § Solution, § Affected Files, the 27 criteria) and answered:

- **(a)** all six named placements present and unchanged — `agent-mcp` as owner; the three intra-package
  surfaces; the SDK edge (singular on the client side now by removal via issue #2817 rather than
  migration; `agent-mcp`'s own edge untouched); `agent-cli → agent-mcp` as a devDependency with
  publication on ADR-005 alone; the package-local single-union instrument; the admit-then-construct seam,
  which was always justified by MCP-2522's stdio adapter and never by the DAG line. It also checked the
  target-graph statement is consistent in all three places it appears.
- **(b)** the inversion is the opposite of speculative generality: zero new surface, zero behaviour change
  for the five current sources (re-verified), a hazard demonstrated as a real near-miss in this review,
  TC-29 justified on its own terms, and moving it to issue #2817 — a DAG-file deletion — would be a
  non-sequitur that leaves a known fail-open shape live on `develop` for nothing.

Verdict: **ENDORSE** for the reduced design. It noted, as bookkeeping rather than a finding, that the
earlier GATE-IMPLEMENT PASS was recorded against the 30-criterion text — which the reset above addresses.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 축소 설계로 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** a91ae6e90693 (review d0b992cf, type/tags 1f7f9da9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a91ae6e90693) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c5b09ff52e00` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 축소 설계로 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** a91ae6e90693 (review d0b992cf, type/tags 1f7f9da9) — recomputed over the current
file by this guardian with `reviewFingerprint()` from `scripts/harness/gate-operations.mjs`, not read
back from the entry above

Semantic set only (the three `gate.mjs judge` returned as PENDING-GUARDIAN on the reduced 27-criterion
text: 9 criteria, 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN). It does not disturb the mechanical `✅ PASS`
written by `gate.mjs approve` above it; composite verdict PASS. No status change is made by this verdict.

**Ordering check — passed. The owner-directed reset this run stands on is a recorded directive, not a
bypass.** Prior gate GATE-WRITE shows `✅ PASS` with `**Status upgrade:** draft → review-ready`; the
row's declared `recorded-pass` rule is satisfied because that entry's `Y` (`review-ready`) equals the
document's current `status:`, so the later `[GATE-WRITE] — ❌ FAIL` entries — the structurally-guaranteed
empty-log re-runs the rule names — do not block. Input state matches: `status: review-ready` and the file
in `.agents/spec-docs/backlog/`, the pair `spec-workflow.md` § Spec-Document Status and Lifecycle Folders
maps; `node scripts/harness/scan-doc-folder-status-agreement.mjs` exits 0 (`violations=0 result=PASS`)
over the whole tree and the `active/` copy is absent from disk. Because that state was reached by a
manual `in-progress → review-ready` reset rather than by a gate, the reset itself was judged, on five
measured grounds:

1. **It is recorded as an owner instruction, verbatim, at the point of the change.** The entry
   "Owner-directed reset to `review-ready` for the re-plan" states the question put and the answer:
   `지시함 — review-ready로 되돌리고 게이트 재실행 (권장)`. The rules define no backward transition and
   `gate.mjs advance` is one-directional, so the agent escalated instead of inventing one — that is the
   difference between a directive and an exemption.
2. **Nothing in the repository record is rewritten.** `git log --oneline origin/develop..HEAD --
'.agents/spec-docs/*MCP-002*'` returns nothing; HEAD is `9eb7ea8fdb88` (the MCP-001 merge, PR #2803)
   and equals the branch upstream `origin/integration/agreement-014`. The `approved` and `in-progress`
   states never entered history; the whole planning state is uncommitted.
3. **The Evidence Log is append-only across the reset.** The earlier `[GATE-APPROVAL] — ✅ PASS` and
   `[GATE-IMPLEMENT] — ✅ PASS` on the 30-criterion design are both intact and marked superseded; no
   entry was deleted or edited to make this ordering check pass.
4. **The NON-COMPLIANCE trigger did not fire, so the reset un-authorizes no work already done.**
   `git status --porcelain` plus `git diff HEAD --stat` over the whole worktree return nine paths and
   302 insertions / 16 deletions, all planning artifacts: this spec at `backlog/` (untracked) with the
   staged `active/` deletion, the paired Task, `MCP-2816`/`MCP-2817` Tasks, `.agents/memory/MEMORY.md`
   plus one memory note, and `.design/decisions/ADR-005-…md`. Zero `packages/**` or `apps/**` path; the
   three new surfaces (`src/client/`, `src/catalog/`, `src/supervisor/`) do not exist. No implementation
   was started under the `in-progress` state.
5. **The reset's direction is toward the gates, not around them.** NON-COMPLIANCE is for a gate skipped
   or bypassed; here the stale 30-criterion GATE-APPROVAL and GATE-IMPLEMENT PASSes would have carried
   the reduced design forward with no fresh verdict, and the owner instead directed that both be
   re-earned. Re-opening a passed gate is the conservative move, and it is recorded.

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document
  (`semantic`): **MET.** `"승인 — 축소 설계로 구현 진행"` — `승인` is on this catalogue's list of what
  counts, `구현 진행` authorizes implementation, and `축소 설계` names what is being approved. No
  condition, question or hedge; not the answer to a clarifying question (the preceding owner turn was the
  reset directive, a separate instruction). Directed at **this text as it now stands**, checked three
  ways rather than accepted:
  1. Bound by fingerprint. `gate.mjs approve` recorded it against a91ae6e90693; `reviewFingerprint()`
     recomputed here over the current file returns
     `{"review":"d0b992cf","typeTags":"1f7f9da9","combined":"a91ae6e90693"}` — equal, so § Architecture
     Review and `type:`/`tags:` are byte-identical to what was approved.
  2. The reduction the owner was shown is the reduction the document carries. `TC-25`, `TC-26` and
     `TC-28` appear nowhere in § Completion Criteria or § Test Plan (27 TC rows counted, matching 27
     Test Plan rows; the three survive only in historical Evidence Log prose). § Fallback & Degradation
     Declaration reads `None.` with both DAG degradations recorded as withdrawn. TC-29 and the
     `requiresTrustedWorkspace` inversion are retained, as the solicitation said.
  3. The filings are real, not promised. `gh issue view 2817` → `OPEN`, created `2026-09-22T02:12:23Z`,
     "Remove the DAG↔MCP surfaces the command form superseded: dag-node-mcp-tool, dag-mcp-server,
     dag-cli/src/mcp"; `gh issue view 2816` → `CLOSED`; ADR-005's amendment is in the worktree diff with
     the two superseded Consequences bullets struck rather than removed.

  Not a relay: the route is DIRECT and the instruction is recorded as given in this document's own
  conversation. **Limit stated rather than papered over:** this guardian cannot read the owner's turn
  itself. What it can check, and did, is that the utterance is bound by a recomputed fingerprint to the
  exact text in front of it and that every fact the solicitation rested on reproduces.

- GATE-APPROVAL — The item is inside the class as the registry defines it (`semantic`): **N/A, with
  reason, checked against the registry rather than waived on the route label.** The recorded route is
  `DIRECT`, so no delegated class is invoked. `backlog-execution.md` § Delegated Approval Classes holds
  exactly two rows (`scan-standing-delegation-evidence` reports `2 registered class(es)`), `LANE-L0-L1`
  and `BACKLOG-ZERO-MIGRATION`; neither could carry this item had it been claimed — frontmatter declares
  `lane: L2`, outside `LANE-L0-L1` by construction, and this unit edits package source, manifests and
  `.agents/publish-registry.md`, which `BACKLOG-ZERO-MIGRATION` excludes in terms. Inapplicable, and
  would also have been unsatisfiable.

- GATE-APPROVAL — Independent architecture validation, conditional (`semantic`): **MET.** The condition
  arms on the reduced text too: three new intra-package surfaces (`src/client/`, `src/catalog/`,
  `src/supervisor/`), the new `@modelcontextprotocol/sdk` edge for `agent-mcp`, the new
  `agent-cli → agent-mcp` devDependency edge, and the Private → Published reclassification of
  `@robota-sdk/agent-mcp`. The one placement the reduction removed — the cross-family edge
  `dag-node-mcp-tool → agent-mcp` — is a subtraction; a withdrawn edge places nothing.
  - **The ENDORSE on the current text** is the entry "Independent architecture validation on the reduced
    design — `proposal-reviewer` (Sonnet): ENDORSE". Not a bare "reviewed" claim: it names the two
    questions put, the sections re-read, the six placements one by one, and the speculative-generality
    ruling with its grounds. Its load-bearing claims were re-measured here:
    - the six placements are present and unchanged in the reduced text — § Affected Scope carries the
      three directories, the SDK edge, `agent-cli` composing without protocol logic and the
      publish-registry move; TC-24 is the package-local compiler-API single-union instrument; TC-21 is
      the devDependency edge; "admit-then-construct" is stated in § Decision and Solution step 1;
    - the target-graph statement is consistent in all three places it appears (lines 151, 178, 214 — all
      `agent-mcp → agent-core`, `agent-cli → agent-mcp`);
    - the (b) ruling reproduces against code: `mcp-activation.ts:8` declares exactly five sources
      (`managed | user | project | plugin | local`) and `:137-139` is the require-list
      `source === 'project' || source === 'plugin' || source === 'local'`, so inverting it to a
      not-required allowlist of `managed`/`user` changes behaviour for none of the five and denies an
      unrecognised sixth — zero new surface, zero behaviour change, and the fail-open shape is real.
      TC-29's "red today" half also reproduces: `packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts`
      does not exist.
  - **Prior ENDORSEs retained**, both intact in this log: the first reviewer's (three REVISE rounds →
    ENDORSE) and the second reviewer's final ENDORSE on the 30-criterion text.
  - **Structure channel retained** as the additional evidence the criterion asks for when the surface is
    new: `AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=4 medium=5 low=2 coverage=42/42 uncovered=none`.
    **Qualification recorded, not waived:** one of its 42 cells — the cross-family edge
    `dag-node-mcp-tool → agent-mcp` — and its "client-side edge count is exactly one after the DAG
    migration" argument are **moot** under the reduction, since the edge is withdrawn and the second SDK
    client now disappears by deletion in issue #2817 rather than by migration here. The package-level
    cells that carry this unit's placement are untouched by the subtraction: the three intra-package
    directories against the package's own `definition/` + `management/` precedent, the no-`export *`
    public-surface mechanism, the published dependency closure (`agent-mcp`'s only workspace edge is a
    `peerDependency` on the Published `agent-core`), and that removing the 762-line path breaks no
    consumer. A cell that expired with the scope is not placement that went unreviewed; the reduced-text
    ENDORSE covers what remains.

**Observation recorded, not a criterion finding.** Within this unit alone the repository still holds two
official-SDK client stacks: `packages/dag-nodes/mcp-tool` survives until issue #2817 lands. The source
issue's "two independent MCP client stacks cannot remain authoritative" constraint is therefore
discharged across two units by the owner's decision, and no criterion in this document asserts the
repository-wide single-stack end state (TC-11 asserts it only inside `agent-mcp`). Named here so the
next gate reads it as a known split rather than rediscovering it as a gap.

**Paired Task, checked though this gate's criteria do not read it.** The transient state reported at
dispatch has already resolved: `.agents/tasks/MCP-002-…md` carries `status: todo` and its body points at
`.agents/spec-docs/backlog/…`, so the reset's Task half is complete. Its in-flight `DONE-GATE-STAGE-1`
re-encode is GATE-IMPLEMENT's input, not this gate's, and bears on nothing here.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/backlog/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `559963aea6d0c7ab54e37c0f624d95719cd01865` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (27)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1478 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
  "specPath": ".agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-23"
    },
    {
      "kind": "tc-id",
      "value": "TC-24"
    },
    {
      "kind": "tc-id",
      "value": "TC-22"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    },
    {
      "kind": "tc-id",
      "value": "TC-15"
    },
    {
      "kind": "tc-id",
      "value": "TC-16"
    },
    {
      "kind": "tc-id",
      "value": "TC-17"
    },
    {
      "kind": "tc-id",
      "value": "TC-18"
    },
    {
      "kind": "tc-id",
      "value": "TC-19"
    },
    {
      "kind": "tc-id",
      "value": "TC-20"
    },
    {
      "kind": "tc-id",
      "value": "TC-30"
    },
    {
      "kind": "tc-id",
      "value": "TC-29"
    },
    {
      "kind": "tc-id",
      "value": "TC-27"
    },
    {
      "kind": "tc-id",
      "value": "TC-21"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md",
    ".agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9eb7ea8fdb88` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/todo/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `64422a748936` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-initialize.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:10 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-initialize.test.ts (2 tests) 27ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:24:10
   Duration  313ms (transform 40ms, setup 0ms, collect 129ms, tests 27ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c0d0cbd5404d` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-pagination.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:11 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-pagination.test.ts (2 tests) 27ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:24:11
   Duration  313ms (transform 40ms, setup 0ms, collect 130ms, tests 27ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `4dd42c8b0eb1` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-naming.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:12 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-naming.test.ts (14 tests) 3ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  12:24:12
   Duration  183ms (transform 19ms, setup 0ms, collect 23ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `9df9d1fcce81` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-capability.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:13 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-capability.test.ts (6 tests) 2ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:24:13
   Duration  298ms (transform 113ms, setup 0ms, collect 142ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `d4720d6037bd` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-url-admission.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:14 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-url-admission.test.ts (4 tests) 5ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  12:24:14
   Duration  234ms (transform 30ms, setup 0ms, collect 69ms, tests 5ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `6db5fffe3cde` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-22

**Command:** `grep -rn 'StreamableHTTPClientTransport' packages/agent-mcp/src | head -n 3 && ! grep -rnE 'StdioClientTransport|SSEClientTransport|WebSocket' packages/agent-mcp/src --exclude-dir=__tests__`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
packages/agent-mcp/src/client/transport.ts:15:import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
packages/agent-mcp/src/client/transport.ts:88:): StreamableHTTPClientTransport {
packages/agent-mcp/src/client/transport.ts:89:  return new StreamableHTTPClientTransport(admitted.url, {
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `9f1371173840` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:15 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts (5 tests) 2ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  12:24:15
   Duration  292ms (transform 110ms, setup 0ms, collect 138ms, tests 2ms, environment 0ms, prepare 27ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `8de58b19a50e` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts && git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src && test -z "$(git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src)" && echo 'agent-framework/src diff: EMPTY'`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts (14 tests) 4ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  12:24:16
   Duration  313ms (transform 118ms, setup 0ms, collect 153ms, tests 4ms, environment 0ms, prepare 29ms)

agent-framework/src diff: EMPTY
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `f18b15e51093` (modified)

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/connection-supervisor.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:24:16 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/connection-supervisor.test.ts (6 tests) 3ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  12:24:16
   Duration  250ms (transform 33ms, setup 0ms, collect 93ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `26a041f6d0c0` (modified)

### [GATE-COMPLETE: TC-11] — ✅ PASS | 2026-09-22

**Command:** `! grep -rnE 'sendMCPRequest|initializeMCPSession|TMCPConnectionStatus' packages/agent-mcp/src packages/agent-cli/src && echo 'absence: none' && pnpm --filter @robota-sdk/agent-mcp build`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
absence: none

> @robota-sdk/agent-mcp@3.0.0-beta.79 build /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> node ../../scripts/artifacts/build-package.mjs

artifact generation ac4a5d70-f7db-46a6-bdd8-8470d7abb5d7: 5 files
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `091d15c38d5d` (modified)

### [GATE-COMPLETE: TC-12] — ✅ PASS | 2026-09-22

**Command:** `pnpm --filter @robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-mcp build && HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 10 of 300 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c36-c2t-c2u-c2t-c36-c2t-c32-c2r-c2t-c19-c2z-c2x-c32-c2s-c19-c35-c39-c2p-c30-c2x-c2u-c2x-c2t-c2s [finding] scan:reference-kind-qualified
  evidence: Scan reference-kind-qualified exited with status 1.
  recommendation: Inspect the reference-kind-qualified scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

114 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (117 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (reference-kind-qualified, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `0d907c6b5390` (modified)

### [GATE-COMPLETE: TC-10] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:36 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:25:36
   Duration  286ms (transform 35ms, setup 0ms, collect 106ms, tests 2ms, environment 0ms, prepare 37ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c9dfc6c54df4` (modified)

### [GATE-COMPLETE: TC-23] — ✅ PASS | 2026-09-22

**Command:** `pnpm --filter @robota-sdk/agent-mcp typecheck && cp packages/agent-mcp/src/supervisor/connection.ts /tmp/mcp002-conn.bak && node -e "const fs=require('fs');const p='packages/agent-mcp/src/supervisor/connection.ts';const s=fs.readFileSync(p,'utf8');const r=s.replace(/^\s*\|\s*\{\s*readonly kind: 'failed'[\s\S]*?\}\s*$/m,'');if(r===s)throw new Error('failed member not removed');fs.writeFileSync(p,r)" && (pnpm --filter @robota-sdk/agent-mcp typecheck >/dev/null 2>&1; echo "red-proof typecheck exit=$?"); cp /tmp/mcp002-conn.bak packages/agent-mcp/src/supervisor/connection.ts && git diff --quiet -- packages/agent-mcp/src/supervisor/connection.ts || true; pnpm --filter @robota-sdk/agent-mcp typecheck`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
> @robota-sdk/agent-mcp@3.0.0-beta.79 typecheck /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> tsgo --noEmit

red-proof typecheck exit=1

> @robota-sdk/agent-mcp@3.0.0-beta.79 typecheck /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> tsgo --noEmit
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `aa4badfdbfa1` (modified)

### [GATE-COMPLETE: TC-24] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts && printf '%s\n' "export type TMCPSecondConnectionState = { readonly kind: 'idle' } | { readonly kind: 'connected' } | { readonly kind: 'failed' };" > packages/agent-mcp/src/supervisor/zz-red-proof.ts && (pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts >/dev/null 2>&1; echo "red-proof vitest exit=$?"); rm -f packages/agent-mcp/src/supervisor/zz-red-proof.ts; pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts`
**Exit:** 0
**Output:** (last 10 of 22 line(s))

```
12:25:40 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts (1 test) 37ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  12:25:40
   Duration  449ms (transform 14ms, setup 0ms, collect 246ms, tests 37ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `704484e24547` (modified)

### [GATE-COMPLETE: TC-22] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:25:41
   Duration  250ms (transform 32ms, setup 0ms, collect 92ms, tests 2ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2e21ca018e01` (modified)

### [GATE-COMPLETE: TC-13] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/failure-classification.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:42 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/failure-classification.test.ts (8 tests) 3ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  12:25:42
   Duration  262ms (transform 33ms, setup 0ms, collect 96ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2b26c2e60f82` (modified)

### [GATE-COMPLETE: TC-14] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:43 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts (3 tests) 3ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:25:43
   Duration  256ms (transform 34ms, setup 0ms, collect 98ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `b4defbe7984b` (modified)

### [GATE-COMPLETE: TC-15] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/last-known-good.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:43 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/last-known-good.test.ts (2 tests) 3ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:25:43
   Duration  252ms (transform 33ms, setup 0ms, collect 92ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `cb3a00896131` (modified)

### [GATE-COMPLETE: TC-16] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/timeout-semantics.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:44 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/timeout-semantics.test.ts (5 tests) 3ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  12:25:44
   Duration  281ms (transform 37ms, setup 0ms, collect 100ms, tests 3ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2c28775515d1` (modified)

### [GATE-COMPLETE: TC-17] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:45 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts (4 tests) 3ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  12:25:45
   Duration  287ms (transform 36ms, setup 0ms, collect 113ms, tests 3ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `6078be4c24a7` (modified)

### [GATE-COMPLETE: TC-18] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-provenance.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:46 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-provenance.test.ts (5 tests) 3ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  12:25:46
   Duration  308ms (transform 121ms, setup 0ms, collect 148ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `369b5591ffc6` (modified)

### [GATE-COMPLETE: TC-19] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/discovery-bounds.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:47 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/discovery-bounds.test.ts (2 tests) 86ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  12:25:47
   Duration  368ms (transform 39ms, setup 0ms, collect 122ms, tests 86ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2a699b5853c5` (modified)

### [GATE-COMPLETE: TC-20] — ✅ PASS | 2026-09-22

**Command:** `cd packages/agent-mcp && pnpm scenario:verify:mcp-client`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
> @robota-sdk/agent-mcp@3.0.0-beta.79 scenario:verify:mcp-client /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> pnpm exec tsx --conditions=source examples/verify-mcp-client.ts

result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `27dd54859d20` (modified)

### [GATE-COMPLETE: TC-30] — ✅ PASS | 2026-09-22

**Command:** `grep -rn 'narrowToUniversalSubset\|ThirdPartySchemaValidator' packages/agent-mcp/src --include='*.ts' --exclude-dir=__tests__ | grep -vE 'third-party-schema\.ts|src/index\.ts' && pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts`
**Exit:** 0
**Output:** (last 10 of 16 line(s))

```
12:25:49 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts (5 tests) 4ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  12:25:49
   Duration  302ms (transform 113ms, setup 0ms, collect 139ms, tests 4ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `ff58e35f9ff0` (modified)

### [GATE-COMPLETE: TC-29] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:25:50 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts (3 tests) 2ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  12:25:50
   Duration  182ms (transform 18ms, setup 0ms, collect 17ms, tests 2ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `1bbfc1c2cb77` (modified)

### [GATE-COMPLETE: TC-27] — ✅ PASS | 2026-09-22

**Command:** `node -e "const p=require('./packages/agent-mcp/package.json');console.log('private field present:', 'private' in p)" && grep -n '@robota-sdk/agent-mcp' .agents/publish-registry.md && node scripts/harness/scan-publish-registry.mjs`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
private field present: false
34:| `@robota-sdk/agent-mcp`                        | beta    | Shared MCP client owner: definitions, activation, SDK client, catalogs and connection supervision                                                                  |
::examined:: 90 workspace packages
publish-registry scan passed (90 workspace package(s) reconciled against .agents/publish-registry.md).
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c0b0e697e404` (modified)

### [GATE-COMPLETE: TC-21] — ✅ PASS | 2026-09-22

**Command:** `node -e "const p=require('./packages/agent-cli/package.json');console.log('devDependencies:', !!p.devDependencies['@robota-sdk/agent-mcp'], 'dependencies:', !!(p.dependencies||{})['@robota-sdk/agent-mcp'])" && node scripts/harness/check-publish-safety.mjs && ! grep -rnE 'StreamableHTTPClientTransport|tools/list|prompts/list|resources/list' packages/agent-cli/src --exclude-dir=__tests__ && echo 'absence: none'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
devDependencies: true dependencies: false
✅ agent-core has zero @robota-sdk dependencies
✅ agent-core has zero @robota-sdk devDependencies
✅ Checked prepublishOnly hooks on 37 publishable package(s) (43 private package(s) skipped, of 80 in the workspace)
✅ check-pnpm-publish.sh exists
✅ agent-cli publishes self-contained — zero @robota-sdk runtime dependencies (INFRA-028)
✅ No private package SPEC claims npm publication

✅ Publish safety check passed
absence: none
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `f899b8b433fa` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-22

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — No Plan item is blocked or pending (`mechanical`; returned PENDING-GUARDIAN by
  `gate.mjs judge`, judged here): **Found:** the `## Plan` item for TC-21 in
  `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` is ticked
  `[x]`, but its own text records an undelivered part and names what it waits on — "live `bin.ts`
  wiring is deferred — no unit has built the settings pipeline that sources `IMCPResolvedEntry[]`, and
  inventing it here would widen scope." That clause is not in the checkpointed item: `git show HEAD:`
  of the Task (line 76) reads only "`agent-cli` composes the manager; `@robota-sdk/agent-mcp` in
  `devDependencies` (INFRA-028); no protocol logic in `agent-cli/src`"; the deferral was appended to
  the item after the GATE-IMPLEMENT checkpoint, in the same uncommitted edit that ticked it. Measured
  against the tree: `grep -rn mcp-client-composition packages/agent-cli/src --include='*.ts' | grep -v
__tests__` returns NO hit — `packages/agent-cli/src/startup/mcp-client-composition.ts` is imported by
  nothing except its own test; `command-setup.ts:190` and `doctor-inputs.ts:153` forward
  `options.mcpActivationAdapter` but no product code supplies one from this module; the module's own
  header states it "does not yet SOURCE `IMCPResolvedEntry[]`" and waits for "the composition root
  that eventually reads those settings". **Required instead:** the criterion holds only when no Plan
  item is pending or blocked; an item that declares a deferred deliverable and the missing
  prerequisite it waits on is both, whatever its checkbox says. The spec fixes what "composes" means
  here — § Solution step 9: "so the vertical is reachable from a product rather than only from
  tests"; § User Execution Test Scenarios: "`/mcp` gains a supplier" — and on this tree the
  composition is reachable only from `mcp-client-composition.test.ts` and `/mcp` gains no supplier.
  The spec's TC-21 command-level checks (dev-dependency edge, `check-publish-safety.mjs`, protocol
  grep absence) pass and are not disputed; they are GATE-COMPLETE's instrument, and they do not make a
  Plan item that says "deferred" complete.
  **Required action:** either (a) wire the composition into the product start-up path (the
  `bin.ts` / start-cli composition root) so `mcpActivationAdapter` and the discovered tool set are
  supplied from `mcp-client-composition.ts`, sourcing `IMCPResolvedEntry[]` from the settings surface
  MCP-001 already resolves, then tick TC-21 without a deferral clause; or (b) obtain an owner decision
  that the live wiring is outside this unit, record it in the spec (§ Solution step 9 and § User
  Execution Test Scenarios amended; the decision in this Evidence Log) and in the Task as a separate,
  explicitly descoped item naming the successor unit — a Plan item may not narrow its own scope by a
  note appended to a ticked box. Then re-run `node scripts/harness/gate.mjs judge --gate GATE-VERIFY
--doc <spec> --verify-cmd ...`.

Other criteria, recorded so this entry carries the whole run and not only the failure:

- GATE-VERIFY — ordering: the LAST `[GATE-IMPLEMENT]` entry (line 2158) is `✅ PASS | 2026-09-22`,
  `approved → in-progress`, Judged at HEAD `9eb7ea8fdb88`; the earlier `[GATE-IMPLEMENT]` PASS at
  line 1773 is annotated superseded and precedes it, so the last-entry rule reads a PASS. Frontmatter
  `status: in-progress`; document under `.agents/spec-docs/active/`. Ordering PASS. The 27
  `[GATE-COMPLETE: TC-NN]` entries already present were written by `gate.mjs record --tc` (Judged at
  HEAD `d9bb939fe278`), the catalogue's sanctioned per-criterion recording step that GATE-COMPLETE
  later consumes; no GATE-COMPLETE summary judgement and no `verifying` transition has been recorded,
  so they are not a bypass of this gate.
- GATE-VERIFY — Every item in the `## Plan` section is marked complete: 28 checkbox items in the
  Task's `## Plan` section, 28 `[x]`, 0 `[ ]`; `node scripts/harness/scan-task-plan-items.mjs` →
  "::examined:: 345 Task Plan sections — task-plan-items scan passed.", exit 0. Met on its letter; the
  substance of the TC-21 tick is the failed criterion above.
- GATE-VERIFY — Build passes for all affected packages: re-run by the guardian rather than taken from
  the caller — `HARNESS_BASE_REF=origin/integration/agreement-014 pnpm --filter @robota-sdk/agent-mcp
build && pnpm --filter @robota-sdk/agent-cli build` → exit 0 (agent-cli artifact generation
  `09a504e9-…`, 45 files). PASS.
- GATE-VERIFY — Tests pass for all affected packages: re-run by the guardian — `pnpm --filter
@robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-cli exec vitest run
src/startup/__tests__/mcp-client-composition.test.ts` → exit 0; agent-mcp "Test Files 31 passed (31)
  / Tests 184 passed (184)"; agent-cli "Test Files 1 passed (1) / Tests 5 passed (5)". PASS.

**Judged by:** `backlog-gate-guard` (full gate; `gate.mjs judge` exited 2 and, per its PENDING-GUARDIAN rule, wrote no entry)
**Judged at:** HEAD `d9bb939fe2788454a015324b22b132d6ad36711e` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `8c4aeca866dce0233a8d2fae63b94bb152c1b33e` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-initialize.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:31 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-initialize.test.ts (2 tests) 27ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:04:31
   Duration  443ms (transform 138ms, setup 0ms, collect 247ms, tests 27ms, environment 0ms, prepare 38ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `d82aca581880` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-pagination.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:32 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-pagination.test.ts (2 tests) 27ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:04:32
   Duration  420ms (transform 123ms, setup 0ms, collect 231ms, tests 27ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `d44953601c41` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-naming.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:33 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-naming.test.ts (14 tests) 3ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:04:33
   Duration  193ms (transform 20ms, setup 0ms, collect 25ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `f3ef968c7a17` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-capability.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:34 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-capability.test.ts (6 tests) 2ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  13:04:34
   Duration  350ms (transform 131ms, setup 0ms, collect 170ms, tests 2ms, environment 0ms, prepare 39ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `a8748629bf48` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/client-url-admission.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:35 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/client-url-admission.test.ts (4 tests) 6ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  13:04:35
   Duration  357ms (transform 41ms, setup 0ms, collect 90ms, tests 6ms, environment 0ms, prepare 45ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `ab7093244baf` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-22

**Command:** `grep -rn 'StreamableHTTPClientTransport' packages/agent-mcp/src | head -n 3 && ! grep -rnE 'StdioClientTransport|SSEClientTransport|WebSocket' packages/agent-mcp/src --exclude-dir=__tests__`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
packages/agent-mcp/src/client/transport.ts:14:import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
packages/agent-mcp/src/client/transport.ts:88:): StreamableHTTPClientTransport {
packages/agent-mcp/src/client/transport.ts:89:  return new StreamableHTTPClientTransport(admitted.url, {
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2ef6c03411d4` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:36 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-dispositions.test.ts (5 tests) 2ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  13:04:36
   Duration  348ms (transform 126ms, setup 0ms, collect 156ms, tests 2ms, environment 0ms, prepare 36ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `5938dd3f74c4` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts && git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src && test -z "$(git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-framework/src)" && echo 'agent-framework/src diff: EMPTY'`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/dynamic-tool-registration.test.ts (14 tests) 5ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:04:37
   Duration  359ms (transform 124ms, setup 0ms, collect 157ms, tests 5ms, environment 0ms, prepare 34ms)

agent-framework/src diff: EMPTY
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `3bec81e55a86` (modified)

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/connection-supervisor.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:04:38 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/connection-supervisor.test.ts (6 tests) 4ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  13:04:38
   Duration  381ms (transform 117ms, setup 0ms, collect 202ms, tests 4ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `208a56b71f89` (modified)

### [GATE-COMPLETE: TC-11] — ✅ PASS | 2026-09-22

**Command:** `! grep -rnE 'sendMCPRequest|initializeMCPSession|TMCPConnectionStatus' packages/agent-mcp/src packages/agent-cli/src && echo 'absence: none' && pnpm --filter @robota-sdk/agent-mcp build`
**Exit:** 0
**Output:** (last 6 of 6 line(s))

```
absence: none

> @robota-sdk/agent-mcp@3.0.0-beta.79 build /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> node ../../scripts/artifacts/build-package.mjs

artifact generation 2d0537dc-9a5c-4fce-b517-46bb025c025e: 5 files
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `e0a6d4e044a1` (modified)

### [GATE-COMPLETE: TC-12] — ✅ PASS | 2026-09-22

**Command:** `pnpm --filter @robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-mcp build && HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/run-all-scans.mjs --affected --context pr`
**Exit:** 0
**Output:** (last 10 of 300 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c36-c2t-c2u-c2t-c36-c2t-c32-c2r-c2t-c19-c2z-c2x-c32-c2s-c19-c35-c39-c2p-c30-c2x-c2u-c2x-c2t-c2s [finding] scan:reference-kind-qualified
  evidence: Scan reference-kind-qualified exited with status 1.
  recommendation: Inspect the reference-kind-qualified scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

114 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (117 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (reference-kind-qualified, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `a24ae246b824` (modified)

### [GATE-COMPLETE: TC-10] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:00 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/canonical-failed-state.test.ts (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:06:00
   Duration  362ms (transform 117ms, setup 0ms, collect 205ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `b32da67b1ee7` (modified)

### [GATE-COMPLETE: TC-23] — ✅ PASS | 2026-09-22

**Command:** `pnpm --filter @robota-sdk/agent-mcp typecheck && cp packages/agent-mcp/src/supervisor/connection.ts /tmp/mcp002-conn.bak && node -e "const fs=require('fs');const p='packages/agent-mcp/src/supervisor/connection.ts';const s=fs.readFileSync(p,'utf8');const r=s.replace(/^\s*\|\s*\{\s*readonly kind: 'failed'[\s\S]*?\}\s*$/m,'');if(r===s)throw new Error('failed member not removed');fs.writeFileSync(p,r)" && (pnpm --filter @robota-sdk/agent-mcp typecheck >/dev/null 2>&1; echo "red-proof typecheck exit=$?"); cp /tmp/mcp002-conn.bak packages/agent-mcp/src/supervisor/connection.ts && git diff --quiet -- packages/agent-mcp/src/supervisor/connection.ts || true; pnpm --filter @robota-sdk/agent-mcp typecheck`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
> @robota-sdk/agent-mcp@3.0.0-beta.79 typecheck /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> tsgo --noEmit

red-proof typecheck exit=1

> @robota-sdk/agent-mcp@3.0.0-beta.79 typecheck /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> tsgo --noEmit
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `4cb0c6b8961a` (modified)

### [GATE-COMPLETE: TC-24] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts && printf '%s\n' "export type TMCPSecondConnectionState = { readonly kind: 'idle' } | { readonly kind: 'connected' } | { readonly kind: 'failed' };" > packages/agent-mcp/src/supervisor/zz-red-proof.ts && (pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts >/dev/null 2>&1; echo "red-proof vitest exit=$?"); rm -f packages/agent-mcp/src/supervisor/zz-red-proof.ts; pnpm exec vitest run packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts`
**Exit:** 0
**Output:** (last 10 of 22 line(s))

```
1:06:04 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/single-connection-state-union.test.ts (1 test) 37ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  13:06:04
   Duration  451ms (transform 14ms, setup 0ms, collect 246ms, tests 37ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `c16c01252154` (modified)

### [GATE-COMPLETE: TC-22] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:05 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-cache-identity.test.ts (2 tests) 2ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:06:05
   Duration  356ms (transform 121ms, setup 0ms, collect 199ms, tests 2ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `b974f726c6e4` (modified)

### [GATE-COMPLETE: TC-13] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/failure-classification.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:06 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/failure-classification.test.ts (8 tests) 3ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  13:06:06
   Duration  361ms (transform 126ms, setup 0ms, collect 203ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `2010a80b720a` (modified)

### [GATE-COMPLETE: TC-14] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:07 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/reconnect-backoff.test.ts (3 tests) 3ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  13:06:07
   Duration  355ms (transform 118ms, setup 0ms, collect 196ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `125a106c3fd6` (modified)

### [GATE-COMPLETE: TC-15] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/last-known-good.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:08 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/last-known-good.test.ts (2 tests) 3ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:06:08
   Duration  354ms (transform 118ms, setup 0ms, collect 195ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `07578a93045e` (modified)

### [GATE-COMPLETE: TC-16] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/timeout-semantics.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:09 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/timeout-semantics.test.ts (5 tests) 3ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  13:06:09
   Duration  353ms (transform 120ms, setup 0ms, collect 196ms, tests 3ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `e721f3d9c1e7` (modified)

### [GATE-COMPLETE: TC-17] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:10 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/shutdown-no-live-requests.test.ts (4 tests) 3ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  13:06:10
   Duration  358ms (transform 123ms, setup 0ms, collect 200ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `91c9bd8b591f` (modified)

### [GATE-COMPLETE: TC-18] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-provenance.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:11 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-provenance.test.ts (5 tests) 3ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  13:06:11
   Duration  300ms (transform 112ms, setup 0ms, collect 139ms, tests 3ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `ff007b90016d` (modified)

### [GATE-COMPLETE: TC-19] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/discovery-bounds.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:12 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/discovery-bounds.test.ts (2 tests) 86ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Start at  13:06:12
   Duration  471ms (transform 126ms, setup 0ms, collect 225ms, tests 86ms, environment 0ms, prepare 28ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `ae675e54e481` (modified)

### [GATE-COMPLETE: TC-20] — ✅ PASS | 2026-09-22

**Command:** `cd packages/agent-mcp && pnpm scenario:verify:mcp-client`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
> @robota-sdk/agent-mcp@3.0.0-beta.79 scenario:verify:mcp-client /Users/jungyoun/Documents/dev/woojubb/robota-2/packages/agent-mcp
> pnpm exec tsx --conditions=source examples/verify-mcp-client.ts

result=transport=streamable-http; discoveredTools=3; invoked=mock-mcp__echo; catalogSource=mock-mcp
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `5a3cf85f72fa` (modified)

### [GATE-COMPLETE: TC-30] — ✅ PASS | 2026-09-22

**Command:** `grep -rn 'narrowToUniversalSubset\|ThirdPartySchemaValidator' packages/agent-mcp/src --include='*.ts' --exclude-dir=__tests__ | grep -vE 'third-party-schema\.ts|src/index\.ts' && pnpm exec vitest run packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts`
**Exit:** 0
**Output:** (last 10 of 16 line(s))

```
1:06:13 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/catalog-schema-narrowing.test.ts (5 tests) 4ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  13:06:13
   Duration  300ms (transform 108ms, setup 0ms, collect 135ms, tests 4ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `5773275aa8d9` (modified)

### [GATE-COMPLETE: TC-29] — ✅ PASS | 2026-09-22

**Command:** `pnpm exec vitest run packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:06:14 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ packages/agent-mcp/src/__tests__/host-admission-trust-binding.test.ts (3 tests) 2ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  13:06:14
   Duration  180ms (transform 18ms, setup 0ms, collect 17ms, tests 2ms, environment 0ms, prepare 34ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `b6bb860460b4` (modified)

### [GATE-COMPLETE: TC-27] — ✅ PASS | 2026-09-22

**Command:** `node -e "const p=require('./packages/agent-mcp/package.json');console.log('private field present:', 'private' in p)" && grep -n '@robota-sdk/agent-mcp' .agents/publish-registry.md && node scripts/harness/scan-publish-registry.mjs`
**Exit:** 0
**Output:** (last 4 of 4 line(s))

```
private field present: false
34:| `@robota-sdk/agent-mcp`                        | beta    | Shared MCP client owner: definitions, activation, SDK client, catalogs and connection supervision                                                                  |
::examined:: 90 workspace packages
publish-registry scan passed (90 workspace package(s) reconciled against .agents/publish-registry.md).
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `625eb2489629` (modified)

### [GATE-COMPLETE: TC-21] — ✅ PASS | 2026-09-22

**Command:** `node -e "const p=require('./packages/agent-cli/package.json');console.log('devDependencies:', !!p.devDependencies['@robota-sdk/agent-mcp'], 'dependencies:', !!(p.dependencies||{})['@robota-sdk/agent-mcp'])" && node scripts/harness/check-publish-safety.mjs && ! grep -rnE 'StreamableHTTPClientTransport|tools/list|prompts/list|resources/list' packages/agent-cli/src --exclude-dir=__tests__ && echo 'absence: none'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
devDependencies: true dependencies: false
✅ agent-core has zero @robota-sdk dependencies
✅ agent-core has zero @robota-sdk devDependencies
✅ Checked prepublishOnly hooks on 37 publishable package(s) (43 private package(s) skipped, of 80 in the workspace)
✅ check-pnpm-publish.sh exists
✅ agent-cli publishes self-contained — zero @robota-sdk runtime dependencies (INFRA-028)
✅ No private package SPEC claims npm publication

✅ Publish safety check passed
absence: none
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `592cd5d38dc9` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-22

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: the LAST `[GATE-IMPLEMENT]` entry (line 2158) is `✅ PASS | 2026-09-22`, `approved → in-progress`, Judged at HEAD `9eb7ea8fdb88`; frontmatter `status: in-progress`; document under `.agents/spec-docs/active/`. The 54 `[GATE-COMPLETE: TC-NN]` entries present were written by `gate.mjs record --tc` (`backlog-pipeline` skill step 8, "`record` per TC → `judge`"), which precedes this gate by design; no GATE-COMPLETE summary judgement and no `verifying` transition is recorded. Ordering PASS. Re-run after the `❌ FAIL | 2026-09-22` entry at line 2874, whose one failed criterion is re-judged below against the changed tree.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` `## Plan` holds 28 checkbox items, 28 `[x]`, 0 `[ ]` (counted by the guardian; Test Plan and scenario sections not read). `node scripts/harness/scan-task-plan-items.mjs` → "::examined:: 345 Task Plan sections / task-plan-items scan passed.", exit 0. PASS.
- GATE-VERIFY — No Plan item is blocked or pending (returned PENDING-GUARDIAN by `gate.mjs judge`, judged here): the TC-21 item that failed the prior run no longer carries the deferral clause ("live `bin.ts` wiring is deferred — no unit has built the settings pipeline …"); it now records delivered state, and each claim was checked against the tree rather than taken from the text — (a) `packages/agent-cli/src/startup/mcp-definition-sources.ts:20` imports `decodeSource, materializeDefinition, resolveByPrecedence` from `@robota-sdk/agent-mcp` and `resolveMcpDefinitions()` (line 114) reads every `TSettingsSource`, decodes `mcpServers` (line 90-92) and resolves precedence (line 132-133); (b) `mcp-workspace.ts:40` `toMcpActivationWorkspace()` returns `IMCPActivationWorkspace` carrying trust state + generation; (c) `mcp-startup.ts:62` `composeMcpClientForStartup()` calls `createMcpClientComposition` (line 84); (d) `packages/agent-cli/src/cli.ts:63` imports `composeMcpClientForStartup`, line ~219-231 composes it when no caller-supplied adapter exists and assigns `startupOptions.mcpActivationAdapter`, line ~418 pushes `await mcp.connect()` into `toolOptions.additionalTools`, and `mcp.shutdown()` is awaited on all three exit paths (21 inserted lines, `git diff --stat`); `grep -rn mcp-startup packages/agent-cli/src --include='*.ts' | grep -v __tests__` now returns the `cli.ts` import, where the prior run found no product consumer. (e) The item's binary claim was reproduced by the guardian: with `HOME` pointed at a fresh scratch directory holding `.robota/settings.json` = `{"mcpServers":{"probe":{"type":"http","url":"http://127.0.0.1:1/mcp"}}}`, an isolated cwd, and a placeholder `ANTHROPIC_API_KEY`, `node packages/agent-cli/bin/robota.cjs -p "/mcp list"` exited 0 and printed `MCP server "probe" was not admitted (pending): No explicit trust approval exists for this MCP definition.` followed by `probe (probe) — pending — user — …` — the configured server is listed and its pending admission reported, so `/mcp` has a product supplier (§ User Execution Test Scenarios) and the vertical is reachable from a product rather than only from tests (§ Solution step 9); the real `~/.robota/settings.json` was not touched (mtime Sep 21 before and after). The item's closing sentence ("Approval is in-memory in this unit, so a server approved mid-session connects on the next start") describes a property of the delivered behaviour, not an undelivered part of this item nor a prerequisite it waits on: no TC and no Solution step of this spec requires persisted approval (the approval store is MCP-2520/MCP-001's `deps.approvalStore`, passed through unchanged at `mcp-client-composition.ts:286`), so it is not a deferral. The only other Plan match for "pending" is TC-14's state name `pending → failed → manual-retry`, a state-machine label, not a blocked item. No Plan item names a successor unit, a follow-up, or a missing prerequisite. PASS.
- GATE-VERIFY — Build passes for all affected packages: re-run by the guardian — `HARNESS_BASE_REF=origin/integration/agreement-014 pnpm --filter @robota-sdk/agent-mcp build && pnpm --filter @robota-sdk/agent-cli build` → exit 0 (agent-mcp artifact generation `5f1d2f0e-…`, 5 files; agent-cli artifact generation `236f2bcc-…`, 45 files; only `INEFFECTIVE_DYNAMIC_IMPORT` warnings, pre-existing and unrelated). PASS.
- GATE-VERIFY — Tests pass for all affected packages: re-run by the guardian — `pnpm --filter @robota-sdk/agent-mcp test && pnpm --filter @robota-sdk/agent-cli exec vitest run src/startup/__tests__` → exit 0; agent-mcp "Test Files 31 passed (31) / Tests 184 passed (184)"; agent-cli startup "Test Files 26 passed (26) / Tests 158 passed | 3 skipped (161)", including the three new suites `mcp-client-composition.test.ts`, `mcp-definition-sources.test.ts`, `mcp-startup.test.ts`. PASS.

**Judged by:** `backlog-gate-guard` (full gate; `gate.mjs judge` returned PENDING-GUARDIAN on the two Plan criteria and, per its rule, wrote no entry)
**Judged at:** HEAD `d9bb939fe2788454a015324b22b132d6ad36711e` · base `origin/integration/agreement-014@9eb7ea8fdb88fefd502540ef121b944f8e81b8f0` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `078d36b3d98a1831fb4859ce932468eac6612c94` (modified)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-22

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-20: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-20: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-20: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `0656151ed0b7` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-22

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-22; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 27/27 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (27)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (27) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (27) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 27/27 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (27) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 28/28 tasks `[x]` in .agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d9bb939fe278` · base `origin/develop@c8cd7ea65962` · document `.agents/spec-docs/active/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md` blob `54126853ad69` (modified)
