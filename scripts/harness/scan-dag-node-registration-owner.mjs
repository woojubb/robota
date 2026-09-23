#!/usr/bin/env node

/** #2163/#2155: one declared package owner for every static DAG registration identity. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  isClassDeclaration,
  isGetAccessorDeclaration,
  isNoSubstitutionTemplateLiteral,
  isPropertyDeclaration,
  isStringLiteral,
  withSourceFile,
} from './lib/ts-ast.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';
import { listManifestPackageDirs, listSourceFiles } from './workspace-packages.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const SPEC = 'packages/dag-nodes/docs/SPEC.md';
const START = '<!-- dag-node-registration-owner-map:start -->';
const END = '<!-- dag-node-registration-owner-map:end -->';
const INSTANT_DYNAMIC_CLASSES = new Set([
  'PromptBackedNodeDefinition',
  'CompositeInstantNodeDefinition',
]);
let examinedPackages = 0;

export function readExaminedDagNodePackageCount() {
  return examinedPackages;
}

export function parseDagNodeOwnerMap(doc) {
  const findings = [];
  const identities = new Map();
  const start = doc.indexOf(START);
  const end = doc.indexOf(END, start + START.length);
  if (start < 0 || end < 0 || doc.indexOf(START, start + START.length) >= 0) {
    return { identities, findings: ['missing owner map or ambiguous owner-map markers'] };
  }
  let rows = 0;
  for (const line of doc.slice(start + START.length, end).split('\n')) {
    if (!line.trim().startsWith('|') || /^\|\s*[-: ]+\|/u.test(line)) continue;
    const row = line.match(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*(.+?)\s*\|\s*$/u);
    if (!row) {
      if (!line.includes('Package owner')) findings.push(`malformed owner-map row: ${line}`);
      continue;
    }
    rows += 1;
    const [, owner, cell] = row;
    const ids = [...cell.matchAll(/`([a-z][a-z0-9-]*)`/gu)].map((m) => m[1]);
    if (ids.length === 0) findings.push(`owner ${owner} has no identities`);
    for (const id of ids) {
      if (identities.has(id)) findings.push(`duplicate identity ${id} in owner map`);
      else identities.set(id, owner);
    }
  }
  if (rows === 0) findings.push('owner map has no package rows');
  return { identities, findings };
}

/** Syntactic literal identities only. Every other class declaration is reported by the owner scan. */
function extractNodeTypeDeclarations(source, fileName) {
  return withSourceFile(fileName, source, (ast) => {
    const identities = [];
    const unsupported = [];
    const visit = (node) => {
      if (isClassDeclaration(node)) {
        for (const member of node.members ?? []) {
          if (!isPropertyDeclaration(member) && !isGetAccessorDeclaration(member)) continue;
          const name = member.name?.text ?? member.name?.expression?.text;
          if (name !== 'nodeType') continue;
          if (
            isPropertyDeclaration(member) &&
            member.name?.text === 'nodeType' &&
            member.initializer &&
            (isStringLiteral(member.initializer) ||
              isNoSubstitutionTemplateLiteral(member.initializer))
          )
            identities.push(member.initializer.text);
          else {
            unsupported.push({
              className: node.name?.text ?? '<anonymous class>',
              dynamicProperty:
                isPropertyDeclaration(member) &&
                member.name?.text === 'nodeType' &&
                member.initializer === undefined &&
                member.type?.getText() === 'string',
            });
          }
        }
      }
      node.forEachChild(visit);
    };
    visit(ast);
    return { identities, unsupported };
  });
}

export function extractStaticNodeTypes(source, fileName) {
  return extractNodeTypeDeclarations(source, fileName).identities;
}

function realOwners(root) {
  const family = path.join(root, 'packages', 'dag-nodes');
  return listManifestPackageDirs(root)
    .filter((dir) => path.dirname(dir) === family)
    .map((dir) => path.basename(dir))
    .sort();
}

function realSource(root, owner) {
  const src = path.join(root, 'packages', 'dag-nodes', owner, 'src');
  const files = listSourceFiles(src, { excludeTests: true, extensions: ['.ts'] }).filter(
    (file) => !file.endsWith('.d.ts'),
  );
  if (files.length === 0) return undefined;
  return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

export function findDagNodeRegistrationOwnerFindings(root = ROOT, options = {}) {
  examinedPackages = 0;
  const doc =
    options.doc ??
    (existsSync(path.join(root, SPEC)) ? readFileSync(path.join(root, SPEC), 'utf8') : '');
  const owners = options.owners ?? realOwners(root);
  examinedPackages = owners.length;
  const readSource = options.readSource ?? ((owner) => realSource(root, owner));
  const { identities, findings: mapFindings } = parseDagNodeOwnerMap(doc);
  const findings = [...mapFindings];
  if (owners.length === 0) findings.push('no DAG node packages found');
  const actual = new Map();
  let staticIdentities = 0;
  for (const owner of owners) {
    const source = readSource(owner);
    if (source === undefined) {
      findings.push(`missing source for ${owner}`);
      continue;
    }
    const declarations = extractNodeTypeDeclarations(source, `${owner}.ts`);
    for (const { className, dynamicProperty } of declarations.unsupported) {
      if (owner === 'instant-node' && INSTANT_DYNAMIC_CLASSES.has(className) && dynamicProperty) {
        continue;
      }
      findings.push(`unsupported nodeType declaration in ${owner}: ${className}`);
    }
    for (const id of declarations.identities) {
      staticIdentities += 1;
      if (actual.has(id))
        findings.push(`duplicate source identity ${id}: ${actual.get(id)} and ${owner}`);
      else actual.set(id, owner);
      if (!identities.has(id)) findings.push(`unmapped identity ${id} in ${owner}`);
      else if (identities.get(id) !== owner) {
        findings.push(
          `wrong owner for ${id}: map says ${identities.get(id)}, source says ${owner}`,
        );
      }
    }
  }
  for (const [id, owner] of identities) {
    if (!actual.has(id)) findings.push(`stale identity ${id} assigned to ${owner}`);
    if (!owners.includes(owner)) findings.push(`missing package owner ${owner} for ${id}`);
  }
  return { findings, examined: owners.length, staticIdentities };
}

function main() {
  const { findings, examined, staticIdentities } = findDagNodeRegistrationOwnerFindings();
  process.stdout.write(
    `::examined:: ${examined} DAG node package(s), ${staticIdentities} static identity declaration(s)\n`,
  );
  for (const finding of findings) process.stderr.write(`dag-node-registration-owner: ${finding}\n`);
  if (findings.length === 0) process.stdout.write('dag-node-registration-owner scan passed.\n');
  return findings.length ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main());
}
