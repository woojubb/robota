import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { embeddedProductIdentity, resolveProductConfig } from '@robota-sdk/product-config';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createProductCliHost } from '../../product-host.js';
import { resolveCliRuntimeContext } from '../product-bootstrap.js';
import { runtimeBuildMetadata, runtimeSourceVersion } from '../version.js';

const home = mkdtempSync(join(tmpdir(), 'product-host-'));
afterAll(() => rmSync(home, { recursive: true, force: true }));
afterEach(() => vi.unstubAllGlobals());

function artifact(id: string) {
  const prefix = `${id.toUpperCase()}_`;
  const config = resolveProductConfig({
    environment: {
      HOME: home,
      PRODUCT_ID: id,
      PRODUCT_DISPLAY_NAME: `${id} Agent`,
      PRODUCT_CLI_NAME: id,
      PRODUCT_ENV_PREFIX: prefix,
      PRODUCT_PACKAGE_SCOPE: `@${id}`,
      PRODUCT_APP_ID: `example.${id}`,
      PRODUCT_PROTOCOL_SCHEME: id,
      PRODUCT_TELEMETRY_SERVICE_NAME: id,
      PRODUCT_DAEMON_NAMESPACE: id,
      PRODUCT_DESKTOP_EXECUTABLE: `${id}-runtime`,
      PRODUCT_MCP_CLIENT_NAME: id,
      PRODUCT_MODEL_TOOL_PREFIX: `${id}_command_`,
      PRODUCT_PROMPT_TAG: `${id}_references`,
      PRODUCT_EDITOR_TEMP_PREFIX: `${id}-editor-`,
      PRODUCT_BROWSER_NAMESPACE: id,
      PRODUCT_BROWSER_CREDENTIAL_DATABASE: `${id}-credentials`,
      PRODUCT_CREDENTIAL_SERVICE: id,
      PRODUCT_CRYPTO_NAMESPACE: id,
      SECURITY_MASTER_KEY_DERIVATION_PATH: '[1,2]',
      PRODUCT_USER_STATE_DIR: join(home, id, 'state'),
      PRODUCT_CACHE_DIR: join(home, id, 'cache'),
      PRODUCT_LOG_DIR: join(home, id, 'logs'),
      PRODUCT_PROJECT_STATE_DIR: `.${id}`,
      PRODUCT_SHARED_USER_SETTINGS: '[]',
      PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
    },
  });
  return {
    identity: embeddedProductIdentity(config),
    version: '9.8.7',
    sourceVersion: '3.0.0-beta.92',
    runtimeDefaults: {
      PRODUCT_USER_STATE_DIR: `${id}/state`,
      PRODUCT_CACHE_DIR: `${id}/cache`,
      PRODUCT_LOG_DIR: `${id}/logs`,
      PRODUCT_PROJECT_STATE_DIR: `.${id}`,
      PRODUCT_SHARED_USER_SETTINGS: '[]',
      PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
    },
  } as const;
}

describe('independent published CLI host entry', () => {
  it('seals consumer identity and defaults while preserving ordinary binary refusal', () => {
    vi.stubGlobal('__PRODUCT_CONFIG_IDENTITY__', artifact('installed').identity);
    const cedar = createProductCliHost(artifact('cedar'));
    const amber = createProductCliHost(artifact('amber'));
    const environment = { HOME: home };
    const a = cedar.resolveRuntime({ environment });
    const b = amber.resolveRuntime({ environment });
    expect(a.config.identity.id).toBe('cedar');
    expect(b.config.identity.id).toBe('amber');
    expect(a.layout.userRoot).toBe(join(home, 'cedar/state'));
    expect(b.layout.userRoot).toBe(join(home, 'amber/state'));
    expect(a.artifact?.version).toBe('9.8.7');
    expect(() => cedar.resolveRuntime({ productRuntime: b })).toThrow();
    expect(() => resolveCliRuntimeContext({ productRuntime: a })).toThrow();
  });

  it('holds a snapshot when the entry manifest changes after host construction', () => {
    const original = artifact('cedar');
    const input = {
      ...original,
      identity: structuredClone(original.identity),
      version: original.version as string,
      runtimeDefaults: { ...original.runtimeDefaults, PRODUCT_USER_STATE_DIR: 'cedar/state' as string },
    };
    const host = createProductCliHost(input);
    input.version = '0.0.0';
    (input.identity.identity as { id: string }).id = 'amber';
    input.runtimeDefaults.PRODUCT_USER_STATE_DIR = 'other';
    const runtime = host.resolveRuntime({ environment: { HOME: home } });
    expect(runtime.artifact?.version).toBe('9.8.7');
    expect(runtime.config.identity.id).toBe('cedar');
    expect(runtime.layout.userRoot).toBe(join(home, 'cedar/state'));
  });

  it('does not borrow producer defaults when the consumer omits runtime defaults', () => {
    vi.stubGlobal('__PRODUCT_CONFIG_DEFAULTS__', { PRODUCT_USER_STATE_DIR: 'producer/state' });
    const { runtimeDefaults: _omitted, ...input } = artifact('cedar');
    const runtime = createProductCliHost(input).resolveRuntime({ environment: {
      HOME: home,
      PRODUCT_USER_STATE_DIR: join(home, 'cedar', 'state'),
      PRODUCT_CACHE_DIR: join(home, 'cedar', 'cache'),
      PRODUCT_LOG_DIR: join(home, 'cedar', 'logs'),
      PRODUCT_PROJECT_STATE_DIR: '.cedar',
      PRODUCT_SHARED_USER_SETTINGS: '[]',
      PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
    } });
    expect(runtime.layout.userRoot).toBe(join(home, 'cedar', 'state'));
  });

  it('rejects malformed fixed inputs before execution', () => {
    expect(() => createProductCliHost({ ...artifact('cedar'), version: '' })).toThrow('identity and version');
    expect(() => createProductCliHost({
      ...artifact('cedar'), runtimeDefaults: { PRODUCT_USER_STATE_DIR: '../escape' },
    })).toThrow('PRODUCT_USER_STATE_DIR');
    expect(() => createProductCliHost({
      ...artifact('cedar'), identity: { ...artifact('cedar').identity, identity: {
        ...artifact('cedar').identity.identity, id: 'bad/path',
      } },
    })).toThrow('PRODUCT_ID');
  });

  it('does not accept artifact metadata through the ordinary installed entry', () => {
    const input = artifact('cedar');
    vi.stubGlobal('__PRODUCT_CONFIG_IDENTITY__', input.identity);
    const runtime = createProductCliHost(input).resolveRuntime({ environment: { HOME: home } });
    expect(() => resolveCliRuntimeContext({ productRuntime: runtime }))
      .toThrow('requires a product CLI host');
  });

  it('does not borrow producer source and build defines for omitted consumer metadata', () => {
    vi.stubGlobal('__AGENT_SOURCE_VERSION__', '3.0.0-beta.92');
    vi.stubGlobal('__AGENT_BUILD_METADATA__', 'producer-build');
    const { sourceVersion: _source, ...input } = artifact('cedar');
    const runtime = createProductCliHost(input).resolveRuntime({ environment: { HOME: home } });
    expect(runtimeSourceVersion(runtime)).toBe('9.8.7');
    expect(runtimeBuildMetadata(runtime)).toBeNull();
    expect(runtime.artifact?.sourceVersion).toBe('9.8.7');
    expect(runtime.artifact?.buildMetadata).toBeNull();
  });
});
