# Architecture Map Index

This folder owns the routed architecture map for the Robota repository. The stable entrypoint is
[../ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md); this folder holds focused subdocuments so humans
and LLM agents can read only the architecture slice relevant to the change.

## Document Tree

| Document                                                 | Use when changing                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [repository-overview.md](repository-overview.md)         | Package/app family placement, top-level map orientation                            |
| [dependency-direction.md](dependency-direction.md)       | Cross-package dependency direction, layer ownership, target ownership rules        |
| [capability-placement.md](capability-placement.md)       | Owner-first placement rules for new product-visible capabilities                   |
| [agent-system.md](agent-system.md)                       | Agent product stack, playground stack, command/provider/runtime boundaries         |
| [agent-cli-composition.md](agent-cli-composition.md)     | Agent CLI architecture router into focused files under `agent-cli/`                |
| [apps-and-deployment.md](apps-and-deployment.md)         | Agent app topology and docs deployment flow                                        |
| [cross-cutting-contracts.md](cross-cutting-contracts.md) | Auth, credits, provider definitions, commands, events, sessions, storage contracts |
| [architecture-lessons.md](architecture-lessons.md)       | Source-backed audit findings, resolved lessons, and update policy                  |

## Update Policy

Content policy for all files in this folder is defined in
[../../rules/documentation-sync.md — Architecture Map Content Policy](../../rules/documentation-sync.md).
The short version:

- Each file owns _relationships_ between layers/elements and the brief contract at each boundary. Nothing more.
- No verbose rationale, narrative paragraphs, or capability inventories — those belong in the owning `SPEC.md`.
- Before removing content, absorb it into the correct target document first.
- Keep [../ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md) as the stable router. Never append subsystem detail there.
- Link to `packages/*/docs/SPEC.md` instead of duplicating package-local contracts.
