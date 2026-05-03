# @robota-sdk/agent-provider-google

Compatibility package for the renamed `@robota-sdk/agent-provider-gemini`.

New code should import `GeminiProvider` and `createGeminiProviderDefinition()` from `@robota-sdk/agent-provider-gemini`. Existing code that imports `GoogleProvider` from this package continues to work during the migration window.

```ts
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const provider = new GoogleProvider({
  apiKey: process.env.GEMINI_API_KEY ?? '',
  defaultModel: 'gemini-3-flash-preview',
});
```

The provider profile type remains `gemini`; existing settings that use `type: "google"` continue through the provider-definition alias.
All runtime behavior and options are inherited from `@robota-sdk/agent-provider-gemini`, including system instruction mapping, structured output, safety settings, and streaming text callbacks.

## Migration Guidance

- Prefer `@robota-sdk/agent-provider-gemini` for all new code.
- Keep this package only for existing `GoogleProvider` imports during the migration window.
- Use `type: "gemini"` in new provider profiles; `type: "google"` remains accepted as an alias.
