#!/usr/bin/env node

/**
 * Check that @robota-sdk/* tokens in package.json scripts and helper .mjs
 * scripts resolve to existing workspace packages.
 *
 * Lesson source: the agent-web → agent-web-ui package rename left a stale
 * filter token (old web package name) in agent-cli's build script — develop
 * was locally unbuildable and nothing detected it (HARNESS-004, 2026-06-11).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const TOKEN_PATTERN = /@robota-sdk\/[a-z0-9]+(?:-[a-z0-9]+)*(?![\w-])/g;

// Example/fixture tokens used inside harness scripts' own rule tables.
const EXAMPLE_TOKEN_ALLOWLIST = new Set(['@robota-sdk/other']);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listPackageJsonFiles(root) {
  const files = [];
  const rootPkg = path.join(root, 'package.json');
  if (existsSync(rootPkg)) files.push(rootPkg);
  for (const family of ['packages', 'apps']) {
    const familyDir = path.join(root, family);
    if (!existsSync(familyDir)) continue;
    for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(familyDir, entry.name, 'package.json');
      if (existsSync(pkgPath)) files.push(pkgPath);
    }
  }
  return files;
}

function listHelperScripts(root) {
  const results = [];

  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
        results.push(full);
      }
    }
  }

  walk(path.join(root, 'scripts'));
  for (const family of ['packages', 'apps']) {
    const familyDir = path.join(root, family);
    if (!existsSync(familyDir)) continue;
    for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      walk(path.join(familyDir, entry.name, 'scripts'));
    }
  }
  return results;
}

export async function findWorkspaceRefFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const packageJsonFiles = listPackageJsonFiles(root);

  const workspaceNames = new Set();
  for (const pkgPath of packageJsonFiles) {
    const name = readJson(pkgPath).name;
    if (typeof name === 'string') workspaceNames.add(name);
  }

  function checkText(text, relativeFile) {
    for (const match of text.matchAll(TOKEN_PATTERN)) {
      const token = match[0];
      if (EXAMPLE_TOKEN_ALLOWLIST.has(token)) continue;
      if (!workspaceNames.has(token)) {
        findings.push({
          file: relativeFile,
          type: 'unresolved-workspace-ref',
          detail: `${token} does not resolve to any workspace package.`,
        });
      }
    }
  }

  for (const pkgPath of packageJsonFiles) {
    const scripts = readJson(pkgPath).scripts ?? {};
    checkText(Object.values(scripts).join('\n'), path.relative(root, pkgPath));
  }

  for (const scriptPath of listHelperScripts(root)) {
    checkText(readFileSync(scriptPath, 'utf8'), path.relative(root, scriptPath));
  }

  return findings;
}

export async function main() {
  const findings = await findWorkspaceRefFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('workspace ref scan passed.\n');
    return;
  }
  process.stdout.write('workspace ref scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
