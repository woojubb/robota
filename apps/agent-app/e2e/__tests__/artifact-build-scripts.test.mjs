import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';

import { copyProductIdentity } from '../../scripts/copy-product-identity.mjs';
import { prepareDesktopBuild } from '../../scripts/prepare-desktop-build.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'desktop-artifact-build-'));
  roots.push(workspaceRoot);
  const appRoot = join(workspaceRoot, 'apps/agent-app');
  mkdirSync(join(appRoot, 'dist/electron'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'packages/agent-cli'), { recursive: true });
  mkdirSync(join(workspaceRoot, 'products'), { recursive: true });
  writeFileSync(join(workspaceRoot, 'products/robota.mjs'), 'export const robotaEnvironment = () => ({});\n');
  writeFileSync(join(workspaceRoot, 'packages/agent-cli/package.json'), '{"version":"3.0.0-beta.90"}\n');
  writeFileSync(join(appRoot, 'package.json'), '{"version":"4.5.6"}\n');
  writeFileSync(join(appRoot, 'electron-builder.yml'), "appId: '__PRODUCT_APP_ID__'\nproductName: '__PRODUCT_DISPLAY_NAME__'\nartifactName: '__PRODUCT_DESKTOP_ARTIFACT_PREFIX__-${version}-${arch}.${ext}'\nexecutableName: '__PRODUCT_DESKTOP_APP_EXECUTABLE__'\n");
  const identity = { identity: { id: 'cedar', cliName: 'cedar', displayName: 'Cedar', appId: 'test.cedar', desktopExecutableName: 'cedar-desktop' } };
  writeFileSync(join(appRoot, 'dist/electron/product-identity.json'), JSON.stringify(identity));
  return { workspaceRoot, appRoot, identity };
}

it('does not invent built-in operational defaults for an identity-bearing generated app', () => {
  const { workspaceRoot, appRoot, identity } = fixture();
  mkdirSync(join(workspaceRoot, '.product'));
  writeFileSync(join(workspaceRoot, '.product/identity.json'), JSON.stringify(identity));
  copyProductIdentity({ workspaceRoot, appDirectory: appRoot });
  expect(existsSync(join(appRoot, 'dist/electron/product-runtime-defaults.json'))).toBe(false);
  expect(JSON.parse(readFileSync(join(appRoot, 'dist/electron/product-identity.json'), 'utf8'))).toEqual(identity);
});

it('uses the app version independently of CLI and artifact metadata', () => {
  const { workspaceRoot, appRoot } = fixture();
  prepareDesktopBuild({ workspaceRoot, appRoot });
  const builtIn = readFileSync(join(appRoot, 'dist/electron/electron-builder.yml'), 'utf8');
  expect(builtIn).toContain("version: '4.5.6'");
  expect(builtIn).toContain('artifactName: \'cedar-desktop-${version}-${arch}.${ext}\'');
  mkdirSync(join(workspaceRoot, '.product'));
  writeFileSync(join(workspaceRoot, '.product/artifact-metadata.json'), JSON.stringify({ version: '9.8.7-beta.3', artifactName: 'cedar-host' }));
  prepareDesktopBuild({ workspaceRoot, appRoot });
  const generated = readFileSync(join(appRoot, 'dist/electron/electron-builder.yml'), 'utf8');
  expect(generated).toContain("version: '4.5.6'");
  expect(generated).toContain('artifactName: \'cedar-host-desktop-${version}-${arch}.${ext}\'');
  const config = parse(generated);
  const fromBuilder = createRequire(createRequire(new URL('../../package.json', import.meta.url)).resolve('electron-builder'));
  const { AppInfo } = fromBuilder('app-builder-lib/out/appInfo.js');
  const { expandMacro } = fromBuilder('app-builder-lib/out/util/macroExpander.js');
  const info = new AppInfo({ config, metadata: { name: 'cedar', ...config.extraMetadata } });
  expect(expandMacro(config.artifactName, 'arm64', info, { ext: 'dmg' })).toBe('cedar-host-desktop-4.5.6-arm64.dmg');
  writeFileSync(join(appRoot, 'package.json'), '{"version":"9.8.7-beta.3"}\n');
  prepareDesktopBuild({ workspaceRoot, appRoot });
  expect(readFileSync(join(appRoot, 'dist/electron/electron-builder.yml'), 'utf8')).toContain("version: '9.8.7-beta.3'");
});
