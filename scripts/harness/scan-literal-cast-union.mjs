#!/usr/bin/env node

/**
 * A cast cannot make a value a member of a union it is not in.
 *
 * `status: (companion?.status ?? 'active') as TDagDefinitionStatus` compiles, ships, and is wrong.
 * `TDagDefinitionStatus` is `'draft' | 'published' | 'deprecated'`; `'active'` is not in it. Every
 * `switch` downstream fell through that value, and nothing failed — which is why it survived long
 * enough to be found by an architecture audit rather than by the type system whose job it was.
 *
 * WHY A SCAN AND NOT JUST A FIX (DAG-002). The compiler already had every fact needed to reject this.
 * The `as` is what silenced it, and an `as` is invisible to review precisely because it reads like a
 * type annotation. The one in that line was doubly hollow: the other branch of the `??` was ALREADY
 * typed as the union, so the cast could never have been needed for anything except the default it
 * made compile. Fixing the site leaves the shape available everywhere else.
 *
 * WHAT IT CHECKS, exactly. For every `X as T` where `T` names a repo-declared string-literal union,
 * every string literal reachable in the operand through `??`, `||`, `?:` and parentheses must be a
 * member of `T`. Those operators are followed because they are how a default is spelled; anything
 * else in the operand (a call, a variable, a property access) is not a literal and is not judged.
 *
 * WHAT IT CANNOT DO, stated so a pass is not over-read:
 *
 * - It resolves unions by NAME across the repository's own `type X = 'a' | 'b'` declarations. Two
 *   packages declaring the same alias name are merged, so a literal valid in either passes. Measured
 *   on this tree: no first-party string-union alias name is declared twice with differing members.
 * - A union imported from a dependency is not declared here and so is not judged at all.
 * - A union built by composition (`type T = A | B`, `Exclude<…>`) is skipped rather than
 *   half-resolved: a partial member set would report false violations, which is the one failure mode
 *   that gets a scan suppressed instead of obeyed.
 * - It says nothing about non-literal operands. `someString as TStatus` is exactly as unchecked as it
 *   was; this scan narrows the hole to the case it can decide with certainty, and does not claim the
 *   rest.
 * - It sees only CASTS. A literal written into an UNTYPED object literal and then serialized reaches
 *   the same wrong place with no cast to find: review caught `dag-cli node` printing
 *   `status: 'active'` in an example definition for the user to save, on a file DAG-002 never
 *   touched. Static analysis was never going to reach a value that arrives at runtime either, so
 *   `dagDefinitionFromParsedFile` validates the status of every definition it imports. This scan is
 *   one of two layers, not the whole guarantee.
 *
 * FAIL-CLOSED: the governed source tree is mandatory. A run over a root without it is a run that
 * could not judge, and reports that rather than a pass.
 *
 * Exit code 0 = no literal is cast outside its own union, 1 = violation found.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  ScriptTarget,
  SyntaxKind,
  createSourceFile,
  forEachChild,
  isAsExpression,
  isBinaryExpression,
  isIdentifier,
  isLiteralTypeNode,
  isParenthesizedExpression,
  isStringLiteral,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
} from './lib/ts-ast.mjs';

const SOURCE_ROOTS = ['packages', 'apps', 'scripts'];

/** A type alias whose right-hand side starts with a quoted literal (optionally after a leading `|`). */
const STRING_UNION_HINT = /type\s+\w+\s*=[\s\n]*\|?[\s\n]*['"]/;

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function parse(file, source) {
  return createSourceFile(file, source, ScriptTarget.Latest, true);
}

/**
 * Every `type X = 'a' | 'b'` in the tree, as name → Set of members.
 *
 * A union that is not PURELY string literals is recorded as `null` — known by name, deliberately
 * unjudgeable — so a later `as` to it is skipped rather than measured against a member set that was
 * only partly resolved. Reporting a violation from a half-known union is how a scan earns a blanket
 * suppression.
 */
export function collectStringUnions(files, readFile = (f) => readFileSync(f, 'utf8')) {
  const unions = new Map();
  for (const file of files) {
    const source = readFile(file);
    // Parse only files that could declare a string union at all. This is a cheap reject, and it is
    // only safe because it was VERIFIED equivalent rather than assumed: run against the whole tree,
    // the filter takes 2728 files down to 117 and loses none of the 353 aliases with a real member
    // set. Its first version omitted `"` and silently dropped two double-quoted unions — an
    // under-report, which is the direction that matters, since a union the scan never learned about
    // is a union it can never find a violation against.
    if (!STRING_UNION_HINT.test(source)) continue;
    const ast = parse(file, source);
    const visit = (node) => {
      if (isTypeAliasDeclaration(node)) {
        const name = node.name.getText(ast);
        const members = unionMembers(node.type, ast);
        if (members === null) unions.set(name, null);
        else if (members.size > 0) {
          const existing = unions.get(name);
          if (existing === undefined) unions.set(name, members);
          else if (existing !== null) for (const m of members) existing.add(m);
        }
      }
      forEachChild(node, visit);
    };
    visit(ast);
  }
  return unions;
}

/** The literal members of a union type node, or `null` if any member is not a string literal. */
function unionMembers(typeNode, ast) {
  if (isLiteralTypeNode(typeNode)) {
    return isStringLiteral(typeNode.literal) ? new Set([typeNode.literal.text]) : null;
  }
  if (typeNode.kind !== SyntaxKind.UnionType) return new Set();
  const members = new Set();
  for (const member of typeNode.types) {
    if (!isLiteralTypeNode(member) || !isStringLiteral(member.literal)) return null;
    members.add(member.literal.text);
  }
  return members;
}

/**
 * The string literals a value expression can evaluate to, following only the operators that spell a
 * default. Anything else contributes nothing — this reports what it is sure of.
 */
function reachableLiterals(node, out = []) {
  if (isParenthesizedExpression(node)) return reachableLiterals(node.expression, out);
  if (isStringLiteral(node)) {
    out.push(node);
    return out;
  }
  if (node.kind === SyntaxKind.ConditionalExpression) {
    reachableLiterals(node.whenTrue, out);
    reachableLiterals(node.whenFalse, out);
    return out;
  }
  if (isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === SyntaxKind.QuestionQuestionToken || op === SyntaxKind.BarBarToken) {
      reachableLiterals(node.left, out);
      reachableLiterals(node.right, out);
    }
  }
  return out;
}

