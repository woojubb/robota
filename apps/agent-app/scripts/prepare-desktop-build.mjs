#!/usr/bin/env node
/** Materialize electron-builder configuration for either a generated or built-in desktop product. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const escapeYaml = (value) => String(value).replaceAll("'", "''");

export function prepareDesktopBuild({
  appRoot = join(dirname(fileURLToPath(import.meta.url)), '..'),
  workspaceRoot = join(appRoot, '..', '..'),
} = {}) {
  const identity = JSON.parse(readFileSync(join(appRoot, 'dist/electron/product-identity.json'), 'utf8')).identity;
  const metadataPath = join(workspaceRoot, '.product/artifact-metadata.json');
  const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) : undefined;
  const cliManifest = JSON.parse(readFileSync(join(workspaceRoot, 'packages/agent-cli/package.json'), 'utf8'));
  const version = metadata?.version ?? cliManifest.version;
  if (typeof version !== 'string' || !version) throw new Error('Desktop build requires the selected CLI or product version.');
  const artifactName = metadata?.artifactName ?? identity.cliName;
  const replacements = {
    __PRODUCT_APP_ID__: identity.appId,
    __PRODUCT_DISPLAY_NAME__: identity.displayName,
    __PRODUCT_DESKTOP_ARTIFACT_PREFIX__: `${artifactName}-desktop`,
    __PRODUCT_DESKTOP_APP_EXECUTABLE__: `${identity.cliName}-desktop`,
    __PRODUCT_DESKTOP_EXECUTABLE__: identity.desktopExecutableName,
  };
  let builder = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8');
  for (const [placeholder, value] of Object.entries(replacements)) builder = builder.replaceAll(placeholder, escapeYaml(value));
  if (/__PRODUCT_[A-Z_]+__/u.test(builder)) throw new Error('Desktop builder config has an unresolved product placeholder.');
  builder += `\nextraMetadata:\n  version: '${escapeYaml(version)}'\n`;
  const target = join(appRoot, 'dist/electron/electron-builder.yml');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, builder);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareDesktopBuild();
