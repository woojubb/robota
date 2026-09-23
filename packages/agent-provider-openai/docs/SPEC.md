# SPEC: agent-provider-openai

## Overview

OpenAI provider implementation (`openai` SDK). The OpenAI-compatible protocol base lives in `@robota-sdk/agent-provider-openai-compatible` and is consumed via its `./shared` entry.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Non-goals / Boundaries

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

## Design Decisions

### Diagnostic endpoint vs. runtime base URL

The provider definition states the vendor SDK's default endpoint host/port on the Robota side purely for the pre-session doctor's TCP reachability check. This is deliberately kept separate from the runtime-effective base URL (the one persisted into profiles and passed to provider construction): a profile that sets its own base URL is probed at that host instead, not the vendor default.

### Reasoning effort is verified per-model, not assumed

The framework threads a per-call reasoning-effort selection through chat options. This package owns a source-dated exact-model table and applies native effort control only for the official Responses endpoint against a verified model. `auto` resolves to the documented model default but omits the native effort field entirely. An unknown model, a Chat Completions surface, or a custom base URL is reported `not-applied` and emits no native control — support is never inferred from protocol compatibility alone.

When a selection resolves to `auto`/model-default or `not-applied`, a statically-set native effort field is treated as a conflict and rejected: silently keeping it would send a native control while reporting that none was sent.

### Tool schema closure runs at the projection seam, not in the converters

Schema rewriting for OpenAI's strict tool mode happens in the provider's projection-profile seam (shared with agent-core's schema projector), not inside the Responses/Chat Completions request converters. The converters only shape an already-projected schema into the wire tool definition.

**Why:** OpenAI strict mode requires every object node (nested included) to carry `additionalProperties: false` and list all its properties in `required`. A Zod-derived schema does not guarantee either by default, so without a closure step, most Zod-defined tools would be rejected once strict mode is enabled.

**The lossy part, stated as a contract guarantee:** strict mode cannot express "optional", so an optional property is forced into `required` and compensated with a nullable union. A forced-optional field and a genuinely nullable one are therefore indistinguishable on the wire — this is a known, accepted limitation, not a bug. The model must supply the key; `null` means "not provided". A handler that needs to distinguish an absent key from an explicit null cannot rely on this provider to preserve that distinction.

Because the rewrite is lossy, it only runs when strict mode is actually being sent; with strict tools off, tool parameter schemas are forwarded verbatim.

A tool schema the projector rejects (non-object root, a prototype-key property name, a cycle, or a schema exceeding the shared depth/node ceiling) is dropped from that request alone rather than failing the whole call, and is logged once per cache identity so the omission is auditable.

### No fabricated capability table

This package declares no per-model capability table for OpenAI, since none has been verified — inventing one would be a fabricated claim. The framework's miss policy already handles this silence correctly: a provider that declares nothing is sent a structured request unchanged.

It does declare whether the configured endpoint is the vendor default, as a boolean rather than a capability-table field, so a provider with no table can still answer that question. This matters because setting a custom base URL also switches the API surface to Chat Completions, which is the surface least likely to honor a structured-output parameter; a structured request through such a gateway is reported with an "unverified endpoint" provenance rather than being claimed as enforced.

### Log file permissions

The file-based payload logger writes prompt/response content to a caller-supplied log directory. It creates that directory and each payload file with owner-only permissions rather than inheriting the process umask, since these payloads may contain sensitive request/response content.
