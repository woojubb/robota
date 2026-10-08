import { join } from 'node:path';

/** Robota's public host composition; explicit product selection remains authoritative. */
export function robotaEnvironment(environment, home, acceptsProfile) {
  if (
    (environment.PRODUCT_ENV_PREFIX !== undefined &&
      environment.PRODUCT_ENV_PREFIX !== 'ROBOTA_') ||
    environment.PRODUCT_CONFIG_FILE !== undefined ||
    (environment.PRODUCT_ID !== undefined && environment.PRODUCT_ID !== 'robota')
  )
    return environment;
  const root =
    environment.PRODUCT_USER_STATE_DIR ??
    environment.ROBOTA_USER_STATE_DIR ??
    join(home, '.robota');
  const defaults = {
    PRODUCT_ID: 'robota',
    PRODUCT_DISPLAY_NAME: 'Robota',
    PRODUCT_CLI_NAME: 'robota',
    PRODUCT_ENV_PREFIX: 'ROBOTA_',
    PRODUCT_PACKAGE_SCOPE: '@robota-sdk',
    PROJECT_REPOSITORY_URL: 'https://github.com/woojubb/robota',
    PROJECT_HOMEPAGE_URL: 'https://robota.io',
    PROJECT_DOCS_URL: 'https://docs.robota.io',
    PRODUCT_APP_ID: 'com.robota-sdk.desktop',
    PRODUCT_PROTOCOL_SCHEME: 'robota',
    PRODUCT_TELEMETRY_SERVICE_NAME: 'robota',
    PRODUCT_DAEMON_NAMESPACE: 'robota',
    PRODUCT_DESKTOP_EXECUTABLE: 'robota',
    PRODUCT_MCP_CLIENT_NAME: 'robota-agent-mcp',
    PRODUCT_MODEL_TOOL_PREFIX: 'robota_command_',
    PRODUCT_PROMPT_TAG: 'robota_file_references',
    PRODUCT_EDITOR_TEMP_PREFIX: 'robota-editor-',
    PRODUCT_USER_STATE_DIR: root,
    PRODUCT_PROJECT_STATE_DIR: '.robota',
    PRODUCT_CACHE_DIR: join(root, 'cache'),
    PRODUCT_LOG_DIR: join(root, 'logs'),
    PRODUCT_BROWSER_NAMESPACE: 'robota',
    PRODUCT_BROWSER_CREDENTIAL_DATABASE: 'robota-credentials',
    PRODUCT_CREDENTIAL_SERVICE: 'robota',
    PRODUCT_CRYPTO_NAMESPACE: 'robota',
    SECURITY_MASTER_KEY_DERIVATION_PATH: '[7240,0]',
    PRODUCT_ARTIFACT_PREFIX: 'robota',
    PROJECT_RELEASE_TAG_PREFIX: 'v',
    PROJECT_RELEASE_BASE_URL: 'https://github.com/woojubb/robota/releases',
    PROJECT_NPM_REGISTRY_URL: 'https://registry.npmjs.org',
    PROJECT_PACKAGE_ACCESS: 'public',
  };
  // Hosts compare the complete canonical profile before allowing these product defaults.
  if (acceptsProfile !== undefined && !acceptsProfile(defaults)) return environment;
  // An explicitly supplied alias belongs to the caller's layer, above host defaults.
  for (const key of Object.keys(defaults)) {
    if (key === 'PRODUCT_ENV_PREFIX') continue;
    const alias = `ROBOTA_${key.replace(/^(?:PRODUCT|PROJECT|SERVICE|SECURITY|DEPLOY)_/u, '')}`;
    if (environment[alias] !== undefined) delete defaults[key];
  }
  const supplied = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
  return { ...defaults, ...supplied };
}
