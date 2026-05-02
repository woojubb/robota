# Google Provider Compatibility Docs

`@robota-sdk/agent-provider-google` remains available as a compatibility wrapper for existing imports and settings that still use the `google` provider profile.

## Current Guidance

- New Gemini API code should use `@robota-sdk/agent-provider-gemini`.
- Existing `GoogleProvider` imports continue to work during migration.
- The canonical provider profile type is `gemini`; `google` remains accepted as an alias.

## Documents

- [Package README](../README.md) — migration guidance.
- [SPEC.md](SPEC.md) — compatibility package contract and migration path.
