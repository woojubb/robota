# SPEC: agent-provider-openai

## Overview

OpenAI provider implementation (`openai` SDK). The OpenAI-compatible protocol base lives in `@robota-sdk/agent-provider-openai-compatible` and is consumed via its `./shared` entry.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-openai`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package\'s manifest and enforced by `check-dependency-direction.mjs`; not restated here
- **SDK**: `openai`
- **Platform**: node

## Public API

Every runtime export of the package entry (`src/index.ts`). Provider option/config **types** are also exported (see `src/**/types.ts`); consult the source for the full type surface.

| Symbol                                      |
| ------------------------------------------- |
| `OpenAIProvider`                            |
| `OpenAIConversationAdapter`                 |
| `createOpenAIProviderDefinition`            |
| `DEFAULT_OPENAI_PROVIDER_API_KEY_REFERENCE` |
| `DEFAULT_OPENAI_PROVIDER_MODEL`             |
| `FilePayloadLogger`                         |
| `ConsolePayloadLogger`                      |

`FilePayloadLogger` and `ConsolePayloadLogger` are surfaced via the `./loggers` sub-path entry (`src/openai/loggers/index.ts`).

`FilePayloadLogger` writes prompt/response content to a caller-supplied `logDir`, so it creates that
directory with mode `0700` and each payload file with mode `0600` rather than inheriting the process
umask (SEC-003 / CWE-377). Paths, names, and formats are unchanged.

## Dependencies

| Package                                        | Role                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| `@robota-sdk/agent-core`                       | `IAIProvider`, `IProviderDefinition`, hook types |
| `@robota-sdk/agent-provider-openai-compatible` | OpenAI-compatible protocol base (via `./shared`) |
| `openai`                                       | OpenAI SDK                                       |

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Build Output Contract

```
dist/
└── node/
    └── index.js / index.cjs / index.d.ts   # root export
    └── loggers ...             # sub-path entry
```

## Reasoning Effort (per-call)

The framework threads a per-call selection through `IChatOptions.effort` (`auto` or Core's native
`TModelEffort` vocabulary). This package owns a source-dated exact-model table in
`src/openai/model-effort-table.ts`; its `effortTable()` accessor returns it only for the official
Responses endpoint. `auto` is resolved to the documented model default but omits
`reasoning.effort`; an unknown model, a Chat Completions surface, or a custom base URL is visible
`not-applied` and emits no native control. Each provider's request builder handles it as follows:

| Surface                             | Native effort support | Behavior                                                                                                                                                                           |
| ----------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI Responses                    | Verified-table only   | Resolves the exact model then maps the concrete effort onto `reasoning.effort`. A conflicting static `reasoning.effort` is rejected; unrelated static reasoning properties remain. |
| Chat Completions or custom endpoint | Not verified          | The adapter omits the field and reports `not-applied`; it does not infer support from protocol compatibility.                                                                      |

When a selection resolves to `auto`/model-default or `not-applied`, a static `reasoning.effort` is a
conflict: retaining it would send a native control while reporting that none was sent. The package
throws instead. `examples/verify-model-effort.ts` is typechecked with this package and source-runs
against a Vercel AI Gateway credential supplied through `AI_GATEWAY_API_KEY`; it loads the Git-ignored
repository-root `.env.local` when present, selects `openai/gpt-5` and the Gateway Chat Completions
endpoint itself, then prints `high`, `max`, and `auto` outcomes without emitting the credential. A
custom endpoint has no verified model-effort table, so these transport-only outcomes truthfully report
`not-applied`; this is distinct from the structured-output transport's `unverified-endpoint` provenance.

## Tool Schema Forwarding and `strictTools` (PROV-007)

Tool schemas reach OpenAI unchanged: `convertToOpenAIResponsesTools` forwards `tool.parameters` —
the universal JSON-schema subset owned by agent-core (see its SPEC § Universal JSON-Schema Subset) —
verbatim, and sets `strict: strictTools ?? false`.

Under `strictTools: true` the schema is **rewritten on the way out** (PROV-007). OpenAI strict mode
does not accept an arbitrary JSON Schema: it requires **every** object node, nested ones included, to
carry `additionalProperties: false` and to list **all** of its properties in `required`. The
universal subset guarantees neither — a Zod-derived schema emits `additionalProperties: true` for
Zod's default `strip` and for `.passthrough()`, a hand-written one may omit the member, and
`required` lists only the genuinely required fields — so before this rewrite existed, **every**
`createZodFunctionTool` tool was rejected with the flag on, flat ones included.

The rewrite uses agent-core's `closeObjectSchemas`, the same recursion the Anthropic adapter uses for
its structured-output seam. It is shared rather than duplicated: a walk over this subset that misses
a route leaves exactly the nodes it was written to fix untouched, and a second copy has to be found
and fixed separately.

**The lossy part, stated.** Strict mode has no way to express "optional", so a property the schema
marked optional is forced into `required` and compensated with a `null` branch —
`anyOf: [T, { type: 'null' }]`, which is how this subset already spells a nullable value, so a
forced-optional field and a genuinely nullable one are indistinguishable on the wire rather than
inventing a second spelling for one vendor. The model must supply the key, with `null` meaning "not
provided". A handler that distinguishes an absent key from a null value will see the difference.

Because the transformation is lossy it runs **only** when `strict` is actually being sent. With
`strictTools` off or unset, `tool.parameters` is forwarded verbatim — OpenAI accepts the honest
schema there, and rewriting it would change a contract for no reason.

## Endpoint Provenance (CORE-043)

This package declares **no** `capabilityTable()`. Nobody has verified a per-model capability table
for OpenAI, and inventing one would be a fabricated claim — agent-core's miss policy already handles
the silence correctly (a provider that declares nothing is sent a structured request unchanged;
silence is not a denial).

It does declare `endpointIsVendorDefault()`, which returns `false` whenever `baseURL` is configured.
That is a separate member rather than a field on the capability table precisely so a provider with no
table can still answer it.

It matters more here than anywhere else in the workspace: setting `baseURL` also switches the API
surface to `chat-completions` (`resolveApiSurface`), so the advertised gateway configuration is the
one where whatever is on the far end is least likely to honour a structured-output parameter. Before
CORE-043 the runtime reported early enforcement on it regardless. Now a structured request through a
gateway is reported with `provenance: 'unverified-endpoint'` on the `structured_output_transport`
execution event — the request is still sent the declared way, but nothing claims the endpoint
enforced it.
