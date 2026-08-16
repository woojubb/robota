/**
 * The single swap point between the harness TS-API scans and the TypeScript AST implementation
 * (PERF-005 phase 1).
 *
 * WHY THIS MODULE EXISTS. Four scans parse TypeScript source syntactically —
 * `scan-interface-runtime`, `check-spec-public-surface`, `scan-composition-neutrality` and
 * `scripts/audit/audit-implements`. They used to `import ts from 'typescript'` each, pinning the
 * repo to the legacy compiler for the sake of an AST walk that uses no type information at all.
 * They now go through here instead, and here goes to `@typescript/native-preview`.
 *
 * The indirection is REQUIRED, not stylistic. The native API is namespaced `unstable/` with no
 * stability guarantee, and the pin is a dated dev build (`7.0.0-dev.*`). Three of the four scans
 * gate CI. One swap point keeps an upstream break from becoming a four-file emergency.
 *
 * WHAT IS DIFFERENT FROM THE LEGACY API, and how it is reconciled:
 *
 *  1. THERE IS NO STANDALONE PARSER. `unstable/ast` ships the AST types, the 347 `isXxx` guards,
 *     the enums and a token `createScanner`, but no `createSourceFile(text)` — the parser lives in
 *     the Go binary. (`unstable/ast/factory`'s `createSourceFile` is a node CONSTRUCTOR taking
 *     already-parsed statements, not a parser.) The only way to a real tree is `unstable/sync`,
 *     which spawns the tsgo server and answers over a synchronous RPC channel.
 *
 *     So `createSourceFile` here presents the source to the server through a VIRTUAL FILESYSTEM at
 *     a path no tsconfig covers. The file lands in tsgo's "inferred project", which parses and
 *     binds it without loading any configured project — the closest available equivalent to a
 *     standalone syntactic parse, and it never touches the real repo's build graph.
 *
 *  2. `ImportClause.isTypeOnly` IS NOT PART OF THE NATIVE CONTRACT. The declared encoding of
 *     `import type { … }` is `phaseModifier === SyntaxKind.TypeKeyword` (the same field also
 *     carries `defer`), so callers go through {@link isTypeOnlyImportClause}.
 *
 *     Measured, so the reason is on the record rather than assumed: the decoded node DOES answer
 *     `.isTypeOnly` at runtime today, and it currently answers correctly. But that accessor is
 *     absent from `ImportClause`'s `.d.ts`, and its implementation is a single kind-agnostic
 *     "bit 24" getter shared with `isTypeOf` and `multiLine` — it is an artifact of the wire
 *     decoding, not a declared per-kind field. `phaseModifier` is the declared one. Reading the
 *     declared field costs nothing and does not depend on a coincidence holding.
 *
 *     Every other `isTypeOnly` the scans read (`ExportDeclaration`, `ImportEqualsDeclaration`,
 *     `ImportSpecifier`, `ExportSpecifier`) IS declared, and is present and identical.
 *
 *  3. ARRAY HOLES are shaped differently. `const [, b] = xs` yields an `OmittedExpression` in the
 *     legacy AST but a `BindingElement` with no `name` in the native one. Any caller walking
 *     binding patterns must skip a nameless `BindingElement`; `scan-composition-neutrality` does.
 *
 *  4. `forEachChild` is a METHOD on the node, not a free function. The free-function form is
 *     re-exported here so call sites keep the legacy shape. Three guards are also RENAMED
 *     (`isParameter`, `isMethodSignature`, `isPropertySignature`); they are aliased back below.
 *
 *  5. OPTIONALITY OF A TYPE MEMBER IS `postfixToken`, NOT `questionToken`. The native AST leaves
 *     `questionToken` undefined on a `PropertySignature`/`MethodSignature`, so a caller reading it
 *     sees `a?(): void` and `b(): void` as identical and reports zero optional members for every
 *     input. That is silent: the scan passes, and its floor can never fail. `postfixToken` carries
 *     the `QuestionToken` and additionally distinguishes an optional MEMBER from a required member
 *     with an optional PARAMETER, which `questionToken` on the parameter would conflate.
 *
 * Everything else the scans rely on — `node.parent`, `pos`/`end`, `getStart()`, `getText()`,
 * `getLineAndCharacterOfPosition()`, `modifiers`, `heritageClauses`, `elements`, `.text` on
 * identifiers and string literals — is present with the same names and the same semantics.
 * `SyntaxKind`, `ScriptTarget` and `ScriptKind` carry the same numeric values as the legacy enums.
 *
 * COST. A parse is one RPC round-trip, ~4.8 ms, against ~0.8 ms for the in-process legacy parser.
 * That is paid per FILE, and the three CI scans parse tens of files each; the repo-wide audit
 * parses ~1830 and takes a few seconds. Batching is possible (opening many files in one snapshot
 * is near legacy parity) but is deliberately not done: it would change each scan's control flow,
 * and the point of this migration is that the finding sets stay bit-identical.
 */

