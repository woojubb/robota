# Capability Placement

Repository-wide rules for deciding which package owns a new capability before implementation.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Purpose

Capability placement is the owner-selection step that happens before a feature is implemented. A
feature may be visible in a product shell, but that does not make the product shell the owner of the
behavior. Product shells compose lower-level owner APIs and render product-specific UI.

Use this document when a change adds a new user-visible feature, background activity, command,
provider behavior, transport projection, session behavior, app/server flow, or shared policy.

## Architecture Map vs Design Notes

Mandatory document authority rules live in
[../../rules/spec-workflow.md](../../rules/spec-workflow.md). This section summarizes the split for
architecture placement work.

Architecture-map files record accepted architecture boundaries:

- package ownership;
- dependency direction;
- allowed and forbidden layer relationships;
- update requirements for future changes.

Design and task files record the path to a decision:

- problem statements;
- options and tradeoffs;
- research notes;
- implementation plans;
- deferred decisions and follow-up work.

When a design decision becomes stable, promote only the durable boundary rule into the smallest
relevant architecture-map document. Keep rationale-heavy implementation planning in `.design/`,
`.agents/tasks/`, or `.agents/backlog/`.

## Package SPEC Role

Mandatory SPEC authority rules live in
[../../rules/spec-workflow.md](../../rules/spec-workflow.md). This section summarizes how they apply
after an owner package is selected.

Package `docs/SPEC.md` files are the owner contracts for package-local truth. After the architecture
map identifies the owning package, the owner SPEC defines the concrete contract that consumers and
implementations must follow.

Use package SPEC files for:

- owned responsibilities and explicit non-goals;
- public API and consumer-facing behavior;
- class/interface contract registries when the package exposes or coordinates concrete types;
- lifecycle state, event architecture, error model, persistence shape, or protocol details owned by
  that package;
- package-local dependency boundaries and forbidden ownership;
- verification requirements for package behavior.

Do not copy package-local API details into the repository architecture map. The map says where the
contract lives; the package SPEC says what the contract is.

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
| Playground reusable behavior                            | `agent-playground`, `agent-remote-client`, `agent-sdk`, `agent-core`                  | `agent-web` owns routes and deployment host only.                           |
| Server provider proxy, WebSocket, CORS, process host    | `agent-server` with contracts from provider, remote-client, playground, and SDK specs | Frontend shells call the API; they do not own server-side provider policy.  |
| Documentation build/deploy                              | `apps/docs`, `apps/blog`, Cloudflare deployment docs                                  | Product docs render generated/source content and deploy through owner flow. |

## Owner-First Change Path

1. Name the user-visible capability and list every behavior behind it.
2. Split behavior into UI, reusable contracts, lifecycle/state, policy, persistence, adapters, and
   transport projections.
3. Pick the lowest reusable owner from the table above.
4. Update the owner `docs/SPEC.md` or cross-cutting spec first.
5. Update the relevant architecture-map document for any cross-package boundary or dependency
   direction change.
6. Add product-shell UI only after the owner API/projection exists.
7. Add a backlog item for mechanical guard coverage when the same placement mistake could recur.

## Product Shell Stop Conditions

Stop and move ownership lower when a product shell implementation needs any of these:

- durable task registries, retention policy, log aggregation, or lifecycle state transitions;
- command behavior, command descriptor semantics, or command host-effect contracts;
- provider setup metadata, model catalog logic, vendor request shaping, or vendor response parsing;
- permission policy, auth scope evaluation, credit reservation, or settlement rules;
- persistence formats, session compaction, or transport-visible protocol contracts;
- reusable background grouping, workspace snapshots, or completed-task retention;
- server-side provider secrets or long-running execution ownership in a browser shell.

The shell may still own local process entrypoints, rendering, input handling, ephemeral selection,
and concrete host adapter construction after the reusable owner contract exists.

## Composition-Root Adapter Rule

Product shells may import concrete adapters only as composition roots. That import is allowed when
all of these are true:

- the reusable contract is owned by a lower package;
- the adapter is passed into an owner API instead of becoming product-shell business logic;
- the shell does not persist or reinterpret owner state;
- the shell does not export the adapter contract as a reusable API for other packages.

If an adapter behavior must be reused by another shell, transport, test harness, or service, move the
contract and default implementation below the product shell.
