#!/usr/bin/env node

import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';

export const DUAL_LICENSE = 'AGPL-3.0-only OR LicenseRef-Commercial';
const NPM_SCOPE_PREFIX = loadHarnessConfig().npmScopePrefix;
const SCOPED_PACKAGE_NAME = new RegExp(
  `^${NPM_SCOPE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z0-9]+(?:[._-][a-z0-9]+)*$`,
);
const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

function listManifestPaths(directory) {
  const manifests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...listManifestPaths(absolute));
      continue;
    }
    if (entry.isFile() && entry.name === 'package.json') manifests.push(absolute);
  }
  return manifests;
}

function toPurl(name, manifestPath) {
  if (typeof name !== 'string' || !SCOPED_PACKAGE_NAME.test(name)) {
    throw new Error(
      `${manifestPath}: field "name" expected canonical ${NPM_SCOPE_PREFIX}<name>; ` +
        `received ${JSON.stringify(name)}`,
    );
  }
  const [scope, packageName] = name.split('/');
  return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(packageName)}`;
}

function readManifest(manifestPath, readFile) {
  let source;
  try {
    source = readFile(manifestPath, 'utf8');
  } catch (error) {
    const received = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${manifestPath}: could not read manifest; expected readable UTF-8 JSON; received ${received}`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const received = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${manifestPath}: invalid JSON; expected a package manifest object; received ${received}`,
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    const received = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`${manifestPath}: field "root" expected object; received ${received}`);
  }
  return parsed;
}

export function deriveDependencyReviewLicenseExemptions(
  packagesRoot,
  { readFile = readFileSync } = {},
) {
  const purls = [];
  const selectedNames = new Map();
  for (const manifestPath of listManifestPaths(packagesRoot)) {
    const manifest = readManifest(manifestPath, readFile);
    if (manifest.license !== DUAL_LICENSE) continue;
    const purl = toPurl(manifest.name, manifestPath);
    const previousPath = selectedNames.get(manifest.name);
    if (previousPath !== undefined) {
      throw new Error(
        `${manifestPath}: duplicate selected package identity ${JSON.stringify(manifest.name)}; ` +
          `first declared by ${previousPath}`,
      );
    }
    selectedNames.set(manifest.name, manifestPath);
    purls.push(purl);
  }
  if (purls.length === 0) {
    throw new Error(
      `${packagesRoot}: selected population is empty for license ${JSON.stringify(DUAL_LICENSE)}`,
    );
  }
  return purls.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function writeDependencyReviewLicenseExemptionsOutput(purls, outputPath) {
  if (typeof outputPath !== 'string' || outputPath.trim() === '') {
    const received = outputPath === undefined ? 'undefined' : JSON.stringify(outputPath);
    throw new Error(`$GITHUB_OUTPUT: field "path" expected non-empty string; received ${received}`);
  }
  appendFileSync(outputPath, `purls=${purls.join(',')}\n`, 'utf8');
}

export function main({
  packagesRoot = path.join(WORKSPACE_ROOT, 'packages'),
  outputPath = process.env.GITHUB_OUTPUT,
} = {}) {
  const purls = deriveDependencyReviewLicenseExemptions(packagesRoot);
  writeDependencyReviewLicenseExemptionsOutput(purls, outputPath);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
