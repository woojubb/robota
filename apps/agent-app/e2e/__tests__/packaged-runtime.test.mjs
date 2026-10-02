import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { resolveProductConfig, publicProductConfig } from '../../../../packages/product-config/src/index.ts';
import { productEnvironment } from '../../../../packages/product-config/src/__tests__/product-environment.ts';
import { fillProductContent } from '../../../../scripts/product/generate-workspace.mjs';

const appRequire = createRequire(new URL('../../package.json', import.meta.url));
const builderRequire = createRequire(appRequire.resolve('electron-builder'));
const { Platform } = builderRequire('app-builder-lib');
const { PlatformPackager } = builderRequire('app-builder-lib/out/platformPackager.js');
const { archFromString } = createRequire(builderRequire.resolve('app-builder-lib'))('builder-util');
const config = resolveProductConfig({ environment: { ...productEnvironment('selected'), PRODUCT_DISPLAY_NAME: 'Selected Agent', PRODUCT_DESKTOP_EXECUTABLE: 'selected-runtime' } });
const identity = { identity: config.identity };
const yaml = readFileSync(new URL('../../electron-builder.yml', import.meta.url), 'utf8');
const builderConfig = parse(fillProductContent('electron-builder.yml', yaml, publicProductConfig(config), config));
const { AppInfo } = builderRequire('app-builder-lib/out/appInfo.js');
const appInfo = new AppInfo({ config: builderConfig, metadata: { name: 'selected', version: '1.0.0' } });
const source = readFileSync(new URL('../bundled-runtime-e2e.mjs', import.meta.url), 'utf8');
const expression = source.slice(source.indexOf('const BIN ='), source.indexOf('if (!existsSync(BIN))'));

it.each([
  ['darwin', 'x64', Platform.MAC], ['darwin', 'arm64', Platform.MAC],
  ['linux', 'x64', Platform.LINUX], ['linux', 'arm64', Platform.LINUX],
  ['win32', 'x64', Platform.WINDOWS],
])('locates the runtime in electron-builder output for %s/%s', (platform, arch, builderPlatform) => {
  const out = PlatformPackager.prototype.computeAppOutDir.call({
    platform: builderPlatform, platformSpecificBuildOptions: {}, packagerOptions: {},
  }, '/release', archFromString(arch));
  const expected = platform === 'darwin'
    ? join(out, `${appInfo.productFilename}.app`, 'Contents', 'Resources', 'selected-runtime')
    : join(out, 'resources', `selected-runtime${platform === 'win32' ? '.exe' : ''}`);
  const actual = new Function('process', 'pjoin', 'releaseDir', 'identity', 'desktopExecutable', `${expression}\nreturn BIN;`)(
    { platform, arch }, join, '/release', identity, 'selected-runtime',
  );
  expect(actual).toBe(expected);
});
