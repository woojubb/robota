# Capability Placement

Owner-selection rules for new product-visible capabilities.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

Use this document when adding a user-visible feature, background activity, command, provider
behavior, transport projection, session behavior, or shared policy. For spec-first workflow and
document authority rules, see [../../rules/documentation-sync.md](../../rules/documentation-sync.md)
and [../../rules/spec-workflow.md](../../rules/spec-workflow.md).

## Owner Selection Table

| Capability concern                                      | Owner first                                                                           | Product shell responsibility                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Terminal/browser UI, navigation, selection, key binding | `agent-cli`, `agent-web`, `apps/docs`, `apps/blog`                                    | Render owner projections and hold ephemeral UI state only.                  |
| Command behavior, descriptors, host effects             | `agent-command-*` for built-ins; `agent-sdk` for command contracts/common APIs        | Register default command modules and render command UI.                     |
| Background task lifecycle and subagent lifecycle        | `agent-runtime` state machines and runner ports; `agent-sdk` facades/projections      | Provide concrete local adapters and render SDK/runtime projections.         |
| Execution workspace/read model                          | `agent-sdk` + `agent-runtime`                                                         | Keep selected-entry UI state and request reads through SDK APIs.            |
| Session lifecycle, history, compaction                  | `agent-sessions` through `agent-sdk` facades                                          | Display session state and invoke SDK operations.                            |
| Provider definitions, setup metadata, model catalogs    | `agent-provider-*` through `agent-core` contracts                                     | Compose selected providers and display provider/profile state.              |
| Provider transport and vendor SDK behavior              | `agent-provider-*`, `agent-transport-*`, or server-side service packages              | Supply credentials through allowed adapters; never hardcode vendor logic.   |
| Tool contracts, sandbox policy, MCP integration         | `agent-tools`, `agent-tool-mcp`, and `agent-core` contracts                           | Render tool progress/results and pass host adapters.                        |
| Auth and credits policy                                 | `auth`, `credits`, and their package SPEC files                                       | Collect product-specific input and call owner APIs.                         |
| Orchestration policies (cost, auth, retry, routing)     | Orchestrator layer — not the runtime API surface                                      | Call orchestrator APIs; never add policy to the immutable Runtime API.      |
| Playground reusable behavior                            | `agent-playground`, `agent-remote-client`, `agent-sdk`, `agent-core`                  | `agent-web` owns routes and deployment host only.                           |
| Server provider proxy, WebSocket, CORS, process host    | `agent-server` with contracts from provider, remote-client, playground, and SDK specs | Frontend shells call the API; they do not own server-side provider policy.  |
| Documentation build/deploy                              | `apps/docs`, `apps/blog`, Cloudflare deployment docs                                  | Product docs render generated/source content and deploy through owner flow. |

## Stop Conditions

Stop and move ownership lower when a product shell implementation needs any of:

- durable task registries, retention policy, log aggregation, or lifecycle state transitions;
- command behavior, descriptor semantics, or host-effect contracts;
- provider setup metadata, model catalog logic, vendor request shaping, or vendor response parsing;
- permission policy, auth scope evaluation, credit reservation, or settlement rules;
- persistence formats, session compaction, or transport-visible protocol contracts;
- reusable background grouping, workspace snapshots, or completed-task retention;
- server-side provider secrets or long-running execution ownership in a browser shell.

## Composition-Root Adapter Rule

A product shell may import a concrete adapter only when: the reusable contract is owned by a lower
package; the adapter is passed into an owner API rather than becoming shell business logic; the shell
does not persist or reinterpret owner state; the shell does not export the adapter as a reusable API.

If an adapter behavior must be reused by another shell, transport, test harness, or service, move the
contract and default implementation below the product shell.
