# Gemini Provider Docs Index

## Scope

- Documentation entry for `@robota-sdk/agent-provider-gemini`, the canonical Google Gemini provider package.

## Current Capabilities

- Modern Gemini transport on `@google/genai`.
- Provider profile type `gemini`.
- Branch-free provider-definition metadata for CLI setup.
- `@robota-sdk/agent-provider-google` remains a compatibility wrapper during migration.
- System messages are mapped to Gemini `config.systemInstruction`.
- Direct chat supports provider `defaultModel`, structured output, safety settings, thinking config, and `onTextDelta` streaming assembly.

## Canonical Documents

- [Package README](../README.md): installation and migration notes.
- `SPEC.md`: Provider scope, ownership boundaries, and canonical responsibilities.

## Notes

- Keep provider-specific details in this package docs.
- Keep shared contract-level rules in `@robota-sdk/agent-core` docs.
