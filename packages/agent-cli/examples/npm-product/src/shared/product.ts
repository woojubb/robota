import { fileURLToPath } from 'node:url';

import { parseEmbeddedProductIdentity } from '@robota-sdk/product-config';

import type { IProductCliArtifact } from '@robota-sdk/agent-cli/host';
import { FIXTURE_PRODUCTS, type TFixtureProduct } from './product-data.js';

export type { TFixtureProduct } from './product-data.js';
export type TFixtureForm = 'node' | 'native';

export function providerUrl(product: TFixtureProduct): string {
  return `http://127.0.0.1:${FIXTURE_PRODUCTS[product].port}/v1`;
}

function productIdentity(product: TFixtureProduct) {
  const selected = FIXTURE_PRODUCTS[product];
  return parseEmbeddedProductIdentity({
    identity: {
      id: product,
      displayName: selected.displayName,
      cliName: product,
      envPrefix: `${product.toUpperCase()}_`,
      packageScope: `@${product}-example`,
      appId: `example.${product}.agent`,
      protocolScheme: product,
      telemetryServiceName: `${product}.agent`,
      daemonNamespace: `${product}.daemon`,
      desktopExecutableName: `${product}-runtime`,
      mcpClientName: `${product}.mcp`,
      modelCommandToolPrefix: `${product}_command_`,
      promptFileReferenceTag: `${product}_references`,
      editorTemporaryDirectoryPrefix: `${product}-editor-`,
    },
    storage: {
      browserNamespace: selected.browserNamespace,
      browserCredentialDatabase: `${product}.credentials`,
    },
    credentials: { serviceNamespace: `${product}.credential` },
    crypto: {
      namespace: `${product}.crypto`,
      masterKeyDerivationPath: selected.derivation,
    },
    release: { artifactPrefix: `${product}-agent` },
  });
}

/** Fixed build data; no invocation environment may choose another product. */
export function productArtifact(product: TFixtureProduct, form: TFixtureForm): IProductCliArtifact {
  const webRoot = form === 'node'
    ? fileURLToPath(new URL(`../../renderer/${product}/`, import.meta.url))
    : undefined;
  return {
    identity: productIdentity(product),
    version: '1.0.0-pre.1',
    sourceVersion: '3.0.0-beta.92',
    buildMetadata: 'npm-product-fixture',
    update: false,
    ...(webRoot ? { webRoot } : {}),
    runtimeDefaults: {
      PRODUCT_USER_STATE_DIR: `${product}/state`,
      PRODUCT_CACHE_DIR: `${product}/cache`,
      PRODUCT_LOG_DIR: `${product}/logs`,
      PRODUCT_PROJECT_STATE_DIR: `.${product}`,
      PRODUCT_SHARED_USER_SETTINGS: '[]',
      PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
    },
  };
}
