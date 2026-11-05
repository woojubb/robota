import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';
import { afterEach, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { productProviderDefinitions } from '../../product/provider-definitions.js';
import { restartProductEnvironment } from '../../product/restart-environment.js';
import { createProductUserSettingsSources } from '../../product/user-settings.js';
import { prepareForwardedEnvironment, validateForwardedEnvironment } from '../early-forwarded-daemon.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('forwards only admitted provider references and withholds unrelated secrets', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-env-')));
  roots.push(root);
  const project = join(root, 'project');
  execFileSync('git', ['init', '-q', project]);
  const runtime = createTestProductRuntime('test-product', { HOME: root, USER_PROVIDER_REF: 'user-fixture', PROJECT_PROVIDER_REF: 'project-fixture', UNRELATED_PRIVATE_TOKEN: 'must-not-leave', PRODUCT_WS_TOKEN: 'must-not-leave-either' });
  mkdirSync(runtime.layout.userRoot, { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'user', providers: { user: { type: 'openai', model: 'fixture', apiKey: '$ENV:USER_PROVIDER_REF' } } }), { mode: 0o600 });
  const projectSettings = join(project, runtime.layout.projectSettingsPaths[0]!.relativePath);
  mkdirSync(dirname(projectSettings), { recursive: true });
  writeFileSync(projectSettings, JSON.stringify({ currentProvider: 'project', providers: { project: { type: 'openai', model: 'fixture', apiKey: '$ENV:PROJECT_PROVIDER_REF' } } }));

  await expect(prepareForwardedEnvironment(runtime, project, false)).rejects.toThrow(/trust/i);
  const restricted = await prepareForwardedEnvironment(runtime, project, true);
  expect(restricted.USER_PROVIDER_REF).toBe('user-fixture');
  expect(restricted.PROJECT_PROVIDER_REF).toBeUndefined();
  expect(restricted.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
  expect(restricted.PRODUCT_WS_TOKEN).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, project, true, { USER_PROVIDER_REF: 'user-fixture' })).resolves.toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, project, true, { PROJECT_PROVIDER_REF: 'project-fixture' })).rejects.toThrow(/not admitted/i);
  await expect(validateForwardedEnvironment(runtime, project, true, { NODE_OPTIONS: '--require=/tmp/unapproved' })).rejects.toThrow(/not admitted/i);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'user', providers: { user: { type: 'openai', model: 'fixture', apiKey: '$ENV:PRODUCT_CONFIG_FILE' } } }), { mode: 0o600 });
  await expect(validateForwardedEnvironment(runtime, project, true, { PRODUCT_CONFIG_FILE: '/tmp/attacker-config' })).rejects.toThrow(/not admitted/i);
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'user', providers: { user: { type: 'openai', model: 'fixture', apiKey: '$ENV:USER_PROVIDER_REF' } } }), { mode: 0o600 });

  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  expect((await trust.grant(project)).status).toBe('trusted');
  const trusted = await prepareForwardedEnvironment(runtime, project, false);
  expect(trusted.USER_PROVIDER_REF).toBeUndefined();
  expect(trusted.PROJECT_PROVIDER_REF).toBe('project-fixture');
  expect(trusted.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
  expect(trusted.PRODUCT_WS_TOKEN).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, project, false, { PROJECT_PROVIDER_REF: 'project-fixture' })).resolves.toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, project, false, { USER_PROVIDER_REF: 'user-fixture' })).rejects.toThrow(/not admitted/i);
});

it('withholds an inherited proxy in the secure forwarding path but retains it for an ordinary restart', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-proxy-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, HTTPS_PROXY: 'http://127.0.0.1:9999' });
  const ordinary = restartProductEnvironment(runtime, createProductUserSettingsSources(runtime), productProviderDefinitions());
  expect(ordinary.HTTPS_PROXY).toBe('http://127.0.0.1:9999');
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect(forwarded.HTTPS_PROXY).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, root, true, { HTTPS_PROXY: 'http://127.0.0.1:9999' })).rejects.toThrow(/not admitted/i);
});

