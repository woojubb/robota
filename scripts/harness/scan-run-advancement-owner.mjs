#!/usr/bin/env node

/**
 * One queue has one owner that may advance its worker loop.
 *
 * RUNTIME-003 found four production pumping loops over the same low-level step: the background
 * driver, prompt backend, local runtime provider, and CLI local runner. Even after consolidating
 * them, a new direct call would silently recreate concurrent DAG advancement. This scan pins the
 * structural boundary: WorkerLoopService declares the step and RunAdvancementCoordinator calls it.
 * Every other production reference is a finding, including aliases and element access.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';

const DECLARATION_FILE = 'packages/dag-worker/src/services/worker-loop-service.ts';
const OWNER_FILE = 'packages/dag-worker/src/services/run-advancement-coordinator.ts';

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isNamed(node) {
  return (ts.isIdentifier(node) || ts.isStringLiteral(node)) && node.text === 'processOnce';
}

function classify(node) {
  const parent = node.parent;
  if (parent !== undefined && ts.isMethodDeclaration(parent) && parent.name === node) {
    return 'declaration';
  }
  if (
    parent !== undefined &&
    ts.isPropertyAccessExpression(parent) &&
    parent.name === node &&
    parent.parent !== undefined &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return 'call';
  }
  if (
    parent !== undefined &&
    ts.isElementAccessExpression(parent) &&
    parent.argumentExpression === node &&
    parent.parent !== undefined &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return 'call';
  }
  // `Pick<WorkerLoopService, 'processOnce'>` derives the private dependency from the owner class;
  // it is a type reference, not a second runtime authority.
  if (parent !== undefined && ts.isLiteralTypeNode(parent)) return 'derived-type';
  return 'reference';
}

export function inspectRunAdvancementOwnership(
  files,
  readFile = (file) => readFileSync(file, 'utf8'),
  expected = { declarationFile: DECLARATION_FILE, ownerFile: OWNER_FILE },
) {
  const findings = [];
  let declarationCount = 0;
  let ownerCallCount = 0;

  for (const file of files) {
    const source = readFile(file);
    if (!source.includes('processOnce')) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (isNamed(node)) {
        const kind = classify(node);
        if (kind === 'derived-type') {
          // Allowed only in the coordinator that owns the derived worker-step dependency.
          if (file !== expected.ownerFile) {
            findings.push({ file, line: lineOf(sourceFile, node), kind });
          }
        } else if (kind === 'declaration' && file === expected.declarationFile) {
          declarationCount += 1;
        } else if (kind === 'call' && file === expected.ownerFile) {
          ownerCallCount += 1;
        } else {
          findings.push({ file, line: lineOf(sourceFile, node), kind });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (declarationCount !== 1) {
    findings.push({
      file: expected.declarationFile,
      line: 0,
      kind: 'canonical-declaration-count',
      count: declarationCount,
    });
  }
  if (ownerCallCount !== 1) {
    findings.push({
      file: expected.ownerFile,
      line: 0,
      kind: 'canonical-owner-call-count',
      count: ownerCallCount,
    });
  }
  return { findings, declarationCount, ownerCallCount };
}

function collectProductionFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '__tests__' ||
        entry.name === 'fixtures'
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        files.push(path.relative(root, full));
      }
    }
  };
  for (const scope of ['packages', 'apps']) {
    const absolute = path.join(root, scope);
    if (existsSync(absolute)) walk(absolute);
  }
  return files;
}

function main() {
  const root = process.cwd();
  const files = collectProductionFiles(root);
  if (files.length === 0) {
    console.error('run-advancement-owner scan failed: no production TypeScript files found.');
    process.exitCode = 1;
    return;
  }
  const result = inspectRunAdvancementOwnership(files, (file) =>
    readFileSync(path.join(root, file), 'utf8'),
  );
  console.log(`::examined:: ${files.length} production TypeScript files`);
  if (result.findings.length > 0) {
    console.error(`run-advancement-owner scan failed: ${result.findings.length} finding(s):`);
    for (const finding of result.findings) {
      const suffix = finding.count === undefined ? '' : ` (found ${finding.count}, expected 1)`;
      console.error(`- ${finding.file}:${finding.line} [${finding.kind}]${suffix}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    'run-advancement-owner scan passed (one worker-step declaration; one coordinator call).',
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
