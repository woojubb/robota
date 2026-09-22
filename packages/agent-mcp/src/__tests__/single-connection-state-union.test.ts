/**
 * TC-24: exactly ONE exported type alias under `packages/agent-mcp/src/**` (excluding `__tests__`) may
 * be a union whose every member is an object type with a literal `kind` property drawn from a set that
 * includes `'connected'` — i.e. models connection state. This is the "no second status model" half of
 * MCP-003 condition 8.
 *
 * Parses with the TypeScript compiler API rather than asserting a type: the claim is a negative
 * existential over every type the package declares, which only the compiler API can enumerate.
 * Scoped to `src/**`, NOT `src/supervisor` — a subdirectory-scoped check would report green on
 * exactly the outcome that breaks the invariant (a second union living elsewhere in the package).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(TESTS_DIR, '..');

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') {
      continue;
    }
    const full = join(dir, entry);
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

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  return (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * Returns the set of literal `kind` values across a union's members, or `undefined` if the alias is
 * not a union of object types each carrying a literal `kind` — i.e. not a "connection-state-shaped"
 * union at all.
 */
function kindLiteralsOf(alias: ts.TypeAliasDeclaration): Set<string> | undefined {
  if (!ts.isUnionTypeNode(alias.type)) {
    return undefined;
  }
  const kinds = new Set<string>();
  for (const member of alias.type.types) {
    if (!ts.isTypeLiteralNode(member)) {
      return undefined;
    }
    const kindMember = member.members.find(
      (m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText() === 'kind',
    );
    if (
      !kindMember?.type ||
      !ts.isLiteralTypeNode(kindMember.type) ||
      !ts.isStringLiteral(kindMember.type.literal)
    ) {
      return undefined;
    }
    kinds.add(kindMember.type.literal.text);
  }
  return kinds;
}

interface IConnectionStateMatch {
  readonly file: string;
  readonly name: string;
}

function findConnectionStateUnions(files: readonly string[]): IConnectionStateMatch[] {
  const matches: IConnectionStateMatch[] = [];
  for (const file of files) {
    const sourceText = readFileSync(file, 'utf8');
    const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
    walk(sourceFile, (node) => {
      if (!ts.isTypeAliasDeclaration(node) || !hasExportModifier(node)) {
        return;
      }
      const kinds = kindLiteralsOf(node);
      if (kinds?.has('connected')) {
        matches.push({ file, name: node.name.text });
      }
    });
  }
  return matches;
}

describe('package-scope invariant — exactly one connection-state union (TC-24)', () => {
  it('declares exactly one exported connection-state union under src/** (excluding __tests__)', () => {
    const files = collectSourceFiles(SRC_ROOT);
    const matches = findConnectionStateUnions(files);

    const describeMatches = () =>
      matches.length === 0 ? 'none' : matches.map((m) => `${m.name} (${m.file})`).join(', ');

    expect(
      matches.length,
      `expected exactly one exported connection-state union, found: ${describeMatches()}`,
    ).toBe(1);
    expect(matches[0]?.name).toBe('TMCPConnectionState');
  });
});
