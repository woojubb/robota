#!/usr/bin/env node

/**
 * TC-24 — package-scope invariant: exactly ONE exported type alias under `packages/agent-mcp/src/**`
 * (excluding `__tests__`) may be a union whose every member is an object type carrying a literal
 * `kind` property drawn from a set that includes `'connected'` — i.e. models connection state. This
 * is the "no second status model" half of MCP-003 condition 8.
 *
 * Moved here from a `packages/agent-mcp/src/__tests__/*.test.ts` file (PERF-005): the detection logic
 * itself needs the TypeScript AST — a negative existential over every type the package declares — and
 * PERF-005 forbids a first-party file importing `typescript` directly. The vitest file this scan backs
 * is now a thin runner that spawns this script and asserts its exit code and its stdout; the parse
 * itself goes through the sanctioned adapter, `./lib/ts-ast.mjs`.
 *
 * The detection predicate below is a DELIBERATE, byte-for-byte port of the original test's logic —
 * not a re-derivation of it — because loosening it here would silently widen what TC-24 tolerates.
 *
 * Exit 0 and one summary line on stdout when exactly one match is found; exit 1 and the full list of
 * matches (0, or 2+) on stdout otherwise.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  SyntaxKind,
  createSourceFile,
  isLiteralTypeNode,
  isPropertySignatureDeclaration,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeLiteralNode,
  isUnionTypeNode,
} from './lib/ts-ast.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Every `.ts` file under `dir`, recursively, excluding `__tests__` and `.d.ts` — ported verbatim. */
function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function hasExportModifier(node) {
  return (node.modifiers ?? []).some((modifier) => modifier.kind === SyntaxKind.ExportKeyword);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/**
 * The set of literal `kind` values across a union's members, or `undefined` if the alias is not a
 * union of object types each carrying a literal `kind` — i.e. not a "connection-state-shaped" union
 * at all.
 */
function kindLiteralsOf(alias) {
  if (!isUnionTypeNode(alias.type)) {
    return undefined;
  }
  const kinds = new Set();
  for (const member of alias.type.types) {
    if (!isTypeLiteralNode(member)) {
      return undefined;
    }
    const kindMember = member.members.find(
      (m) => isPropertySignatureDeclaration(m) && m.name.getText() === 'kind',
    );
    if (
      !kindMember?.type ||
      !isLiteralTypeNode(kindMember.type) ||
      !isStringLiteral(kindMember.type.literal)
    ) {
      return undefined;
    }
    kinds.add(kindMember.type.literal.text);
  }
  return kinds;
}

function findConnectionStateUnions(files) {
  const matches = [];
  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    const sourceFile = createSourceFile(file, sourceText);
    walk(sourceFile, (node) => {
      if (!isTypeAliasDeclaration(node) || !hasExportModifier(node)) {
        return;
      }
      const kinds = kindLiteralsOf(node);
      if (kinds?.has('connected')) {
        matches.push({ file: path.relative(WORKSPACE_ROOT, file), name: node.name.text });
      }
    });
  }
  return matches;
}

export function scanSingleConnectionStateUnion(root = WORKSPACE_ROOT) {
  const srcDir = path.join(root, 'packages/agent-mcp/src');
  const files = collectSourceFiles(srcDir);
  return findConnectionStateUnions(files);
}

function main() {
  const matches = scanSingleConnectionStateUnion();
  if (matches.length === 1) {
    console.log(
      `single-connection-state-union scan passed (1 union: ${matches[0].name} in ${matches[0].file})`,
    );
    process.exit(0);
  }
  const describeMatches =
    matches.length === 0 ? 'none' : matches.map((m) => `${m.name} (${m.file})`).join(', ');
  console.error(
    `single-connection-state-union scan FAILED — expected exactly one exported connection-state ` +
      `union under packages/agent-mcp/src/** (excluding __tests__), found: ${describeMatches}`,
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
