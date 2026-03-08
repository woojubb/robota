# Anthropic Provider Development Guide

## Scope
- Development conventions for `@robota-sdk/anthropic`.
- Maintain strict provider-boundary behavior and typed public contracts.

## Core Rules
- Keep Anthropic SDK-specific types inside provider implementation.
- Expose public behavior through shared contracts in `@robota-sdk/agents`.
- Keep failure paths explicit and deterministic.

## Verification
- Run build/tests before integration.
- Keep lint/type diagnostics clean for changed files.
