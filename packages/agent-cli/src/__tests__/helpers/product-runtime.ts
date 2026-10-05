import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProductConfig } from '@robota-sdk/product-config';
import { createCliRuntimeContext } from '../../product/runtime-context.js';

import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type { ICliRuntimeContext } from '../../product/runtime-context.js';

const temporaryRoots: string[] = [];
export function cleanupTestProductRuntimes(): void {
  temporaryRoots.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
}

/** Synthetic identity and isolated roots; never loads the operator's environment or state. */
export function createTestProductEnvironment(label = 'test-product'): Record<string, string> {
  return {
    PRODUCT_ID: label,
    PRODUCT_DISPLAY_NAME: `${label} Agent`,
    PRODUCT_CLI_NAME: label,
    PRODUCT_ENV_PREFIX: `${label.replaceAll('-', '_').toUpperCase()}_`,
    PRODUCT_PACKAGE_SCOPE: `@${label}-sdk`,
    PRODUCT_APP_ID: `org.example.${label}`,
    PRODUCT_PROTOCOL_SCHEME: label,
    PRODUCT_TELEMETRY_SERVICE_NAME: `${label}.agent`,
    PRODUCT_DAEMON_NAMESPACE: `${label}.daemon`,
    PRODUCT_DESKTOP_EXECUTABLE: `${label}-runtime`,
    PRODUCT_MCP_CLIENT_NAME: `${label}-agent`,
    PRODUCT_MODEL_TOOL_PREFIX: `${label.replaceAll('-', '_')}_command_`,
    PRODUCT_PROMPT_TAG: `${label.replaceAll('-', '_')}_references`,
    PRODUCT_EDITOR_TEMP_PREFIX: `${label}-editor-`,
    PRODUCT_USER_STATE_DIR: `/tmp/${label}/user`,
    PRODUCT_PROJECT_STATE_DIR: `.${label}`,
    PRODUCT_CACHE_DIR: `/tmp/${label}/cache`,
    PRODUCT_LOG_DIR: `/tmp/${label}/logs`,
    PRODUCT_BROWSER_NAMESPACE: `${label}.browser`,
    PRODUCT_BROWSER_CREDENTIAL_DATABASE: `${label}-credentials`,
    PRODUCT_CREDENTIAL_SERVICE: `org.example.${label}.credentials`,
    PRODUCT_CRYPTO_NAMESPACE: `${label}.crypto`,
    SECURITY_MASTER_KEY_DERIVATION_PATH: '[123,0]',
  };
}

export function createTestProductRuntime(label = 'test-product', overrides: TConfigEnvironment = {}): ICliRuntimeContext {
  const home = overrides.HOME ?? overrides.USERPROFILE ?? mkdtempSync(join(tmpdir(), 'agent-product-test-'));
  if (overrides.HOME === undefined && overrides.USERPROFILE === undefined) temporaryRoots.push(home);
  const root = join(home, `.${label}`);
  const environment = { ...createTestProductEnvironment(label), HOME: home, PRODUCT_USER_STATE_DIR: root, PRODUCT_CACHE_DIR: join(root, 'cache'), PRODUCT_LOG_DIR: join(root, 'logs'), ...overrides };
  return createCliRuntimeContext(resolveProductConfig({ environment }), environment);
}

/** Minimal explicit environment for a built CLI fixture with a temporary home. */
export function createTestBinaryEnvironment(home: string, overrides: TConfigEnvironment = {}): Record<string, string> {
  const inherited: Record<string, string | undefined> = {};
  for (const key of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return Object.fromEntries(
    Object.entries({ ...inherited, ...createTestProductRuntime('test-product', { HOME: home }).environment, ...overrides })
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

const rememberedCredentials = new Map<string, string>();

/** Capture only the telemetry knobs set by the current isolated test invocation. */
export function createTestTelemetryRuntime(home: string): ICliRuntimeContext {
  const keys = [
    'PRODUCT_TELEMETRY_ENABLED', 'PRODUCT_TELEMETRY_TRACES', 'PRODUCT_TELEMETRY_METRICS',
    'PRODUCT_TELEMETRY_LOGS', 'PRODUCT_TELEMETRY_OTLP_PROTOCOL', 'PRODUCT_TELEMETRY_OTLP_ENDPOINT',
    'PRODUCT_TELEMETRY_OTLP_TRACES_ENDPOINT', 'PRODUCT_TELEMETRY_OTLP_METRICS_ENDPOINT',
    'PRODUCT_TELEMETRY_OTLP_LOGS_ENDPOINT', 'PRODUCT_TELEMETRY_OTLP_HEADERS',
    'PRODUCT_TELEMETRY_LOG_USER_PROMPTS', 'PRODUCT_TELEMETRY_LOG_ASSISTANT_RESPONSES',
    'PRODUCT_TELEMETRY_LOG_TOOL_ARGUMENTS', 'PRODUCT_TELEMETRY_LOG_TOOL_OUTPUT',
  ] as const;
  const selected: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) selected[key] = value;
  }
  // A provider credential leaves process.env when startup runs (issue #3429); like an embedding host,
  // a later in-process call keeps the value it was given rather than reading it back from there.
  for (const key of ['PRODUCT_LIVE_TRACE_TEST_KEY', 'PRODUCT_LIVE_CONTENT_TEST_KEY']) {
    const value = process.env[key] ?? rememberedCredentials.get(key);
    if (value !== undefined) {
      selected[key] = value;
      rememberedCredentials.set(key, value);
    }
  }
  return createTestProductRuntime('test-product', { HOME: home, ...selected });
}