it('forwards configured fallback profiles and rejects unrelated profiles', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-fallback-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, PRIMARY_REF: 'primary', FALLBACK_REF: 'fallback', UNUSED_REF: 'unused' });
  mkdirSync(runtime.layout.userRoot, { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'primary', fallbackModel: ['backup'], providers: {
    primary: { type: 'openai', model: 'primary', apiKey: '$ENV:PRIMARY_REF' },
    backup: { type: 'openai', model: 'backup', apiKey: '$ENV:FALLBACK_REF' },
    unused: { type: 'openai', model: 'unused', apiKey: '$ENV:UNUSED_REF' },
  } }), { mode: 0o600 });
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect(forwarded.PRIMARY_REF).toBe('primary');
  expect(forwarded.FALLBACK_REF).toBe('fallback');
  expect(forwarded.UNUSED_REF).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, root, true, { FALLBACK_REF: 'fallback' })).resolves.toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, root, true, { UNUSED_REF: 'unused' })).rejects.toThrow(/not admitted/i);
});

it('forwards the automatically selected environment default without other providers', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-default-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, OPENROUTER_API_KEY: 'router-fixture', UNRELATED_PRIVATE_TOKEN: 'unused' });
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect(forwarded.OPENROUTER_API_KEY).toBe('router-fixture');
  expect(forwarded.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
  const receiving = createTestProductRuntime('test-product', { HOME: root });
  await expect(validateForwardedEnvironment(receiving, root, true, { OPENROUTER_API_KEY: 'router-fixture' })).resolves.toBeUndefined();
});

it('withholds a configured fallback that the runtime drops beyond its chain limit', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-cap-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, PRIMARY_REF: 'primary', A_REF: 'a', B_REF: 'b', C_REF: 'c', D_REF: 'd' });
  mkdirSync(runtime.layout.userRoot, { recursive: true, mode: 0o700 });
  const profile = (name: string) => ({ type: 'openai', model: name, apiKey: `$ENV:${name.toUpperCase()}_REF` });
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ currentProvider: 'primary', fallbackModel: ['a', 'b', 'c', 'd'], providers: {
    primary: profile('primary'), a: profile('a'), b: profile('b'), c: profile('c'), d: profile('d'),
  } }), { mode: 0o600 });
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect([forwarded.A_REF, forwarded.B_REF, forwarded.C_REF]).toEqual(['a', 'b', 'c']);
  expect(forwarded.D_REF).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, root, true, { D_REF: 'd' })).rejects.toThrow(/not admitted/i);
});

it('withholds inherited telemetry rather than allowing the forwarding peer to choose an exporter', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-telemetry-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_TRACES: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318' });
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect(forwarded.PRODUCT_TELEMETRY_ENABLED).toBeUndefined();
  expect(forwarded.PRODUCT_TELEMETRY_OTLP_ENDPOINT).toBeUndefined();
  await expect(validateForwardedEnvironment(runtime, root, true, { PRODUCT_TELEMETRY_ENABLED: '1' })).rejects.toThrow(/not admitted/i);
});

it('does not reject an interactive-only telemetry setting that the forwarded runtime will not receive', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-telemetry-')));
  roots.push(root);
  const runtime = createTestProductRuntime('test-product', { HOME: root, PRODUCT_TELEMETRY_ENABLED: '1', PRODUCT_TELEMETRY_LOGS: 'otlp', PRODUCT_TELEMETRY_OTLP_PROTOCOL: 'http/protobuf', PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'http://127.0.0.1:4318', PRODUCT_TELEMETRY_LOG_USER_PROMPTS: '1' });
  const forwarded = await prepareForwardedEnvironment(runtime, root, true);
  expect(Object.keys(forwarded).filter((name) => name.startsWith('PRODUCT_TELEMETRY_'))).toEqual([]);
});