import { ScriptKind, ScriptTarget, SyntaxKind } from '@typescript/native-preview/unstable/ast';
import * as guards from '@typescript/native-preview/unstable/ast/is';
import { API } from '@typescript/native-preview/unstable/sync';

export { ScriptKind, ScriptTarget, SyntaxKind };

/**
 * A directory no tsconfig in this repo covers, so every file presented here resolves to tsgo's
 * inferred project rather than pulling a configured project into memory.
 */
const VIRTUAL_ROOT = '/__robota_ts_ast__';

/** Virtual path → source text. Only the files this module has parsed are ever present. */
const virtualFiles = new Map();

/** Lazily created — a scan that never parses must never pay for spawning the server. */
let api;
/** The single file kept open at a time; closed when the next parse opens its successor. */
let openFile;
let parseCounter = 0;

function ensureApi() {
  if (api !== undefined) return api;
  api = new API({
    cwd: VIRTUAL_ROOT,
    fs: {
      readFile: (fileName) => (virtualFiles.has(fileName) ? virtualFiles.get(fileName) : undefined),
      fileExists: (fileName) => (virtualFiles.has(fileName) ? true : undefined),
      directoryExists: (dir) => (dir === VIRTUAL_ROOT ? true : undefined),
      getAccessibleEntries: (dir) =>
        dir === VIRTUAL_ROOT
          ? {
              files: [...virtualFiles.keys()].map((f) => f.slice(VIRTUAL_ROOT.length + 1)),
              directories: [],
            }
          : undefined,
      realpath: (p) => (virtualFiles.has(p) ? p : undefined),
    },
  });
  // The RPC channel unrefs the tsgo child and its stdio, so leaving the API open does not keep the
  // host process (or a vitest worker) alive. No explicit shutdown is needed.
  return api;
}

/**
 * The virtual file extension that makes the parser use a given script kind. When the caller does
 * not state a kind, the legacy parser infers it from the file name — so this mirrors that, keeping
 * `.tsx` callers (audit-implements) on TSX and explicit-`ScriptKind.TS` callers
 * (check-spec-public-surface, which parses `.tsx` entry files AS TS) on exactly what they asked for.
 */
function extensionFor(fileName, scriptKind) {
  if (scriptKind === ScriptKind.TSX) return '.tsx';
  if (scriptKind === ScriptKind.TS) return '.ts';
  if (scriptKind === ScriptKind.JSX) return '.jsx';
  if (scriptKind === ScriptKind.JS) return '.js';
  return /\.tsx$/i.test(fileName) ? '.tsx' : '.ts';
}

/**
 * Parse one source string into a `SourceFile`, legacy-signature-compatible.
 *
 * `languageVersion` and `setParentNodes` are accepted and ignored: the native parser is always at
 * the latest language version, and always populates `parent`. They are kept in the signature so
 * call sites read the same as they did before the migration.
 *
 * @param {string} fileName reporting name; also the script-kind hint when `scriptKind` is omitted
 * @param {string} sourceText
 * @param {number} [languageVersion] ignored (always latest)
 * @param {boolean} [setParentNodes] ignored (parents are always set)
 * @param {number} [scriptKind] a {@link ScriptKind}; inferred from `fileName` when omitted
 */
export function createSourceFile(
  fileName,
  sourceText,
  languageVersion,
  setParentNodes,
  scriptKind,
) {
  const client = ensureApi();
  const virtualPath = `${VIRTUAL_ROOT}/p${parseCounter++}${extensionFor(fileName, scriptKind)}`;
  virtualFiles.set(virtualPath, sourceText);

  const snapshot = client.updateSnapshot({
    openFiles: [virtualPath],
    closeFiles: openFile === undefined ? undefined : [openFile],
    fileChanges: { created: [virtualPath] },
  });

  const previous = openFile;
  openFile = virtualPath;
  if (previous !== undefined) virtualFiles.delete(previous);

  const project = snapshot.getDefaultProjectForFile(virtualPath);
  const sourceFile = project?.program.getSourceFile(virtualPath);
  if (sourceFile === undefined) {
    throw new Error(`ts-ast: the native parser returned no source file for ${fileName}`);
  }
  return sourceFile;
}

/**
 * Free-function `forEachChild`, matching the legacy call shape. The native AST exposes this only as
 * a node method.
 */
export function forEachChild(node, visitor, visitArray) {
  return node.forEachChild(visitor, visitArray);
}

/**
 * True when an `ImportClause` is `import type { … }`.
 *
 * The native AST's DECLARED encoding of the import phase is `phaseModifier` —
 * `SyntaxKind.TypeKeyword` for `import type`, `SyntaxKind.DeferKeyword` for `import defer`. The
 * legacy `isTypeOnly` boolean is not part of `ImportClause`'s declared surface here (see note 2 in
 * the module header), so call sites read the phase through this helper.
 */
