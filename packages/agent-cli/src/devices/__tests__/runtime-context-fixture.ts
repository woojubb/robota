import { join } from 'node:path';

import { createCliRuntimeContext } from '../../product/runtime-context.js';
import { productConfigEntries, resolveProductConfig } from '@robota-sdk/product-config';

import type { ICliRuntimeContext } from '../../product/runtime-context.js';
import type { TConfigEnvironment } from '@robota-sdk/product-config';

/** A temporary, product-neutral runtime for tests; no host paths or credentials are discovered. */
export function createTestRuntimeContext(
  userRoot: string,
  cryptoNamespace = 'test-agent-domain',
): ICliRuntimeContext {
  const defaults = Object.fromEntries(productConfigEntries().map(({ descriptor }) => [
    descriptor.variable,
    descriptor.defaultValue ?? '',
  ])) as TConfigEnvironment;
  const config = resolveProductConfig({
    environment: {
      PRODUCT_ID: 'test-agent',
      PRODUCT_DISPLAY_NAME: 'Test Agent',
      PRODUCT_CLI_NAME: 'test-agent',
      PRODUCT_ENV_PREFIX: 'TEST_AGENT_',
      PRODUCT_PACKAGE_SCOPE: '@test-agent',
      PRODUCT_APP_ID: 'test.agent',
      PRODUCT_PROTOCOL_SCHEME: 'test-agent',
      PRODUCT_TELEMETRY_SERVICE_NAME: 'test-agent',
      PRODUCT_DESKTOP_EXECUTABLE: 'test-agent',
      PRODUCT_MCP_CLIENT_NAME: 'test-agent',
      PRODUCT_MODEL_TOOL_PREFIX: 'test_agent',
      PRODUCT_PROMPT_TAG: 'test-agent',
      PRODUCT_EDITOR_TEMP_PREFIX: 'test-agent',
      PRODUCT_USER_STATE_DIR: userRoot,
      PRODUCT_CACHE_DIR: join(userRoot, 'cache'),
      PRODUCT_LOG_DIR: join(userRoot, 'logs'),
      PRODUCT_PROJECT_STATE_DIR: 'project-state',
      PRODUCT_CRYPTO_NAMESPACE: cryptoNamespace,
      PRODUCT_CREDENTIAL_SERVICE: 'test-credentials',
      PRODUCT_DAEMON_NAMESPACE: 'test-agent',
      PRODUCT_BROWSER_NAMESPACE: 'test-agent',
      PRODUCT_BROWSER_CREDENTIAL_DATABASE: 'test-agent',
      SECURITY_MASTER_KEY_DERIVATION_PATH: '[100,0]',
    },
    defaults,
  });
  return createCliRuntimeContext(config, {
    HOME: userRoot,
    XDG_RUNTIME_DIR: join(userRoot, 'run'),
  });
}