/** Findings: a string literal cast to a repo-declared union it is not a member of. */
export function findLiteralCastViolations(
  files,
  unions,
  readFile = (f) => readFileSync(f, 'utf8'),
) {
  const findings = [];
  for (const file of files) {
    const source = readFile(file);
    if (!source.includes(' as ')) continue;
    const ast = parse(file, source);
    const visit = (node) => {
      if (
        isAsExpression(node) &&
        isTypeReferenceNode(node.type) &&
        isIdentifier(node.type.typeName)
      ) {
        const name = node.type.typeName.text;
        const members = unions.get(name);
        if (members) {
          for (const literal of reachableLiterals(node.expression)) {
            if (members.has(literal.text)) continue;
            findings.push({
              file,
              line: ast.getLineAndCharacterOfPosition(literal.getStart(ast)).line + 1,
              literal: literal.text,
              union: name,
              members: [...members],
            });
          }
        }
      }
      forEachChild(node, visit);
    };
    visit(ast);
  }
  return findings;
}

export function findLiteralCastUnionFindings(root) {
  const roots = SOURCE_ROOTS.map((dir) => path.join(root, dir)).filter((dir) => existsSync(dir));
  if (roots.length === 0) {
    // Fail closed. "No source here" is not "no violations here".
    throw new Error(
      `literal-cast-union: none of ${SOURCE_ROOTS.join(', ')} exist under ${root} — nothing could be examined.`,
    );
  }
  const files = roots.flatMap((dir) => sourceFiles(dir));
  return {
    findings: findLiteralCastViolations(files, collectStringUnions(files)),
    examined: files.length,
  };
}

function main() {
  const { findings, examined } = findLiteralCastUnionFindings(process.cwd());
  if (findings.length > 0) {
    console.error(`literal-cast-union scan failed: ${findings.length} finding(s):`);
    for (const f of findings) {
      console.error(
        `- [literal-outside-union] ${path.relative(process.cwd(), f.file)}:${f.line} — ` +
          `'${f.literal}' is cast to ${f.union}, ` +
          `whose members are ${f.members.map((m) => `'${m}'`).join(' | ')}. A cast does not make it ` +
          'one; every consumer switching on that union falls through this value silently.',
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} files`);
  console.log(`literal-cast-union scan passed (${examined} file(s) examined).`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
