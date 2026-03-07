# Google Specification

## Scope
- Owns Google AI provider integration for Robota, including Gemini model access and provider-bound request or response adaptation.

## Boundaries
- Does not own generic agent orchestration contracts that belong to `@robota-sdk/agents`.
- Keeps Google-specific transport behavior explicit and provider-scoped.
