# Repository Architecture Overview

Top-level orientation for package families, product shells, and architecture-map routing.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Package Families

The repository is a TypeScript pnpm monorepo. Detailed package inventory lives in
[../../project-structure.md](../../project-structure.md); package-specific contracts live in each
`packages/<name>/docs/SPEC.md`.

| Family                               | Packages/apps                                                                                                                    | Architecture route                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Agent runtime and CLI                | `agent-core`, `agent-sdk`, `agent-sessions`, `agent-runtime`, `agent-tools`, `agent-command-*`, `agent-cli`, `agent-transport-*` | [agent-system.md](agent-system.md), [agent-cli-composition.md](agent-cli-composition.md)     |
| Agent providers and remote execution | `agent-provider-*`, `agent-remote-client`, `agent-server`                                                                        | [agent-system.md](agent-system.md), [cross-cutting-contracts.md](cross-cutting-contracts.md) |
| Agent playground                     | `agent-playground`, `agent-web`                                                                                                  | [agent-system.md](agent-system.md)                                                           |
| Documentation and publishing         | `apps/docs`, `apps/blog`, `content/`, package docs                                                                               | [apps-and-deployment.md](apps-and-deployment.md)                                             |
| Cross-cutting contracts              | `auth`, `credits`, shared command/provider/session specs                                                                         | [cross-cutting-contracts.md](cross-cutting-contracts.md)                                     |

## Stable Entrypoints

- Repository architecture router: [../ARCHITECTURE-MAP.md](../ARCHITECTURE-MAP.md)
- Architecture map folder index: [README.md](README.md)
- Package inventory and dependency rules: [../../project-structure.md](../../project-structure.md)
- Cross-cutting specs index: [../README.md](../README.md)
