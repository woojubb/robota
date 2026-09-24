# SPEC: agent-provider-anthropic

## Overview

Anthropic Claude provider implementation, built on the `@anthropic-ai/sdk`.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core` and register it directly.

## Circular Dependency Policy

This package depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where applicable). `agent-framework`, `agent-session`, and all higher-layer packages must never be imported.

Within the package, the shared source-URL/verification-date constants used by both the provider
definition and the capability table have a single owner module, and the definition re-exports them
rather than the capability table depending on the definition — so importing the definition first as
native ESM cannot read an uninitialized value through that path.

## Diagnostic endpoint

The provider definition declares a diagnostic endpoint (the vendor SDK's embedded host/port), stated
on the Robota side purely for the pre-session doctor's TCP reachability check. It is deliberately
**not** the runtime-effective base URL: that field is persisted into created profiles and passed to
provider construction, while the diagnostic endpoint is read by no setup, persistence, or
provider-construction path. A profile that sets its own base URL is probed at that host instead.

## Model Effort

The provider exposes a source-dated effort table only at the vendor endpoint. For a documented model,
a concrete Core effort selection is serialized as a native effort field and merged with an existing
output-format setting; `auto` reports the table default while omitting the native effort field. An
unknown model, or a configured non-default base URL, reports "not applied" and sends no unverified
control. A terminal observer receives exactly one serializable resolution/native-control/dispatch
outcome after success.

## Tool Schema Projection

The provider's schema projection profile is permissive: Anthropic accepts standard JSON Schema with an
`object` root, so no keyword stripping or object closure runs before a tool schema is handed to the
vendor SDK's conversion. A tool whose schema is rejected by projection (a non-`object` root, a
prototype-key property name, a cycle, or a schema over the shared depth/node ceiling) is omitted from
that request alone — every other tool on the turn is unaffected — and is reported once per cache
identity through the shared tool-schema-projection logger. When a call selects `toolChoice: none`,
the provider also omits its configured server-side web search, for both ordinary and streaming
calls, so a server tool cannot still execute when the core passed no local tool schemas.
