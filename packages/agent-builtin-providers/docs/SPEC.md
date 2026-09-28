# SPEC: agent-builtin-providers

## Purpose

Composition leaf that aggregates the built-in provider definitions a host composes: the chat
provider definitions, the media provider definitions (image and video generation), and a default
per-role model map (`DEFAULT_ROLE_MODELS`) — an app-workflow opinion that the neutral role-model
contract in `agent-core` deliberately does not embed. Video generation is a media provider, so the
chat definitions leave it out.

Users who need a provider not included here can implement `IAIProvider` from `@robota-sdk/agent-core`
and register it directly.

## Non-goals / Boundaries

- Depends on `@robota-sdk/agent-core` only among framework packages (plus its one vendor SDK where
  applicable).
- Must never import `agent-framework`, `agent-session`, or any higher-layer package.
