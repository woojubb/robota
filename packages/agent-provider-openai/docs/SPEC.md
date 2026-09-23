# SPEC: agent-provider-openai

## Overview

OpenAI provider implementation (`openai` SDK). The OpenAI-compatible protocol base lives in `@robota-sdk/agent-provider-openai-compatible` and is consumed via its `./shared` entry.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Package Identity

- **npm name**: `@robota-sdk/agent-provider-openai`
- **Layer**: Layer 1 — see the package manifest for its dependencies
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

## Diagnostic endpoint (OBSERVABILITY-1991)

The definition declares `endpoint: { host: 'api.openai.com', port: 443 }` — the vendor SDK's embedded
endpoint, stated on the Robota side for the pre-session doctor's TCP reachability check only. It is
deliberately **not** `defaults.baseURL`: that field is runtime-effective (it is persisted into created
profiles and passed to `createProvider`), while `endpoint` is read by no setup, persistence or
provider-construction path. A profile that sets its own `baseURL` is probed at that host instead.

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

## Tool Schema Forwarding, `strictTools`, and Projection (PROV-007 / MCP-005)

MCP-005 moved the schema rewrite OUT of `responses-converter.ts` and INTO the provider's
`projectionProfile()` seam: `OpenAIProvider.projectionProfile()` returns `@robota-sdk/agent-core`'s
`STRICT_TOOL_SCHEMA_PROFILE` (`providerName: 'openai'`) when `strictTools` is on, else
`PERMISSIVE_TOOL_SCHEMA_PROFILE` — the SAME profile choice for both the Responses and Chat Completions
surfaces. `AbstractAIProvider.projectTools()` runs `projectToolSchema()` over every tool BEFORE either
converter (`responses-chat.ts`, `chat-completions-chat.ts`) ever sees it; `convertToOpenAIResponsesTools`
and `convertToOpenAITools` now do no schema transformation of their own — they only shape the
ALREADY-PROJECTED `parameters` into the wire tool definition. `responses-converter.ts` no longer calls
`closeObjectSchemas`; it keeps `strict: strictTools ?? false` on the emitted tool definition, which is a
request-field concern independent of the schema itself.

Under the strict profile the schema is closed exactly as PROV-007 originally specified: OpenAI strict
mode requires **every** object node, nested ones included, to carry `additionalProperties: false` and
to list **all** of its properties in `required`. The universal subset guarantees neither — a Zod-derived
schema emits `additionalProperties: true` for Zod's default `strip` and for `.passthrough()`, a
hand-written one may omit the member, and `required` lists only the genuinely required fields — so
without this rewrite, **every** `createZodFunctionTool` tool would be rejected with the flag on, flat
ones included. `projectToolSchema`'s closure step delegates to agent-core's `closeObjectSchemas` (one
recursion, shared with the Anthropic structured-output seam and the projector itself), and produces
`parameters` byte-identical to the pre-MCP-005 `closeObjectSchemas(input, { requireAllProperties: true,
optionalAsNullable: true })` call for every tool the projector does not reject.

**The lossy part, stated.** Strict mode has no way to express "optional", so a property the schema
marked optional is forced into `required` and compensated with a `null` branch —
`anyOf: [T, { type: 'null' }]`, which is how this subset already spells a nullable value, so a
forced-optional field and a genuinely nullable one are indistinguishable on the wire rather than
inventing a second spelling for one vendor. The model must supply the key, with `null` meaning "not
provided". A handler that distinguishes an absent key from a null value will see the difference.

Because the transformation is lossy it runs **only** when `strict` is actually being sent. With
`strictTools` off or unset, `tool.parameters` is forwarded verbatim (the permissive profile adopts
standard JSON Schema unchanged) — OpenAI accepts the honest schema there, and rewriting it would
change a contract for no reason.

**Quarantine.** A tool `projectToolSchema` rejects (a non-`object` root, a prototype-key property
name, a cycle, or a schema over the shared depth/node ceiling) is omitted from that request alone and
reported once per cache identity as one `tool_schema_quarantined` line on agent-core's global-sink
`ToolSchemaProjection` logger — audible even though this provider may construct with no injected
logger. `examples/verify-tool-schema-projection.ts` (`pnpm scenario:verify:tool-schema-projection`)
demonstrates this end to end over a fake HTTP client.

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
