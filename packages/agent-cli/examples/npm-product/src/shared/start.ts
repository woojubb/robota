import { createProductCliHost } from '@robota-sdk/agent-cli/host';

import { createFixtureCommandModule } from './command.js';
import { localProviderDefinitions } from './provider.js';
import { productArtifact, type TFixtureForm, type TFixtureProduct } from './product.js';

/** Reconstruct the same sealed host on every ordinary, daemon or worker process entry. */
export async function runProduct(product: TFixtureProduct, form: TFixtureForm): Promise<void> {
  const host = createProductCliHost(productArtifact(product, form));
  await host.run({
    environment: process.env,
    commandModules: [createFixtureCommandModule(product)],
    providerDefinitions: localProviderDefinitions(product),
  });
}