export function isTypeOnlyImportClause(clause) {
  return clause?.phaseModifier === SyntaxKind.TypeKeyword;
}

// The `isXxx` type guards the four scans actually use, re-exported so call sites read
// `ts.isClassDeclaration` exactly as they did against the legacy API. This is a deliberate subset of
// the package's 347, not a re-export of all of them: each name here is checked at import time
// (below), and that check is only meaningful for guards we have a call site for.
export const {
  isArrayBindingPattern,
  isArrowFunction,
  isAsExpression,
  isBinaryExpression,
  isBindingElement,
  isBreakStatement,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isContinueStatement,
  isElementAccessExpression,
  isEnumDeclaration,
  isEnumMember,
  isExportDeclaration,
  isExportSpecifier,
  isExternalModuleReference,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportSpecifier,
  isImportTypeNode,
  isInterfaceDeclaration,
  isLabeledStatement,
  isLiteralTypeNode,
  isMethodDeclaration,
  isModuleDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isNonNullExpression,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isQualifiedName,
  isSetAccessorDeclaration,
  isStringLiteral,
  isSwitchStatement,
  isTypeAliasDeclaration,
  isTypeParameterDeclaration,
  isTypeReferenceNode,
  isVariableDeclaration,
  isVariableStatement,
} = guards;

/**
 * Three guards the native package RENAMED. Each is a pure rename — the native body is the identical
 * single `node.kind === SyntaxKind.X` test as the legacy one (`Parameter`, `MethodSignature`,
 * `PropertySignature` respectively), so aliasing them back to the legacy names is exact, not
 * approximate. They are listed separately rather than folded into the block above precisely so the
 * rename stays visible at the swap point.
 */
export const isParameter = guards.isParameterDeclaration;
export const isMethodSignature = guards.isMethodSignatureDeclaration;
export const isPropertySignature = guards.isPropertySignatureDeclaration;

/**
 * Fail LOUDLY, at import time, if the pinned dev build stops exporting a guard this module
 * re-exports.
 *
 * This is the anti-rot mechanism for the whole migration. Destructuring a name the package no
 * longer exports yields `undefined`, not an error — and `undefined` only throws if that guard is
 * reached on some code path. A guard used on a rare branch could therefore go missing and turn a
 * scan into a quieter version of itself, which is indistinguishable from "the tree got cleaner".
 * That is exactly the failure this migration had to rule out, so it is checked mechanically here
 * rather than trusted. Three guards were ALREADY renamed by the native package
 * (`isParameter` → `isParameterDeclaration`, and the two `*Signature` ones); this check is what
 * turns the next such rename into an immediate, obvious failure at the swap point.
 */
{
  const exported = {
    isArrayBindingPattern,
    isArrowFunction,
    isAsExpression,
    isBinaryExpression,
    isBindingElement,
    isBreakStatement,
    isCallExpression,
    isClassDeclaration,
    isClassExpression,
    isContinueStatement,
    isElementAccessExpression,
    isEnumDeclaration,
    isEnumMember,
    isExportDeclaration,
    isExportSpecifier,
    isExternalModuleReference,
    isFunctionDeclaration,
    isFunctionExpression,
    isGetAccessorDeclaration,
    isIdentifier,
    isImportClause,
    isImportDeclaration,
    isImportEqualsDeclaration,
    isImportSpecifier,
    isImportTypeNode,
    isInterfaceDeclaration,
    isLabeledStatement,
    isLiteralTypeNode,
    isMethodDeclaration,
    isMethodSignature,
    isModuleDeclaration,
    isNamedExports,
    isNamedImports,
    isNamespaceImport,
    isNoSubstitutionTemplateLiteral,
    isNonNullExpression,
    isObjectBindingPattern,
    isObjectLiteralExpression,
    isParameter,
    isParenthesizedExpression,
    isPropertyAccessExpression,
    isPropertyAssignment,
    isPropertyDeclaration,
    isPropertySignature,
    isQualifiedName,
    isSetAccessorDeclaration,
    isStringLiteral,
    isSwitchStatement,
    isTypeAliasDeclaration,
    isTypeParameterDeclaration,
    isTypeReferenceNode,
    isVariableDeclaration,
    isVariableStatement,
  };
  const missing = Object.keys(exported).filter((name) => typeof exported[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(
      `ts-ast: @typescript/native-preview no longer exports ${missing.length} AST guard(s) this ` +
        `adapter re-exports: ${missing.join(', ')}. The pinned dev build has moved underneath the ` +
        `harness scans. Re-map each name against 'unstable/ast/is' here — do NOT drop the guard ` +
        `from the call site, which would silently weaken the scan that uses it.`,
    );
  }
}
