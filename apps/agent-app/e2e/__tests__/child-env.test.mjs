import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embeddedProductIdentity, resolveProductConfig } from '../../../../packages/product-config/src/index.ts';
import { productEnvironment as syntheticEnvironment } from '../../../../packages/product-config/src/__tests__/product-environment.ts';

import { buildBundledRuntimeChildEnv } from '../child-env.mjs';
import { buildProductTestEnvironment } from '../product-fixture.mjs';
import { buildRemoteDesktopProductFixture } from '../remote-runtime-e2e.mjs';

it('uses the embedded app identity for remote desktop fixture startup', () => {
  const root = mkdtempSync(join(tmpdir(), 'remote-product-fixture-'));
  try {
    const identity = embeddedProductIdentity(resolveProductConfig({ environment: syntheticEnvironment('cedar') }));
    writeFileSync(join(root, 'product-identity.json'), JSON.stringify(identity));
    const selected = buildRemoteDesktopProductFixture(root, join(root, 'state'));
    expect(selected.environment.PRODUCT_ID).toBe('cedar');
    expect(selected.environment.PRODUCT_CLI_NAME).toBe('cedar');
    expect(selected.environment.PRODUCT_APP_ID).toBe('org.example.cedar');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * GUI-003 / #3356 — the bundled-runtime e2e failed on Windows only: the packaged runtime's
 * `os.homedir()` reads `USERPROFILE` there, never `HOME`, so a sandbox env that set only `HOME` never
 * isolated configured user-state directory on Windows. The runtime fell through to the real runner profile, found no
 * `settings.json` ("No provider configuration found.") and a rendezvous directory it did not control.
 */
describe('buildBundledRuntimeChildEnv (GUI-003, #3356 Windows sandbox)', () => {
  const productEnvironment = buildProductTestEnvironment('/tmp/gui003-product').environment;

  it('sets USERPROFILE alongside HOME, so os.homedir() is sandboxed on win32 too', () => {
    const env = buildBundledRuntimeChildEnv({
      path: '/usr/bin',
      home: '/tmp/gui003-home',
      token: 'tok',
      port: 1234,
      productEnvironment,
    });
    expect(env.HOME).toBe('/tmp/gui003-home');
    expect(env.USERPROFILE).toBe('/tmp/gui003-home');
  });

  it('carries SystemRoot through when the host has one', () => {
    const env = buildBundledRuntimeChildEnv({
      path: '/usr/bin',
      home: '/tmp/h',
      token: 't',
      port: 1,
      systemRoot: 'C:\\Windows',
      productEnvironment,
    });
    expect(env.SystemRoot).toBe('C:\\Windows');
  });

  it('omits SystemRoot when the host has none, rather than publishing it as undefined', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 1, productEnvironment });
    expect('SystemRoot' in env).toBe(false);
  });

  it('is a curated allowlist, not the ambient environment — only what the packaged runtime needs', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 1, productEnvironment });
    expect(env.PRODUCT_ID).toBe('desktop-fixture');
    expect(env).not.toHaveProperty('PRODUCT_CONFIG_FILE');
    expect(env).not.toHaveProperty('SECURITY_ENCRYPTION_KEY_FILE');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('stringifies the port, since env values must be strings', () => {
    const env = buildBundledRuntimeChildEnv({ path: '/usr/bin', home: '/tmp/h', token: 't', port: 4321, productEnvironment });
    expect(env.PRODUCT_WS_PORT).toBe('4321');
  });
});
