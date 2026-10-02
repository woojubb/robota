import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { embeddedProductIdentity, productConfigEntries, resolveProductConfig } from '../../../packages/product-config/dist/index.js';

const fixtureIdentityEnvironment = {
  PRODUCT_ID: 'desktop-fixture',
  PRODUCT_DISPLAY_NAME: 'Desktop Fixture',
  PRODUCT_CLI_NAME: 'desktop-fixture',
  PRODUCT_ENV_PREFIX: 'DESKTOP_FIXTURE_',
  PRODUCT_PACKAGE_SCOPE: '@desktop-fixture',
  PRODUCT_APP_ID: 'org.example.desktop-fixture',
  PRODUCT_PROTOCOL_SCHEME: 'desktop-fixture',
  PRODUCT_TELEMETRY_SERVICE_NAME: 'desktop-fixture.telemetry',
  PRODUCT_DAEMON_NAMESPACE: 'desktop-fixture.daemon',
  PRODUCT_DESKTOP_EXECUTABLE: 'desktop-fixture-runtime',
  PRODUCT_MCP_CLIENT_NAME: 'desktop-fixture-agent',
  PRODUCT_MODEL_TOOL_PREFIX: 'desktop_fixture_command_',
  PRODUCT_PROMPT_TAG: 'desktop_fixture_references',
  PRODUCT_EDITOR_TEMP_PREFIX: 'desktop-fixture-editor-',
};

/** Build a complete isolated host environment without inheriting developer credentials or product config. */
export function buildProductTestEnvironment(stateRoot, embeddedIdentity) {
  const environment = {
    ...fixtureIdentityEnvironment,
    PRODUCT_USER_STATE_DIR: join(stateRoot, 'user'),
    PRODUCT_PROJECT_STATE_DIR: '.desktop-fixture',
    PRODUCT_CACHE_DIR: join(stateRoot, 'cache'),
    PRODUCT_LOG_DIR: join(stateRoot, 'logs'),
    PRODUCT_BROWSER_NAMESPACE: 'desktop-fixture.browser',
    PRODUCT_BROWSER_CREDENTIAL_DATABASE: 'desktop-fixture-browser-credentials',
    PRODUCT_CREDENTIAL_SERVICE: 'org.example.desktop-fixture.credentials',
    PRODUCT_CRYPTO_NAMESPACE: 'desktop-fixture.crypto',
    SECURITY_MASTER_KEY_DERIVATION_PATH: '[123,0]',
  };

  if (embeddedIdentity !== undefined) {
    for (const { section, field, descriptor } of productConfigEntries()) {
      if (descriptor.phase !== 'identity') continue;
      const value = embeddedIdentity[section]?.[field];
      environment[descriptor.variable] = Array.isArray(value) ? JSON.stringify(value) : value ?? '';
    }
  }

  const config = resolveProductConfig({ environment, ...(embeddedIdentity ? { embeddedIdentity } : {}) });
  return { environment, identity: embeddedIdentity ?? embeddedProductIdentity(config) };
}

export function readDesktopTestIdentity(moduleDirectory) {
  const identityPath = join(moduleDirectory, 'product-identity.json');
  if (!existsSync(identityPath)) return undefined;
  return JSON.parse(readFileSync(identityPath, 'utf8'));
}
