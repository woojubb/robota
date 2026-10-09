import type { ICommandModule } from '@robota-sdk/agent-framework';

/**
 * A model may request this read only inventory when it needs the product's fixed fixture labels.
 * It returns the selected label and never reads user files, credentials or host environment.
 */
export function createFixtureCommandModule(product: 'cedar' | 'amber'): ICommandModule {
  const name = `${product}-review`;
  const description = `Show ${product}'s fixed fixture review label. Use it when checking this product's active identity; returns that label without changing state.`;
  const entry = {
    name,
    displayName: `${product} review`,
    description,
    modelDescription: description,
    modelInvocable: true,
    safety: 'read-only' as const,
  };
  return {
    name: `${product}-fixture-commands`,
    commandSources: [{
      name: `${product}-fixture-source`,
      getCommands: () => [{ ...entry, source: product }],
    }],
    systemCommands: [{
      ...entry,
      requiresPermission: false,
      modelRequiresPermission: false,
      userInvocable: true,
      lifecycle: 'inline',
      execute: () => ({ success: true, message: `${product.toUpperCase()} fixture review is ready.` }),
    }],
  };
}
