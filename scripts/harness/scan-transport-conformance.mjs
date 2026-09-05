#!/usr/bin/env node

/**
 * ARCH-011 transport lifecycle conformance roster.
 *
 * Scope: production TypeScript below every `packages/agent-transport.../src` tree and framework's
 * `src/transport-host` (excluding tests), plus Vitest files below those trees. The discovery relation is the exported adapter
 * declaration itself: TypeScript resolves every package export entry and identifies exported runtime
 * values whose returned/constructed public type has the adapter lifecycle shape. This covers direct
 * and arrow factories, classes, inheritance, and barrel re-exports without source-regex guesses.
 *
 * Every discovered public subject must equal the approved six-subject package/export roster and its
 * stable subject id must appear in exactly one parsed call to the imported shared
 * `runTransportLifecycleConformance` helper. Comments and unrelated strings cannot claim ownership.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { API } from '@typescript/native-preview/unstable/sync';

import { requireGovernedTree } from './governed-tree.mjs';
import { loadHarnessConfig } from './harness-config.mjs';
import * as ts from './lib/ts-ast.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const GOVERNED_TREE = 'packages';

const SCOPE = loadHarnessConfig().npmScopePrefix;
const CONFORMANCE_HELPER_MODULE = `${SCOPE}agent-interface-transport/testing`;
const TYPE_PROJECT = 'scripts/harness/transport-conformance.tsconfig.json';
export const TRANSPORT_CONFORMANCE_SUBJECTS = Object.freeze([
  `${SCOPE}agent-framework#createHeadlessTransport`,
  `${SCOPE}agent-transport-http#createHttpTransport`,
  `${SCOPE}agent-transport-mcp#createMcpTransport`,
  `${SCOPE}agent-transport-ws#createWsTransport`,
  `${SCOPE}agent-transport-ws#WsTransport`,
  `${SCOPE}agent-transport-webrtc#WebRtcTransport`,
]);
const DIST_ONLY_EXPORT_PACKAGES = new Set([
  `${SCOPE}agent-transport-gui`,
  `${SCOPE}agent-transport-webrtc-web`,
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
    .filter(
      (name) =>
        name === 'agent-framework' ||
        name === 'agent-transport' ||
        name.startsWith('agent-transport-'),
    )
    .map((name) => path.join(packagesDir, name))
    .filter((dir) => statSync(dir).isDirectory());
}

function sourceExportEntries(manifest, packageDir) {
  const entries = [];
  const visit = (value) => {
    if (typeof value === 'object' && value !== null) {
      if (typeof value.source === 'string') entries.push(path.resolve(packageDir, value.source));
      for (const child of Object.values(value)) visit(child);
    }
  };
  visit(manifest.exports);
  const unique = [...new Set(entries)];
  if (unique.length === 0) {
    if (DIST_ONLY_EXPORT_PACKAGES.has(manifest.name)) {
      const conventionalEntry = path.join(packageDir, 'src', 'index.ts');
      if (!existsSync(conventionalEntry)) {
        throw new Error(`${manifest.name}: conventional source export does not exist`);
      }
      return [conventionalEntry];
    }
    throw new Error(`${manifest.name}: package exports declare no source entry`);
  }
  for (const file of unique) {
    if (!existsSync(file))
      throw new Error(`${manifest.name}: source export does not exist: ${file}`);
  }
  return unique;
}

function hasAdapterShape(checker, type) {
  const required = ['name', 'lifecycle', 'attach', 'start', 'stop'];
  if (!required.every((name) => checker.getPropertyOfType(type, name))) return false;
  const lifecycle = checker.getPropertyOfType(type, 'lifecycle');
  if (!lifecycle) return false;
  const lifecycleType = checker.getTypeOfSymbol(lifecycle);
  const kind = checker.getPropertyOfType(lifecycleType, 'kind');
  if (!kind) return false;
  const kindType = checker.getTypeOfSymbol(kind);
  const parts = kindType.isUnionType() ? kindType.getTypes() : [kindType];
  return ['service', 'runner'].some((value) =>
    parts.some((part) => part.isStringLiteralType() && part.value === value),
  );
}

function exportedAdapterType(checker, symbol) {
  const valueType = checker.getTypeOfSymbol(symbol);
  for (const signature of checker.getSignaturesOfType(valueType, 0)) {
    const returned = checker.getReturnTypeOfSignature(signature);
    if (hasAdapterShape(checker, returned)) return returned;
  }
  for (const signature of checker.getSignaturesOfType(valueType, 1)) {
    const instance = checker.getReturnTypeOfSignature(signature);
    if (hasAdapterShape(checker, instance)) return instance;
  }
  return hasAdapterShape(checker, valueType) ? valueType : undefined;
}

export function discoverTransportSubjects(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, GOVERNED_TREE, {
    scan: 'transport-conformance',
    why: 'the public adapter declarations and their conformance invocations live there.',
  });

  examinedTransportCount = 0;
  const packages = transportPackageDirs(root).flatMap((packageDir) => {
    const manifestPath = path.join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) return [];
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.name !== 'string') return [];
    const hostDir =
      path.basename(packageDir) === 'agent-framework'
        ? path.join(packageDir, 'src', 'transport-host')
        : undefined;
    const exportsManifest = hostDir
      ? { ...manifest, exports: { '.': manifest.exports?.['.'] } }
      : manifest;
    return [
      {
        packageName: manifest.name,
        entries: sourceExportEntries(exportsManifest, packageDir),
        hostDir,
      },
    ];
  });
  const rootNames = packages.flatMap(({ entries }) => entries);
  const projectFile = path.join(root, TYPE_PROJECT);
  if (!existsSync(projectFile)) {
    throw new Error(`transport-conformance type project does not exist: ${projectFile}`);
  }
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({ openProjects: [projectFile], openFiles: rootNames });
  const typeProject = snapshot.getProject(projectFile);
  if (!typeProject) {
    throw new Error(`transport-conformance type project did not load: ${projectFile}`);
  }
  const subjects = [];
  for (const { packageName, entries, hostDir } of packages) {
    for (const entry of entries) {
      const sourceFile = typeProject.program.getSourceFile(entry);
      const checker = typeProject.checker;
      const moduleSymbol =
        sourceFile && checker ? checker.getSymbolAtLocation(sourceFile) : undefined;
      if (!sourceFile || !checker || !moduleSymbol) continue;
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const target = exported.valueDeclaration ? exported : checker.getAliasedSymbol(exported);
        if (!target.valueDeclaration) continue;
        if (hostDir) {
          const declarationFile = target.valueDeclaration
            .resolve(typeProject)
            ?.getSourceFile().fileName;
          if (!declarationFile || !declarationFile.startsWith(`${hostDir}${path.sep}`)) continue;
        }
        if (exportedAdapterType(checker, target)) {
          subjects.push(`${packageName}#${exported.name}`);
        }
      }
    }
  }
  const uniqueSubjects = [...new Set(subjects)].sort();
  examinedTransportCount = uniqueSubjects.length;
  return uniqueSubjects;
}

function countConformanceInvocations(file, subjectId) {
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let helperLocalName;
  let calls = 0;
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === CONFORMANCE_HELPER_MODULE &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      const imported = node.importClause.namedBindings.elements.find(
        ({ propertyName, name }) =>
          (propertyName?.text ?? name.text) === 'runTransportLifecycleConformance',
      );
      if (imported) helperLocalName = imported.name.text;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      helperLocalName !== undefined &&
      node.expression.text === helperLocalName
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        const property = argument.properties.find(
          (candidate) =>
            ts.isPropertyAssignment(candidate) &&
            ((ts.isIdentifier(candidate.name) && candidate.name.text === 'subjectId') ||
              (ts.isStringLiteral(candidate.name) && candidate.name.text === 'subjectId')),
        );
        if (
          property &&
          ts.isPropertyAssignment(property) &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === subjectId
        ) {
          calls += 1;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return calls;
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
      path.join(
        packageDir,
        'src',
        ...(path.basename(packageDir) === 'agent-framework' ? ['transport-host'] : []),
      ),
      (file) => file.endsWith('.test.ts') && file.includes(`${path.sep}__tests__${path.sep}`),
    ),
  );
  for (const subject of expected) {
    const invocationCount = tests.reduce(
      (count, file) => count + countConformanceInvocations(file, subject),
      0,
    );
    if (invocationCount !== 1) {
      findings.push(
        `${subject}: expected exactly one shared-suite invocation, found ${invocationCount}`,
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
