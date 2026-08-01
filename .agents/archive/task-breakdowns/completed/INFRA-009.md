# INFRA-009 Tasks — Fix undeclared/incorrect mermaid nodes in architecture diagrams

Spec: `.agents/spec-docs/todo/INFRA-009-fix-mermaid-undeclared-nodes.md`

## Tasks

- [x] TC-01: Make every mermaid edge endpoint resolve to a declared node in both
      `.agents/specs/architecture-map/dependency-direction.md` and
      `.agents/specs/architecture-map/agent-system.md`. Declare a `TypeContracts` node
      (`agent-interface-transport`, `agent-interface-tui`), a `Playground` node (`agent-playground`),
      and `IfaceTransport`/`IfaceTui` nodes so that `ProductShells --> Playground`,
      `Assembly --> TypeContracts`, `TransportShells --> TypeContracts`,
      `IfaceTransport`/`IfaceTui` edges all reference declared ids.
- [x] TC-02: Remove the phantom token `agent-team` from both diagrams, and remove the false
      `IfaceTransport --> Core` / `IfaceTui --> Core` (and any `--> agent-core`) edges since the
      interface-contract packages are zero-dependency. Mark `auth`/`credits` with a planned marker.
- [x] TC-03: Run `pnpm harness:scan` and confirm it exits 0 (including the conformance scan).

## Test Plan

Verification is mechanical and command-driven for all three criteria:

- TC-01: node/`rg` script extracts declared node ids and edge endpoints from each mermaid block;
  assert the endpoint set is a subset of the declared-node set (zero undeclared endpoints).
- TC-02: `rg` grep assertions over the two files confirm no `agent-team` token remains and no
  `Iface* --> Core` / `--> agent-core` edge exists for the interface-contract packages.
- TC-03: `pnpm harness:scan` exits 0 (doc-only change; conformance scan included).
