import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createNodeWorkspaceTrustService } from '@robota-sdk/agent-framework/node';
import { afterEach, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { prepareForwardedEnvironment } from '../early-forwarded-daemon.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('forwards only admitted provider references and withholds unrelated secrets', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'forward-env-')));
  roots.push(root);
  const project = join(root, 'project');
  execFileSync('git', ['init', '-q', project]);
  const runtime = createTestProductRuntime('test-product', { HOME: root, USER_PROVIDER_REF: 'user-fixture', PROJECT_PROVIDER_REF: 'project-fixture', UNRELATED_PRIVATE_TOKEN: 'must-not-leave', PRODUCT_WS_TOKEN: 'must-not-leave-either' });
  mkdirSync(runtime.layout.userRoot, { recursive: true, mode: 0o700 });
  writeFileSync(runtime.layout.userPaths.settings, JSON.stringify({ providers: { user: { type: 'openai', apiKey: '$ENV:USER_PROVIDER_REF' } } }), { mode: 0o600 });
  const projectSettings = join(project, runtime.layout.projectSettingsPaths[0]!.relativePath);
  mkdirSync(dirname(projectSettings), { recursive: true });
  writeFileSync(projectSettings, JSON.stringify({ providers: { project: { type: 'openai', apiKey: '$ENV:PROJECT_PROVIDER_REF' } } }));

  await expect(prepareForwardedEnvironment(runtime, project, false)).rejects.toThrow(/trust/i);
  const restricted = await prepareForwardedEnvironment(runtime, project, true);
  expect(restricted.USER_PROVIDER_REF).toBe('user-fixture');
  expect(restricted.PROJECT_PROVIDER_REF).toBeUndefined();
  expect(restricted.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
  expect(restricted.PRODUCT_WS_TOKEN).toBeUndefined();

  const trust = createNodeWorkspaceTrustService(runtime.layout.userPaths.workspaceTrust, runtime.layout.projectStateDirectories);
  expect((await trust.grant(project)).status).toBe('trusted');
  const trusted = await prepareForwardedEnvironment(runtime, project, false);
  expect(trusted.USER_PROVIDER_REF).toBe('user-fixture');
  expect(trusted.PROJECT_PROVIDER_REF).toBe('project-fixture');
  expect(trusted.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
  expect(trusted.PRODUCT_WS_TOKEN).toBeUndefined();
});
