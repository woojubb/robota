# CLI Provider Usage And Cost Visibility

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/cli-provider-usage-visibility
- **Scope**: packages/agent-core, packages/agent-sessions, packages/agent-sdk, packages/agent-cli

## Priority

P0 — trust and safety for paid API providers.

## What

Design and implement provider-neutral usage and cost visibility across Robota CLI so users can see token usage, provider-side tool usage, request counts, latency, and estimated cost close to the action that caused it.

## Why

Robota supports multiple AI providers, and many provider integrations are direct API usage rather than subscription-bundled usage. Users need enough real-time visibility to trust Robota in long-running agentic sessions, background subagents, provider-side web tools, and local/headless workflows without discovering cost problems only after a billing cycle.

Usage must not be hidden in one isolated dashboard. This does not mean the TUI should reserve artificial dedicated areas for usage. It means each output element should expose usage in the place where the user is already looking:

- per assistant turn
- per tool or provider-side built-in tool action
- per background agent/job
- in compact status/activity areas
- in session transcript details
- in resumable session history

## Initial Research Plan

- Review current commercial coding assistant behavior for token, usage, and cost surfaces in terminal UIs and headless modes.
- Review provider documentation for usage metadata returned by Anthropic, OpenAI, Gemini, Qwen, OpenAI-compatible APIs, and local model servers.
- Review how provider-side built-in tools report usage, provenance, and billing dimensions separately from normal model tokens.
- Review common CLI patterns for compact cost/status display, expandable transcripts, and session-level summaries.

## Recommended Direction

- Add a provider-neutral usage contract in the runtime/session layer.
- Provider packages own provider-specific response parsing and must normalize usage into the generic contract.
- CLI TUI owns visual placement only; it must not branch on concrete provider names or model names.
- Session logs must persist raw-enough normalized usage records so `/resume`, debugging, and later reporting can reconstruct usage.
- Estimates must be clearly labeled when exact cost is not available from provider responses.
- Local models should still report local usage dimensions such as prompt tokens, completion tokens, duration, throughput, and context pressure where available, even when monetary cost is zero or unknown.
- Usage state should be updated as the turn runs, not only after the final assistant response. When exact token counts are unavailable until completion, the runtime may expose a clearly labeled live estimate and then replace it with provider-reported exact usage.
- Context occupancy should update when the request payload is assembled and sent, because the sent prompt/context size is known before the model response completes. The status indicator should not wait for the next conversation turn to refresh this value.
- Background agents should publish usage snapshots while running so the background panel can show live context/token/estimated-cost information next to each running job.
- Provider-side built-in tools should publish separate usage/provenance records from local Robota tool calls so users can see when a provider API performed a billable hosted action.

## Candidate Display Surfaces

- **Turn footer**: compact final usage for the completed assistant turn.
- **Streaming assistant row**: live estimated output usage while text is arriving, upgraded to exact usage when available.
- **Tool rows**: provider-side tool usage and local tool runtime cost where available.
- **Background panel**: running/finished agent usage so parallel jobs are auditable, for example per-agent context percentage, live token estimate, elapsed time, and final exact usage.
- **Status bar**: current turn context occupancy and running total in a low-noise form, refreshed when a request is sent rather than only after the turn ends.
- **Transcript detail**: expanded per-request usage, provider-side tool calls, model id, and elapsed time.
- **Session summary**: total session usage by provider/profile/model and background job.

## Live Usage Semantics

- **Exact usage**: Provider-reported token/usage/cost metadata from response bodies, stream usage events, or local model server metrics.
- **Estimated usage**: Runtime-estimated values from known prompt payloads, tokenizer adapters, context calculators, or streamed text length when exact provider data is not available yet.
- **Context occupancy**: Percentage of the effective model context window used by the request payload and accumulated response where measurable. This may use the same calculation strategy as the existing context indicator, but it must refresh during the active turn.
- **Finalization**: Live estimates must be reconciled with exact usage at turn completion. The UI must make the transition clear enough that users do not confuse estimates for provider-reported billing values.

## Ownership Boundaries

- `agent-core` or runtime/session contracts own generic usage types.
- Provider packages own conversion from provider responses to generic usage records.
- `agent-sessions` owns persistence and replay of usage records.
- `agent-cli` owns TUI formatting and status placement.
- Headless transports expose usage records as structured output.

## Non-Goals

- Do not implement provider-specific billing tables in the CLI without a provider-owned pricing source or explicit user configuration.
- Do not add hardcoded provider/model branches to generic CLI or SDK layers.
- Do not rely on assistant prose to report cost or usage.
- Do not block local-model usage when monetary cost is unknown.

## Acceptance Criteria

- [x] Usage metadata is represented by a provider-neutral contract.
- [x] Provider packages can attach normalized usage records to streamed and non-streamed responses.
- [x] Session logs persist usage records for turns.
- [x] CLI TUI shows compact per-turn usage near the relevant output.
- [x] Context occupancy refreshes when a request is sent and again when exact provider usage is available.
- [x] Exact and estimated usage are distinguishable in both structured records and TUI rendering.
- [x] Unknown cost is labeled distinctly from exact provider-reported token usage.
- [x] Tests cover provider-normalized usage, pre-send context refresh, persisted usage summary entries, and TUI rendering.

## Follow-Up Scope

- Background job rows receiving live usage snapshots while an agent is still running remain in the background display/orchestration backlog sequence.
- Provider-side hosted tool usage is represented today through provider metadata where available; richer hosted-tool billing dimensions remain for provider-specific backlog items.
- Session-level total rollups can be built from persisted `usage-summary` entries in a follow-up report command.

## Progress

### 2026-05-02

- Researched provider usage metadata behavior across OpenAI-compatible streaming, Anthropic Messages streaming, Gemini usage metadata, and Qwen/DashScope usage payloads.
- Updated core/session/sdk/cli specs before implementation.
- Implemented provider-neutral exact usage snapshots from normalized provider token metadata.
- Added pre-send context refresh through the session lifecycle so status indicators update before the response completes.
- Added TUI usage summary rendering and persisted `usage-summary` history entries.

## Decisions

- Use existing provider-normalized token fields as exact usage when present.
- Treat pre-send context as estimated runtime usage because provider billing counts are unavailable before completion.
- Keep cost monetary values unknown unless a provider supplies exact or configured pricing data.
- Do not add provider or model name branches in CLI or SDK.

## Blockers

- None for the completed base layer.

## Result

Robota now records exact per-turn provider usage snapshots when provider metadata is available, persists them as timeline entries, renders compact usage rows in the CLI, and refreshes context state at request-send time before final provider usage reconciliation.
