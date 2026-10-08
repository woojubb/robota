#!/usr/bin/env node
/** Copy the selected product's host CLI binary to its configured desktop resource name. */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = join(scriptDirectory, '..');
const workspaceRoot = join(appDirectory, '..', '..');
const cliDirectory = join(workspaceRoot, 'packages', 'agent-cli');
const identityPath = existsSync(join(workspaceRoot, '.product', 'identity.json'))
  ? join(workspaceRoot, '.product', 'identity.json')
  : join(appDirectory, 'dist', 'electron', 'product-identity.json');
if (!existsSync(identityPath)) throw new Error('Build the desktop Electron main process before bundling its runtime.');
const embeddedIdentity = JSON.parse(readFileSync(identityPath, 'utf8'));
const metadataPath = join(workspaceRoot, '.product', 'artifact-metadata.json');
const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) : undefined;

const os = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const isWin = process.platform === 'win32';
const artifactPrefix = metadata?.artifactName ?? embeddedIdentity.identity.cliName;
const extension = isWin ? '.exe' : '';
const sourceName = `${artifactPrefix}-${os}-${arch}${extension}`;
const selectedBinary = process.argv[2] === '--binary' ? process.argv[3] : process.env.PRODUCT_DESKTOP_BINARY;
if (process.argv[2] === '--binary' && !selectedBinary) throw new Error('--binary requires a path.');
const source = selectedBinary
  ? resolve(selectedBinary)
  : join(cliDirectory, 'dist-bun', sourceName);
if (!existsSync(source)) {
  throw new Error(
    `bundle-runtime: ${source} is missing. Build the selected CLI target first: ${artifactPrefix}-${os}-${arch}`,
  );
}

const outputDirectory = join(appDirectory, 'resources-bin');
mkdirSync(outputDirectory, { recursive: true });
const destinationName = `${embeddedIdentity.identity.desktopExecutableName}${extension}`;
const destination = join(outputDirectory, destinationName);
copyFileSync(source, destination);
console.log(`bundle-runtime: ${source} -> resources-bin/${destinationName}`);
