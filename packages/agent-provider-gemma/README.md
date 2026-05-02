# @robota-sdk/agent-provider-gemma

Gemma model-family provider for Robota using OpenAI-compatible local endpoints such as LM Studio.

This provider is separate from Gemini API support. Gemini API behavior belongs to `agent-provider-gemini`; `agent-provider-google` remains only as a compatibility wrapper.

The provider owns Gemma/LM Studio serving-template projection. It filters Gemma reasoning-channel markers from user-visible text and converts documented native tool-call text emitted by the Gemma/LM Studio template into Robota universal `toolCalls` when the referenced tool was declared in the request.

See [docs/SPEC.md](docs/SPEC.md) for the package contract.
