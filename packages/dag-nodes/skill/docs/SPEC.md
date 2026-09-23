# Skill Node Specification

## Purpose

Owns the `skill` DAG node definition. Resolves a Robota skill (by name) to its expanded
inject-mode prompt string, emitted on an output port. It does not run the skill through an LLM —
it produces the prompt a downstream LLM node consumes (`skill -> llm-text -> ...`).

## Non-goals

- **Resolver, not executor.** Inject-mode resolution is pure substitution — no LLM, no provider, no
  session.
- **Fork skills are out of scope.** A skill with `context: 'fork'` requires a subagent LLM loop that
  a pure resolver has no runtime for; the node returns a validation error for such skills instead of
  attempting to run them.
- **No shell execution.** Resolution runs with no shell-exec capability, so shell interpolations in
  a skill body are stripped to empty rather than executed — the resolver never runs arbitrary shell.
- **Node-only.** Skill discovery reads the local filesystem; this package exposes no browser
  build target.
- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node` and does not redefine core DAG
  contracts.

## Contract

- A "skill" is a `SKILL.md` parsed into a command (SSOT owned by
  `@robota-sdk/agent-interface-transport`); discovery and inject-mode resolution are delegated to
  `@robota-sdk/agent-framework`.
- The `args` input port, when a non-empty string, overrides the static config default — callers can
  parameterize a skill invocation per-run without editing the node's config.
- Skill discovery is rooted at the trusted execution root passed in context. A configured working
  directory may only narrow within that root; absolute paths, parent traversal, and symlink escapes
  are rejected rather than silently resolved, so a node config cannot read outside the run's
  sandboxed root.
- Cost estimation defaults to zero credits, since prompt resolution runs no model.

## Boundaries

The DAG subsystem this node belongs to stays private (`private: true`); it is registered only via
the async/optional node-registry path, not eagerly loaded.
