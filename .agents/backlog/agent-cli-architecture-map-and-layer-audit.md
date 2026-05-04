# Agent CLI Architecture Map and Layer Audit

## Priority

P1 - architecture clarity and ongoing governance for the CLI beta.

## Problem

The `agent-cli` package is now assembled from many package-level layers: TUI/UI hosting,
built-in command packages, SDK command APIs, provider setup, provider definitions, runtime/session
components, transports, tools, and core agent contracts.

Recent built-in command work showed that package boundaries can drift when CLI, SDK, and command
packages do not have a shared architecture map. Future changes need an LLM-scannable reference that
shows which package/class owns each responsibility and which dependencies are allowed.

## Goal

Create and maintain a complete architecture map for the CLI composition path, then audit whether
the current layering is correctly separated.

The map should be readable by humans and LLMs. Prefer one master document with compact Mermaid
diagrams, package/class relationship tables, and indentation trees. Split into multiple files only
when one file becomes too large to scan, and keep a single master index that links every shard.

## Proposed Architecture Document

Recommended target:

- `packages/agent-cli/docs/ARCHITECTURE-MAP.md`

The document should link to package `SPEC.md` files instead of duplicating their full contracts.
If the existing `packages/agent-cli/docs/ASSEMBLY-ARCHITECTURE.md` is still useful, either fold it
into the new map or make it a focused subdocument linked from the master architecture map.

## Scope

- `packages/agent-cli`
- `packages/agent-sdk` command API and session assembly surfaces used by the CLI
- `packages/agent-command-*` built-in command packages used by the CLI
- provider packages and provider definition contracts used during CLI setup
- runtime/session/transport/tool packages directly needed by CLI execution
- relevant `agent-core` interfaces and classes consumed by the above

## Required Map Sections

1. **Package Dependency Graph**
   - Mermaid graph from CLI entrypoint to command packages, SDK, providers, runtime, sessions,
     transports, tools, and core.
   - Mark allowed dependency directions and forbidden shortcuts.

2. **CLI Composition Tree**
   - LLM-friendly tree from `bin.ts`/`cli.ts` through provider setup, command module registration,
     TUI rendering, non-interactive mode, session creation, and transport execution.
   - Include concrete file/class/function references.

3. **Built-in Command Layer**
   - Diagram command package ownership, SDK command API contracts, host adapter boundaries, and CLI
     UI responsibilities.
   - Explicitly show that built-in command implementation is not CLI/TUI logic and not SDK core
     business logic.

4. **Provider and Model State Flow**
   - Diagram provider setup, effective settings merge, provider definition lookup, active provider
     switching, model catalog lookup, and restart/effect handling.
   - Show where volatile provider model metadata is owned and how it is consumed.

5. **Execution Modes**
   - Interactive TUI flow.
   - Non-interactive `-p` flow, including `--bare`, `--allowed-tools`,
     `--no-session-persistence`, and `--task-file`.

6. **Class/Interface Relationship Inventory**
   - Table or Mermaid class diagram for the main classes/interfaces involved in CLI assembly.
   - Include owner package, responsibility, inbound consumers, outbound dependencies, and whether
     each item is UI, command, SDK API, runtime, provider, transport, or core.

7. **Layering Audit**
   - Check every edge in the map against repository dependency rules and package specs.
   - Identify misplaced responsibilities, hardcoded provider/model assumptions, UI-to-SDK leakage,
     SDK-to-CLI leakage, and command implementations that bypass the built-in command layer.
   - Convert findings into follow-up backlog items when fixes are too large for the audit task.

8. **Architecture Lessons and Governance Updates**
   - Capture lessons learned while building the map and completing the layer audit.
   - Update the relevant repository rule documents when the lesson is a repeatable rule, especially
     `.agents/rules/code-quality.md`, `.agents/rules/process.md`,
     `.agents/rules/common-mistakes.md`, and `.agents/project-structure.md`.
   - Do not duplicate package-specific facts in rules. Rules should describe stable boundary
     principles; package-specific ownership remains in package specs and the architecture map.
   - Add or update mechanical checks when a lesson can be enforced mechanically instead of relying
     only on prose.

## Acceptance Criteria

- [ ] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` exists and is the master architecture map.
- [ ] The map includes Mermaid diagrams and an indentation tree that LLMs can scan without opening
      many source files first.
- [ ] The map covers package relationships and the key class/function/interface relationships used
      to compose `agent-cli`.
- [ ] Built-in command layering is documented as a first-class layer with allowed and forbidden
      dependency edges.
- [ ] Provider/model setup and state flow are documented from settings files through provider
      construction and model command display.
- [ ] Interactive and non-interactive CLI execution flows are documented separately.
- [ ] The audit lists all layering violations or confirms that no violation was found.
- [ ] Any required refactors discovered by the audit are registered as separate backlog items with
      concrete package/file scopes.
- [ ] The package `SPEC.md` or docs index links to the architecture map so future CLI changes update
      it alongside implementation changes.
- [ ] The architecture map defines an ongoing update policy for future CLI composition, built-in
      command, provider setup, and execution-mode changes.
- [ ] Architecture lessons discovered during implementation are added to the appropriate rule
      documents or common-mistakes guidance.
- [ ] Any mechanically enforceable lesson is backed by a harness check or a concrete follow-up
      backlog item for adding one.

## Verification Plan

- Read package specs before drawing the map: `packages/agent-cli/docs/SPEC.md`,
  `packages/agent-sdk/docs/SPEC.md`, relevant `packages/agent-command-*/docs/SPEC.md`, and
  `packages/agent-core/docs/SPEC.md`.
- Build the initial graph from source imports using `rg`, package manifests, and command
  registration code.
- Cross-check the diagram against actual source files rather than inferred package names.
- Run focused docs/spell/markdown checks if available.
- Run relevant targeted tests only if the audit results in code changes.

## Notes

- This is documentation and architecture governance first, not a refactor task.
- Prefer a single master map. If sharding is needed, keep shard names stable and include a compact
  table of contents in the master file.
- The document should be updated whenever CLI composition, built-in command contracts, provider
  setup, or execution mode ownership changes.
- Architecture lessons should be promoted into repository rules only when they are stable and
  reusable across future work. One-off package facts belong in the architecture map or package specs.
