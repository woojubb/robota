import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

/**
 * The product's provider registry, in one place for the parent session, the commands that read
 * provider metadata, and the child-process subagent worker, so all of them build the same providers.
 *
 * It is the built-in set plus one product choice: model-native web search is on for a profile that
 * does not mention `nativeWebTools`, on every provider whose definition declares native web search.
 * The SDK building blocks stay neutral — a provider only searches when its profile says so — and this
 * is where the product says so by default. A profile that sets `nativeWebTools` (including
 * `{ "webSearch": false }`) is used as written.
 *
 * Callers must not route this through `startCli({ providerDefinitions })`: a caller-supplied set
 * makes child-process subagents non-reproducible, and this one is the product's own.
 */
export function productProviderDefinitions(): readonly IProviderDefinition[] {
  return createDefaultProviderDefinitions().map((definition) =>
    definition.nativeWebTools?.includes('webSearch') === true
      ? withNativeWebSearchDefault(definition)
      : definition,
  );
}

/** `definition` with `nativeWebTools: { webSearch: true }` filled into profiles that omit the key. */
function withNativeWebSearchDefault(definition: IProviderDefinition): IProviderDefinition {
  return {
    ...definition,
    createProvider: (config) =>
      definition.createProvider(
        config.options?.['nativeWebTools'] === undefined
          ? { ...config, options: { ...config.options, nativeWebTools: { webSearch: true } } }
          : config,
      ),
  };
}
