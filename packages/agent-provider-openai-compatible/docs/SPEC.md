# OpenAI-Compatible Provider Primitives Specification

## Scope

This package owns reusable OpenAI-compatible Chat Completions transport primitives for Robota provider packages. It provides message conversion, tool schema conversion, Chat Completions response parsing, streaming assembly, and endpoint probing that can be composed by branded or model-family providers.

## Boundaries

- Does not own an end-user provider class. Provider classes belong to packages such as `agent-provider-openai` and `agent-provider-gemma`.
- Does not own OpenAI account semantics, API-key defaults, payload logging products, or OpenAI-branded public compatibility.
- Does not own Gemma-specific reasoning marker or native tool-call text policy. Gemma projection strategies belong to `agent-provider-gemma`.
- Does not own generic agent orchestration, universal message contracts, or executor contracts. Those belong to `agent-core`.
- Does not own concrete provider replay policy. It may provide reusable stream observation helpers, but concrete provider packages choose provider labels, API surface labels, and native payload semantics.

## Architecture Overview

```
src/
  index.ts                 # public exports
  types.ts                 # OpenAI-compatible transport types
  message-converter.ts     # universal message and tool conversion
  response-parser.ts       # Chat Completions response and chunk parsing
  stream-assembler.ts      # streaming chunk assembly with optional injected projection
  native-payload-observer.ts # generic native stream observer for provider-owned replay callbacks
  endpoint-probe.ts        # OpenAI-compatible /models endpoint probe
```

The package is a functional core for provider transport logic. Concrete providers remain the imperative shell that creates SDK clients, handles credentials, logs payloads, and chooses model-family projection behavior.

## Type Ownership

| Type                                            | Location                         | Purpose                                                                             |
| ----------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `IOpenAICompatibleChatRequestParams`            | `src/types.ts`                   | Chat Completions request shape used by provider shells.                             |
| `IOpenAICompatibleStreamRequestParams`          | `src/types.ts`                   | Streaming Chat Completions request shape.                                           |
| `IOpenAICompatibleError`                        | `src/types.ts`                   | Minimal upstream error contract used for message wrapping.                          |
| `IOpenAICompatibleLogData`                      | `src/types.ts`                   | Model-neutral payload log summary contract.                                         |
| `TOpenAICompatibleTextProjector`                | `src/types.ts`                   | Stateful or stateless text projection hook for model-family providers.              |
| `TOpenAICompatibleTextProjectorFlush`           | `src/types.ts`                   | Flush hook for stateful streaming projectors that hold partial marker prefixes.     |
| `IOpenAICompatibleToolCallTextProjection`       | `src/types.ts`                   | Result from an injected provider-owned text-to-tool-call projector.                 |
| `IOpenAICompatibleToolCallTextProjector`        | `src/types.ts`                   | Provider-owned projector that converts known native tool-call text into tool calls. |
| `IOpenAICompatibleStreamAssemblyOptions`        | `src/types.ts`                   | Options for assembling streamed chunks into one universal assistant message.        |
| `IObserveProviderNativeRawPayloadStreamOptions` | `src/native-payload-observer.ts` | Provider-owned labels and callback used to mirror raw stream chunks before parsing. |
| `IOpenAICompatibleModelsResponse`               | `src/endpoint-probe.ts`          | Minimal `/models` response contract used for endpoint probes.                       |
| `TOpenAICompatibleFetch`                        | `src/endpoint-probe.ts`          | Fetch adapter contract for testable OpenAI-compatible endpoint probes.              |

## Public API Surface

| Export                                  | Kind         | Description                                                                                                                 |
| --------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `convertToOpenAICompatibleMessages`     | function     | Converts `TUniversalMessage[]` to OpenAI Chat Completions messages.                                                         |
| `convertToOpenAICompatibleTools`        | function     | Converts Robota `IToolSchema[]` to OpenAI function tools.                                                                   |
| `OpenAICompatibleResponseParser`        | class        | Parses full responses and streaming chunks into `TUniversalMessage`.                                                        |
| `assembleOpenAICompatibleStream`        | function     | Assembles streaming chunks into one assistant message, emits projected text deltas, and exits deterministically on abort.   |
| `observeProviderNativeRawPayloadStream` | function     | Wraps an async stream and calls `IChatOptions.onProviderNativeRawPayload` for every raw chunk before yielding it unchanged. |
| `probeOpenAICompatibleProfile`          | function     | Probes a profile's `/models` endpoint without making concrete provider assumptions.                                         |
| types from `types.ts`                   | type exports | Transport request, logging, error, and projection contracts.                                                                |

## Extension Points

- Providers may pass a `TOpenAICompatibleTextProjector` and optional flush hook into response parsing or stream assembly to transform model-family output before user-facing rendering.
- Providers may pass an `IOpenAICompatibleToolCallTextProjector` when a documented provider-owned serving template emits native tool-call text instead of OpenAI `tool_calls`. The shared package only calls the injected strategy; it must not infer model names, tool names, or prompt directives.
- Providers own client creation and may use any OpenAI-compatible endpoint that the OpenAI SDK can target.
- Providers own payload logging and diagnostic raw-data retention policy.
- Providers may use `observeProviderNativeRawPayloadStream()` to emit ordered `stream_event` replay payloads while keeping the native stream object unchanged for the parser/assembler.
- Provider-native hosted web search/fetch is outside this primitive package. Concrete providers must expose capability reports and explicit unsupported errors when an OpenAI-compatible endpoint only supports chat/function tools.

## Error Taxonomy

| Condition                          | Error pattern                                                    | Source                 |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| Unsupported universal message role | `Unsupported message role: <role>`                               | `message-converter.ts` |
| Missing tool message id            | `Tool message missing toolCallId: <json>`                        | `message-converter.ts` |
| Missing response choice            | `OpenAI-compatible response parsing failed: No choices found...` | `response-parser.ts`   |
| Chunk parsing failure              | `OpenAI-compatible chunk parsing failed: <message>`              | `response-parser.ts`   |

## Test Strategy

- Unit tests cover message conversion for user, assistant, system, tool, and function tools.
- Unit tests cover full response parsing and streaming chunk parsing.
- Unit tests cover stream assembly with text delta callbacks, native tool-call assembly, injected text-tool-call projection, abort handling while awaiting the next chunk, optional projection, and projector flush behavior.
- Unit tests cover endpoint probe skip, success, and HTTP failure behavior.
- Provider packages must add integration tests proving they compose this package without changing their public behavior.
- Provider packages that expose OpenAI-compatible local/proxy endpoints must add tests proving provider-native web search/fetch is either explicitly implemented or explicitly rejected before request execution.

## Class Contract Registry

### Interface Implementations

None. This package exposes pure functions and a parser utility class.

### Inheritance Chains

None. Provider inheritance remains in concrete provider packages.

### Cross-Package Port Consumers

| Port (Owner)                          | Consumer                         | Location                                                                        |
| ------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| `TUniversalMessage` (agent-core)      | converter/parser functions       | `src/message-converter.ts`, `src/response-parser.ts`, `src/stream-assembler.ts` |
| `IToolSchema` (agent-core)            | `convertToOpenAICompatibleTools` | `src/message-converter.ts`                                                      |
| `IProviderProfileConfig` (agent-core) | `probeOpenAICompatibleProfile`   | `src/endpoint-probe.ts`                                                         |
