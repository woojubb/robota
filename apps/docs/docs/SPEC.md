# SPEC.md — robota-docs

## Purpose

Owns the Robota SDK documentation site: publishes human- and agent-readable documentation sourced from the monorepo,
with multilingual (en/ko) support and full-text search, statically exported to Cloudflare Pages.

## Contract

- Does not own runtime package contracts; content is sourced from `content/` and `packages/*/docs/`
  at build time, and this app does not define or enforce package APIs — it only renders documentation
  authored by package owners.
- Runs static export only — no agent execution; agent-readable outputs require a configured documentation identity.
