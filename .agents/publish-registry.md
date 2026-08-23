# Publish Registry

Parent: [project-structure.md](project-structure.md)

Packages in the **Published Packages** table are published to npm under the `@robota-sdk/` scope.
Every other workspace package must set `"private": true` and MUST NOT be published until explicitly
approved.

**This document is mechanically enforced.** `scripts/harness/scan-publish-registry.mjs` reconciles it
against every workspace manifest on each run of `pnpm harness:scan`. Before INFRA-086 nothing read it,
and it had drifted in both directions at once: thirteen publishable packages were absent, six names in
it were not packages at all, and three appeared in the Private table while shipping publishable — one
of them in both tables. An authorization document with no reader is not a gate.

Last audited: 2026-08-03 (INFRA-086 — reconciled against the manifests and given a floor)

## Published Packages

| Package                                        | npm tag | Notes                                                                                                                                                              |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@robota-sdk/agent-capability-pack`            | beta    | Additive capability-bundle contract (ICapabilityPack) and the pure mergeCapabilityPacks merger for the Robota SDK                                                  |
| `@robota-sdk/agent-cli`                        | beta    | AI coding assistant CLI built on Robota SDK                                                                                                                        |
| `@robota-sdk/agent-command`                    | beta    | Consolidated command module implementations for Robota SDK CLI                                                                                                     |
| `@robota-sdk/agent-core`                       | beta    | Complete AI agent implementation with unified core and tools functionality - conversation management, plugin system, and advanced agent features                   |
| `@robota-sdk/agent-executor`                   | beta    | Composable runtime primitives for Robota background tasks and subagent orchestration                                                                               |
| `@robota-sdk/agent-framework`                  | beta    | Programmatic SDK for building AI agents with Robota — provides InteractiveSession, createQuery(), command APIs, permissions, hooks, and context loading            |
| `@robota-sdk/agent-interface-analytics`        | beta    | Analytics contract interfaces for the Robota SDK — usage snapshots, per-source totals and run-trace timelines                                                      |
| `@robota-sdk/agent-interface-command`          | beta    | Command contract interfaces for the Robota SDK — commands, command results, plugin adapters and capability descriptors                                             |
| `@robota-sdk/agent-interface-execution`        | beta    | Execution contract interfaces for the Robota SDK — background tasks, job groups, subagent jobs and execution workspaces                                            |
| `@robota-sdk/agent-interface-session`          | beta    | Session contract interfaces for the Robota SDK — interactive sessions, interaction channels, session events, turns and persistence                                 |
| `@robota-sdk/agent-interface-session-mobility` | beta    | Session-mobility contract interfaces for the Robota SDK — peer messaging between live sessions and handoff of session authority                                    |
| `@robota-sdk/agent-interface-transport`        | beta    | Transport contract interfaces for the Robota SDK (ITransportAdapter, IConfigurableTransport, ITransportConfig)                                                     |
| `@robota-sdk/agent-interface-tui`              | beta    | TUI interaction contract interfaces for the Robota SDK (ITuiPickerItem, ITuiCommandInteraction, ITuiPickerInteraction, ITuiConfirmInteraction)                     |
| `@robota-sdk/agent-plugin`                     | beta    | Consolidated plugin implementations for Robota SDK                                                                                                                 |
| `@robota-sdk/agent-preset`                     | beta    | Preset contract and resolver for the Robota SDK (IPreset, resolvePreset, listPresets, built-in presets)                                                            |
| `@robota-sdk/agent-process`                    | beta    | Domain-free child-process termination primitives for the Robota SDK — killProcessTree (SIGTERM→grace→SIGKILL, process-group aware)                                 |
| `@robota-sdk/agent-product`                    | beta    | The product-assembly kernel for the Robota SDK: assembleProduct — a pure, IO-free fold over IProductProfile that delegates runtime construction to agent-framework |
| `@robota-sdk/agent-provider-anthropic`         | beta    | Anthropic Claude provider implementation for Robota SDK                                                                                                            |
| `@robota-sdk/agent-provider-bytedance`         | beta    | Bytedance (ModelArk) video generation provider for Robota SDK                                                                                                      |
| `@robota-sdk/agent-builtin-providers`          | beta    | Built-in chat provider definitions and the default role-to-model mapping shipped with the Robota SDK                                                               |
| `@robota-sdk/agent-tool-defaults`              | beta    | Default tool-set aggregator (composition leaf; ARCH-035 moved it out of agent-framework)                                                                           |
| `@robota-sdk/agent-provider-gemini`            | beta    | Google Gemini provider implementation for Robota SDK                                                                                                               |
| `@robota-sdk/agent-provider-openai`            | beta    | OpenAI provider implementation for Robota SDK                                                                                                                      |
| `@robota-sdk/agent-provider-openai-compatible` | beta    | OpenAI-compatible providers (DeepSeek, Qwen, Gemma) for Robota SDK                                                                                                 |
| `@robota-sdk/agent-remote-pairing`             | beta    | Isomorphic pairing + DTLS-fingerprint channel binding for Robota P2P remote-control (REMOTE-001)                                                                   |
| `@robota-sdk/agent-session`                    | beta    | Session and chat management for Robota SDK - multi-session support with independent workspaces                                                                     |
| `@robota-sdk/agent-session-analytics`          | beta    | Session-log timing analysis and reporting for the Robota SDK (analyzeSession, aggregateReports, report formatters)                                                 |
| `@robota-sdk/agent-subagent-runner`            | beta    | Child-process subagent runner for Robota SDK — optional package for running subagents in isolated child processes                                                  |
| `@robota-sdk/agent-tools`                      | beta    | Tool registry and implementations for Robota SDK                                                                                                                   |
| `@robota-sdk/agent-transport`                  | beta    | Core transport package for Robota SDK — headless adapter, scripted-provider testing fixtures, and the transport registry                                           |
| `@robota-sdk/agent-transport-http`             | beta    | HTTP (Hono) transport for the Robota SDK                                                                                                                           |
| `@robota-sdk/agent-transport-mcp`              | beta    | Model Context Protocol (MCP) server transport for the Robota SDK                                                                                                   |
| `@robota-sdk/agent-transport-protocol`         | beta    | Transport-neutral session bridge + wire protocol for the Robota SDK (shared by transport implementations)                                                          |
| `@robota-sdk/agent-transport-tui`              | beta    | Terminal UI (React + Ink) transport for the Robota SDK                                                                                                             |
| `@robota-sdk/agent-transport-webrtc`           | beta    | WebRTC P2P transport for the Robota SDK (data-channel session bridge; REMOTE-001)                                                                                  |
| `@robota-sdk/agent-transport-ws`               | beta    | WebSocket transport and protocol for the Robota SDK                                                                                                                |
| `@robota-sdk/pack-coding`                      | beta    | Robota's coding capability pack — an ICapabilityPack bundling the built-in coding tools, coding command modules, and coding subagents                              |

## Private Packages (must NOT be published)

Deliberate decisions with their reasons. This table is not an inventory — a package is private by
setting `"private": true`, and most private packages need no entry here. An entry records a decision
someone might otherwise reverse by accident.

| Package                                  | Reason                                         |
| ---------------------------------------- | ---------------------------------------------- |
| `@robota-sdk/agent-transport-gui`        | Internal GUI presentation core, not standalone |
| `@robota-sdk/agent-transport-webrtc-web` | Internal browser WebRTC peer, not standalone   |
| `@robota-sdk/agent-playground`           | Development playground app                     |
| `@robota-sdk/agent-remote-client`        | Internal remote client                         |
| `@robota-sdk/agent-tool-mcp`             | Experimental MCP tool adapter                  |

### Three entries this table used to carry, and why they are wrong

`agent-executor`, `agent-interface-transport` and `agent-interface-tui` were listed here as internal
while their manifests shipped them publishable. The dependency graph settles it rather than taste:
each is a runtime dependency of packages this registry authorizes — `agent-interface-transport` of
**fourteen** of them. Marking them private would publish fourteen installs that cannot resolve their
own dependencies. The manifests were right and the table was wrong, and the scan's fourth rule now
makes that decidable instead of a matter of opinion.

## Rules

- Only packages in the **Published Packages** table may be published. Adding one requires explicit
  user approval — and the scan will fail until the table and the manifest agree, in both directions.
- Published packages must have `"private"` absent or `false`, and
  `"publishConfig": { "access": "public" }` (a scoped package defaults to restricted).
- Private packages must have `"private": true`.
- A package this registry marks Private must not be a dependency of any published package.
- Use `pnpm publish:beta` for batch publishing (never `npm publish` or `pnpm -r publish` directly).
- Always run a dry-run (`pnpm publish:beta --dry-run`) before the real publish to verify the list.
