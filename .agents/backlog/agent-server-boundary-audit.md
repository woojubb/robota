# Agent Server Boundary Audit

## Status

Backlog.

## Created

2026-05-09

## Priority

P2 - keeps app/server responsibilities explicit as remote execution grows.

## Problem

The architecture map defines `agent-web` as a frontend host and `agent-server` as the provider proxy
and Playground WebSocket service. That boundary is thinner than the CLI boundary and may become a
drift point as browser playground, remote client, provider proxying, auth, and session execution
features expand.

## Recommended Direction

Audit `agent-server`, `agent-web`, `agent-playground`, and `agent-remote-client` together and define
the owner-first path for remote execution capabilities.

Recommended checks:

- provider secrets and vendor calls stay server-side;
- browser UI imports only browser-safe playground/client entries;
- reusable playground execution behavior stays in `agent-playground`;
- remote execution protocol and client behavior stay in `agent-remote-client` or another explicit
  owner package;
- server HTTP/WebSocket routing does not become the owner of provider semantics, session policy, or
  playground UI state.

## Non-Goals

- Do not rewrite server routing without a concrete drift finding.
- Do not move deployment-host concerns out of `agent-web`.
- Do not duplicate provider contracts in server docs.

## Acceptance Criteria

- [ ] Source imports and package manifests confirm the intended app/server boundary.
- [ ] Any drift is recorded with file paths and an owning package recommendation.
- [ ] `agent-server` and `agent-web` specs reflect the final boundary.
- [ ] Architecture-map docs are updated only for cross-package ownership or topology changes.

## Verification Plan

- `pnpm harness:scan`
- Targeted builds/tests for `agent-server`, `agent-web`, `agent-playground`, and
  `agent-remote-client`.
