#!/usr/bin/env node

/**
 * Check unambiguous Type Ownership table locations in interface-package SPECs against the actual
 * exported declarations. This reads structured cells, not natural-language ownership claims.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';
import { listSourceFiles } from './workspace-packages.mjs';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/u;
const LOCATION = /^`(src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.tsx?)`$/u;
const FILE = /^`([A-Za-z0-9_-]+\.tsx?)`$/u;
const OWNER_MAP = '.agents/specs/contract-family-owner-map.md';

function interfaceOwnerNames(root) {
  const source = readFileSync(path.join(root, OWNER_MAP), 'utf8');
  const section = source.split('<!-- arch-100:owner-map -->')[1]?.split(/^## /mu)[0] ?? '';
  const owners = [...section.matchAll(/^\|\s*`(agent-interface-[^`]+)`\s*\|/gmu)].map(
    (match) => match[1],
  );
  if (owners.length === 0) throw new Error('interface-type-ownership: owner map has no owners');
  return owners;
}

function exportedDeclarationNames(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'));
  const names = [];
  for (const statement of source.statements) {
    const exported = (statement.modifiers ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      if (statement.name) names.push(statement.name.text);
    }
  }
  return names;
}

function declarationLocations(packageDir) {
  const locations = new Map();
  for (const file of listSourceFiles(path.join(packageDir, 'src'), {
    extensions: ['.ts', '.tsx'],
  })) {
    const relative = path.relative(packageDir, file);
    for (const name of exportedDeclarationNames(file)) {
      const paths = locations.get(name) ?? [];
      paths.push(relative);
      locations.set(name, paths);
    }
  }
  return locations;
}

function typeLocationClaims(specText) {
  const claims = [];
  let inSection = false;
  let locationColumn = -1;
  let locationKind = '';
  for (const [index, line] of specText.split('\n').entries()) {
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading && heading[1].length <= 2) {
      inSection = heading[1].length === 2 && heading[2].trim() === 'Type Ownership';
      locationColumn = -1;
      continue;
    }
    if (!inSection || !line.startsWith('|')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] === 'Type') {
      locationColumn = cells.indexOf('Location');
      if (locationColumn < 0) locationColumn = cells.indexOf('File');
      locationKind = cells[locationColumn] ?? '';
      continue;
    }
    if (locationColumn < 0) continue;
    const location =
      locationKind === 'Location'
        ? LOCATION.exec(cells[locationColumn] ?? '')
        : FILE.exec(cells[locationColumn] ?? '');
    for (const match of cells[0].matchAll(/`([^`]+)`/gu)) {
      if (IDENTIFIER.test(match[1])) {
        claims.push({
          ...(location ? {} : { kind: 'malformed-location' }),
          symbol: match[1],
          stated: location
            ? locationKind === 'File'
              ? `src/${location[1]}`
              : location[1]
            : (cells[locationColumn] ?? ''),
          line: index + 1,
        });
      }
    }
  }
  return claims;
}

export function findInterfaceTypeOwnershipFindings(root = resolveWorkspaceRoot(import.meta)) {
  requireGovernedTree(root, ['packages', OWNER_MAP], {
    scan: 'interface-type-ownership',
    why: 'The owner map defines the packages and their SPECs supply the claims to verify.',
  });
  const findings = [];
  let examined = 0;
  let packages = 0;
  for (const owner of interfaceOwnerNames(root)) {
    const packageDir = path.join(root, 'packages', owner);
    packages++;
    const specFile = path.join(packageDir, 'docs', 'SPEC.md');
    if (!existsSync(specFile)) {
      findings.push({
        kind: 'missing-package-claims',
        file: path.relative(root, specFile),
        detail: 'Owner-map package has no SPEC',
      });
      continue;
    }
    const locations = declarationLocations(packageDir);
    const claims = typeLocationClaims(readFileSync(specFile, 'utf8'));
    if (claims.length === 0) {
      findings.push({
        kind: 'missing-package-claims',
        file: path.relative(root, specFile),
        detail: 'No checkable Type Ownership claims',
      });
    }
    for (const claim of claims) {
      examined++;
      if (claim.kind === 'malformed-location') {
        findings.push({ file: path.relative(root, specFile), ...claim });
        continue;
      }
      const declared = locations.get(claim.symbol) ?? [];
      if (!declared.includes(claim.stated)) {
        findings.push({
          file: path.relative(root, specFile),
          ...claim,
          declared,
        });
      }
    }
  }
  if (examined === 0) {
    findings.push({ kind: 'empty-corpus', detail: 'No interface Type Ownership claims examined' });
  }
  return { findings, examined, packages };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const { findings, examined, packages } = findInterfaceTypeOwnershipFindings();
  for (const finding of findings) {
    if (finding.kind === 'empty-corpus' || finding.kind === 'missing-package-claims') {
      console.error(`interface-type-ownership: ${finding.file ?? 'packages'}: ${finding.detail}`);
    } else if (finding.kind === 'malformed-location') {
      console.error(
        `${finding.file}:${finding.line}: ${finding.symbol} has a malformed source location: ${finding.stated || '(empty)'}`,
      );
    } else {
      console.error(
        `${finding.file}:${finding.line}: ${finding.symbol} is listed at ${finding.stated}; ` +
          `declaration(s): ${finding.declared.join(', ') || 'none'}`,
      );
    }
  }
  console.log(`interface-type-ownership: examined ${examined} claims in ${packages} packages`);
  if (findings.length > 0) process.exitCode = 1;
}
