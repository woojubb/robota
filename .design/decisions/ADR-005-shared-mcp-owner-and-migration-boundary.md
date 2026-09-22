# ADR-005: Select the shared MCP owner and migration boundary

## Status

accepted

## Context

Robota's MCP client direction has no reachable canonical definition owner. The private
`@robota-sdk/agent-tool-mcp` package owns an HTTP-only tool config plus activation policy but has no
deployable product consumer. `@robota-sdk/agent-core` separately exports an incompatible, unused
`IMCPToolConfig` and MCP factory method with no production caller. The playground contains an unreferenced,
`null`-returning same-named stub, but its class neither declares nor structurally satisfies `IToolFactory`;
it is a stale surface rather than a consumer. Framework settings and plugin sources expose generic/raw
values, the existing `/mcp` command sees only activation decisions, and the CLI composes no concrete
definition registry. AGREEMENT-014 moved GitHub work into Tasks but explicitly made no product, package,
API, or dependency decision.

The existing `dag-node-mcp-tool` separately imports the official MCP SDK, constructs HTTP/stdio
transports and a `Client`, connects, calls tools, and closes the client. Issue #1985 classifies that code
as a precedent and requires DAG and agent products to become sibling consumers of one shared lower seam;
leaving it authoritative would preserve a second client owner after the rename.

MCP-001 through MCP-005 need one durable owner before configuration, SDK client, supervision, background
handoff, and provider projection evolve independently. The owner must remain below framework/command/CLI,
must not leak a private package through public framework declarations, and must keep definition inspection
separate from process/network activation.

## Alternatives Considered

1. **Make `agent-framework` the MCP definition and client owner.**
   - Pros: it already owns settings, plugin, workspace-authority, and command-host adapters.
   - Cons: protocol policy moves into generic assembly and lower clients cannot consume it without a
     reverse dependency.
2. **Create a new MCP configuration package beside `agent-tool-mcp`.**
   - Pros: clean initial module layout and no immediate rename.
   - Cons: activation and configuration retain separate owners, requiring a facade or duplicate identity
     contracts before the client work even begins.
3. **Rename/reclassify private `agent-tool-mcp` to private `agent-mcp` in MCP-001 and grow that one owner
   through MCP-005.**
   - Pros: reuses the only MCP client-side implementation and activation tests, creates one dependency-safe
     owner immediately, and defers publication until an official-SDK vertical slice exists.
   - Cons: MCP-001 carries an atomic package rename and an explicitly approved breaking cleanup in addition
     to the new configuration control plane.
4. **Add canonical definitions to `agent-tool-mcp` now and defer rename/cleanup to MCP-002.**
   - Pros: smallest MCP-001 file-movement diff.
   - Cons: deliberately lands a foundational contract in a misclassified package beside a second exported
     owner, invalidating the checkpoint that later work is meant to trust.

## Decision

Choose alternative 3.

MCP-001 atomically renames the private package and npm identity to `@robota-sdk/agent-mcp`. That package
is the sole owner of MCP server definitions and their raw/validated/resolved forms, source provenance and
shadow metadata, strict foreign decoding, environment-template materialization, redacted management
projections, reversible disable overlays, activation identity/fingerprints, and pure management results.
It also absorbs/migrates the current activation request and registry types so an MCP definition has one
transport-neutral identity; an HTTP endpoint is not required for stdio.

MCP-001 removes `agent-core.IMCPToolConfig` and `IToolFactory.createMCPTool()` after direct owner approval.
They have no production caller and no compatibility facade is retained. The unreferenced playground stub
is removed or replaced in the same child rather than preserved as an apparent second MCP creation surface.
The lower dependency remains `agent-mcp → agent-core`.

`agent-framework` keeps generic settings, plugin, workspace-authority, mutation, and command-host ports.
It does not import/re-export the still-private package; its command-facing MCP result DTOs are secret-free
structural projections, not a second definition contract. `agent-command` extends the existing `/mcp`
module against those ports. `agent-cli` imports the lower owner at the product composition root, feeds it
generic source/store/plugin inputs, and renders returned projections.

