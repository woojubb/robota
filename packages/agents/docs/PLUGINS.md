# Plugin Guide

## Scope
- Consolidated plugin behavior and configuration guide for `@robota-sdk/agents`.
- Replaces fragmented plugin behavior/example documents.

## Design Principles
- Automatic behavior must be explicitly configurable.
- Disable options must be clear and deterministic.
- Plugin policy decisions must not be implicit.

## Configuration Directions
- Use explicit strategy/config values for production.
- Prefer minimal enabled plugin sets by use case.
- Validate plugin interactions with runtime tests.
