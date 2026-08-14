#!/usr/bin/env node

/**
 * ARCH-011 transport lifecycle conformance roster.
 *
 * Scope: production TypeScript below every `packages/agent-transport.../src` tree (excluding tests)
 * and Vitest files below those same package trees. The discovery relation is the exported adapter
 * declaration itself: an exported interface extending `ITransportAdapter`/`ITransportRunnerAdapter`
 * plus its exported factory, or an exported class implementing `IConfigurableTransport`.
 *
 * Every discovered public subject must equal the approved six-subject package/export roster and its
 * stable subject id must occur in exactly one test file that invokes the shared
 * `runTransportLifecycleConformance` helper. New/missing/duplicate subjects therefore fail closed.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const GOVERNED_TREE = 'packages';

const SCOPE = loadHarnessConfig().npmScopePrefix;
export const TRANSPORT_CONFORMANCE_SUBJECTS = Object.freeze([
  `${SCOPE}agent-transport#createHeadlessTransport`,
  `${SCOPE}agent-transport-http#createHttpTransport`,
  `${SCOPE}agent-transport-mcp#createMcpTransport`,
  `${SCOPE}agent-transport-ws#createWsTransport`,
  `${SCOPE}agent-transport-ws#WsTransport`,
  `${SCOPE}agent-transport-webrtc#WebRtcTransport`,
]);

let examinedTransportCount = 0;

export function readExaminedTransportCount() {
  return examinedTransportCount;
}

function walk(dir, accept) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      files.push(...walk(full, accept));
    } else if (accept(full)) {
      files.push(full);
    }
  }
  return files;
}

function transportPackageDirs(root) {
  const packagesDir = path.join(root, 'packages');
  return readdirSync(packagesDir)
    .filter((name) => name === 'agent-transport' || name.startsWith('agent-transport-'))
    .map((name) => path.join(packagesDir, name))
    .filter((dir) => statSync(dir).isDirectory());
}

export function discoverTransportSubjects(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, GOVERNED_TREE, {
    scan: 'transport-conformance',
    why: 'the public adapter declarations and their conformance invocations live there.',
  });

  examinedTransportCount = 0;
  const subjects = [];
  for (const packageDir of transportPackageDirs(root)) {
    const manifestPath = path.join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const packageName = JSON.parse(readFileSync(manifestPath, 'utf8')).name;
    if (typeof packageName !== 'string') continue;
    const sourceFiles = walk(
      path.join(packageDir, 'src'),
      (file) => file.endsWith('.ts') && !file.includes(`${path.sep}__tests__${path.sep}`),
    );
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      const interfaceNames = [
        ...source.matchAll(
          /export\s+interface\s+(\w+)\s+extends\s+ITransport(?:Runner)?Adapter\s*</g,
        ),
      ].map((match) => match[1]);
      for (const interfaceName of interfaceNames) {
        const factory = new RegExp(
          `export\\s+function\\s+(\\w+)\\s*\\([^)]*\\)\\s*:\\s*${interfaceName}\\b`,
        ).exec(source)?.[1];
        if (factory) {
          subjects.push(`${packageName}#${factory}`);
          examinedTransportCount += 1;
        }
      }
      for (const match of source.matchAll(
        /export\s+class\s+(\w+)[\s\S]{0,160}?implements\s+IConfigurableTransport\s*</g,
      )) {
        subjects.push(`${packageName}#${match[1]}`);
        examinedTransportCount += 1;
      }
    }
  }
  return subjects.sort();
}

export function findTransportConformanceFindings(
  root = WORKSPACE_ROOT,
  expectedSubjects = TRANSPORT_CONFORMANCE_SUBJECTS,
) {
  const findings = [];
  const discovered = discoverTransportSubjects(root);
  const expected = [...expectedSubjects].sort();
  for (const subject of expected) {
    if (!discovered.includes(subject)) findings.push(`missing public subject: ${subject}`);
  }
  for (const subject of discovered) {
    if (!expected.includes(subject)) findings.push(`unregistered public subject: ${subject}`);
  }

  const tests = transportPackageDirs(root).flatMap((packageDir) =>
    walk(
      path.join(packageDir, 'src'),
      (file) => file.endsWith('.test.ts') && file.includes(`${path.sep}__tests__${path.sep}`),
    ),
  );
  for (const subject of expected) {
    const owners = tests.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return source.includes(subject) && source.includes('runTransportLifecycleConformance');
    });
    if (owners.length !== 1) {
      findings.push(
        `${subject}: expected exactly one shared-suite invocation, found ${owners.length}`,
      );
    }
  }
  return findings;
}

function main() {
  const findings = findTransportConformanceFindings();
  console.log(`::examined:: ${readExaminedTransportCount()} public transport adapter subject(s)`);
  if (findings.length === 0) {
    console.log('transport-conformance scan passed.');
    return;
  }
  console.error('transport-conformance scan FAILED:');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
