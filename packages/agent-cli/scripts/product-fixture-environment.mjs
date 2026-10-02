/** Isolated product selection for packaged CLI smoke checks; no operator config or credentials. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { productConfigEntries } from '@robota-sdk/product-config';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const identityPath = join(workspaceRoot, '.product', 'identity.json');
const stageIdentity = existsSync(identityPath)
  ? JSON.parse(readFileSync(identityPath, 'utf8'))
  : undefined;

const fixtureIdentity = {
  identity: {
    id: 'agent-test', displayName: 'Agent Test', cliName: 'agent-test', envPrefix: 'AGENT_TEST_',
    packageScope: '@agent-test-sdk', appId: 'org.example.agent-test', protocolScheme: 'agent-test',
    telemetryServiceName: 'agent-test.agent', daemonNamespace: 'agent-test.daemon',
    desktopExecutableName: 'agent-test-runtime', mcpClientName: 'agent-test-agent',
    modelCommandToolPrefix: 'agent_test_command_', promptFileReferenceTag: 'agent_test_references',
    editorTemporaryDirectoryPrefix: 'agent-test-editor-',
  },
  storage: { browserNamespace: 'agent-test.browser', browserCredentialDatabase: 'agent-test-credentials' },
  credentials: { serviceNamespace: 'org.example.agent-test.credentials' },
  crypto: { namespace: 'agent-test.crypto', masterKeyDerivationPath: [123, 0] },
  release: {},
};

export function selectedFixtureIdentity() {
  return stageIdentity ?? fixtureIdentity;
}

export function syntheticFixtureIdentity() {
  return fixtureIdentity;
}

export function fixtureArtifactPrefix() {
  const identity = selectedFixtureIdentity();
  return stageIdentity ? (identity.release?.artifactPrefix ?? identity.identity.cliName) : 'agent';
}

export function fixtureProductEnvironment(home, extra = {}) {
  return productEnvironment(home, selectedFixtureIdentity(), extra);
}

export function syntheticFixtureProductEnvironment(home, extra = {}) {
  return productEnvironment(home, fixtureIdentity, extra);
}

function productEnvironment(home, identity, extra = {}) {
  const environment = {};
  for (const { section, field, descriptor } of productConfigEntries()) {
    if (descriptor.phase !== 'identity') continue;
    const value = identity[section]?.[field];
    if (value !== undefined) environment[descriptor.variable] = Array.isArray(value) ? JSON.stringify(value) : String(value);
  }
  const userRoot = join(home, identity.storage?.projectDirectory ?? `.${identity.identity.id}`);
  return {
    ...environment,
    PRODUCT_USER_STATE_DIR: userRoot,
    PRODUCT_PROJECT_STATE_DIR: identity.storage?.projectDirectory ?? `.${identity.identity.id}`,
    PRODUCT_CACHE_DIR: join(userRoot, 'cache'),
    PRODUCT_LOG_DIR: join(userRoot, 'logs'),
    HOME: home,
    USERPROFILE: home,
    ...extra,
  };
}

/** Preserve only environment values needed to launch a local executable. */
export function fixtureProcessEnvironment(home, extra = {}) {
  const inherited = {};
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return { ...inherited, ...fixtureProductEnvironment(home, extra) };
}
