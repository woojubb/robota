#!/usr/bin/env node
/** Copy the selected product's host CLI binary to its configured desktop resource name. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadProductConfig } from '@robota-sdk/product-config/node';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = join(scriptDirectory, '..');
const workspaceRoot = join(appDirectory, '..', '..');
const cliDirectory = join(workspaceRoot, 'packages', 'agent-cli');
const embeddedIdentity = JSON.parse(readFileSync(join(workspaceRoot, '.product', 'identity.json'), 'utf8'));
const config = loadProductConfig({
  environment: Object.freeze({ ...process.env }),
  embeddedIdentity,
});

const os = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const isWin = process.platform === 'win32';
const artifactPrefix = config.release.artifactPrefix ?? config.identity.cliName;
const extension = isWin ? '.exe' : '';
const sourceName = `${artifactPrefix}-${os}-${arch}${extension}`;
const source = join(cliDirectory, 'dist-bun', sourceName);
if (!existsSync(source)) {
  throw new Error(
    `bundle-runtime: ${source} is missing. Build the selected CLI target first: ${artifactPrefix}-${os}-${arch}`,
  );
}

const outputDirectory = join(appDirectory, 'resources-bin');
mkdirSync(outputDirectory, { recursive: true });
const destinationName = `${config.identity.desktopExecutableName}${extension}`;
const destination = join(outputDirectory, destinationName);
copyFileSync(source, destination);
console.log(`bundle-runtime: ${sourceName} -> resources-bin/${destinationName}`);