MCP-002 owns publication of `agent-mcp`, official MCP TypeScript SDK integration, supported remote
transport support, discovery/bootstrap, connection lifecycle, and the first product-reachable HTTP
vertical slice. It also migrates the DAG node's direct SDK `Client` and Streamable HTTP mechanics into
`agent-mcp`; `dag-node-mcp-tool` retains only DAG-specific configuration mapping, validation/error
projection, and node result mapping and depends on the shared lower seam. MCP-002 removes the current
DAG-local stdio spawn path and returns an explicit unsupported-pending-MCP-2522 result before any transport
or process is created. MCP-2522 alone adds the admitted shared `StdioClientTransport` adapter and restores
DAG stdio execution. The target graph is `agent-mcp → agent-core`, `agent-cli → agent-mcp`, and
`dag-node-mcp-tool → agent-mcp`. The opposite-direction `agent-transport-mcp` server adapter remains
independent. MCP-003 adds capability-catalogue supervision, MCP-004 integrates long-running calls with the
background-task owner, and MCP-005 integrates provider-safe schema projection. Those children consume or
extend the same package without moving background or provider policy into it.

**Amendment, 2026-09-22 (owner decision, verbatim: `MCP-002에서 분리, 별도 제거 유닛`).** The DAG is
delivered as a command (`agent-cli` `/workflows` via `agent-command-workflows`), not in MCP form, and the
command-form DAG references neither `dag-node-mcp-tool` nor the DAG-as-MCP-server surfaces. Measured on
that date: zero references to the node in `agent-command-workflows`, `dag-nodes-default`, `dag-builder`
and `dag-framework`; the node is absent from the product's default catalog; `dag-mcp-server` has no
consumer; `dag-cli` is private with no consumer but itself. Therefore:

- MCP-002 **no longer** migrates `dag-node-mcp-tool` onto the shared seam and **no longer** returns an
  unsupported-pending-MCP-2522 result for DAG stdio. Both sentences above are withdrawn for MCP-002.
- The node, `dag-mcp-server` and `dag-cli/src/mcp` are **removed** by `MCP-2817`
  ([issue #2817](https://github.com/woojubb/robota/issues/2817)). `MCP-2816` (issue #2816), which would
  have wired the node into `/workflows`, is superseded by that removal.
- The target graph is `agent-mcp → agent-core` and `agent-cli → agent-mcp`. The edge
  `dag-node-mcp-tool → agent-mcp` is withdrawn with the node.
- MCP-2522 still adds the admitted shared `StdioClientTransport` adapter for the agent line; "restores
  DAG stdio execution" is moot.

The original text above is kept so the record shows what was decided and later withdrawn.

## Consequences

- MCP-001 has a larger mechanical change, but no interim branch contains a new canonical contract under a
  known-wrong package name or beside a competing core contract.
- Framework, command, and CLI stay acyclic: adapters and presentation depend inward; the lower MCP owner
  never imports them.
- MCP definition inspection can be proven side-effect-free independently from later SDK transport code.
- Removing an exported prerelease `agent-core` contract is intentionally breaking; direct owner approval
  was received on 2026-09-21, and MCP-001 must still provide the required SPEC/changelog treatment.
- `agent-mcp` remains private until MCP-002 proves and publishes the official-SDK vertical slice.
- ~~MCP-002 has a larger migration because it removes the DAG node's direct official-SDK ownership, but
  the DAG product remains independently testable through a thin node-specific adapter over the shared
  seam.~~ Withdrawn 2026-09-22: the node is removed by MCP-2817 (see the Decision amendment).
- ~~DAG stdio is intentionally unavailable between the MCP-002 and MCP-2522 integration checkpoints; this
  fails closed instead of publishing an unaudited subprocess path, and the outer integration cannot land
  on `develop` until MCP-2522 restores and verifies it.~~ Withdrawn 2026-09-22 with the node; the outer
  integration no longer waits on MCP-2522 for a DAG path.
- AGREEMENT-014 remains the sole administrative relationship owner for MCP-001 through MCP-005;
  ARCH-1985 owns this product architecture prerequisite without replacing that history.

## References

- [Issue #1985](https://github.com/woojubb/robota/issues/1985)
- [Issue #2521](https://github.com/woojubb/robota/issues/2521)
- [Issue #2522](https://github.com/woojubb/robota/issues/2522)
- [Issue #2817](https://github.com/woojubb/robota/issues/2817) — removal of the DAG↔MCP surfaces (amendment of 2026-09-22)
- [Issue #2816](https://github.com/woojubb/robota/issues/2816) — superseded by issue #2817
- [Foundational re-plan record](https://github.com/woojubb/robota/issues/1985#issuecomment-5754525322)
- `.agents/spec-docs/active/ARCH-1985-select-the-shared-mcp-ownership-and-migration-contract-before-mcp-001.md`
- `.agents/spec-docs/active/AGREEMENT-014-coordinate-the-mcp-client-control-plane-migration.md`
- `.agents/spec-docs/done/AGREEMENT-2520-coordinate-mcp-activation-trust-and-admission-contract.md`
- [MCP architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture)
- [MCP TypeScript SDK client connection guide](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)
