#!/usr/bin/env node

/**
 * ARCH-005 — the composition-neutrality mechanical floor. Enforces the three R1 guards that make the
 * `agent-product` L129 carve-out safe: `assembleProduct` may be a published, shared assembler ONLY while it
 * remains a pure, IO-free, product-neutral fold. The amended project-structure L129 rule is COUPLED to
 * these guards — the rule relaxation is only ever true while they hold. A guard that is EVADABLE is a rule
 * that is not enforced, so the checks are AST-based (HARNESS-048), not line-regex based.
 *
 * For each package listed under `compositionNeutrality` in `.agents/harness.config.json`, three checks:
 *
 *  (a) Dependency-graph neutrality — the package's `package.json` declares NO concrete transport/TUI/CLI
 *      dependency (exact names in `forbiddenDependencies`, prefix matches in `forbiddenDependencyPrefixes`)
 *      in dependencies/devDependencies/peerDependencies. The assembler must never pull a concrete
 *      transport, the TUI, or the CLI — those are injected via the profile.
 *  (b) Purity / no-IO — no `src/` file imports a forbidden IO module (`node:fs`, …) or uses a forbidden
 *      IO identifier (`process.env`, settings/file readers). All resolved data is fed IN from the shell.
 *  (c) No product-name conditionals — no `src/` file branches on a product identity (`.id` / `.agentName`).
 *      Four forms are banned, because equality is only the most obvious way to special-case one product:
 *      equality against a literal (`X.id === '…'`, `!==`, backticks), a `switch` on the identity, a string
 *      predicate (`X.id.startsWith/includes/endsWith/match(…)`), and a lookup table keyed by the identity
 *      (`TABLE[X.id]`). This is what upgrades "profile-driven" into "hard-codes no product's choices".
 *
 * HARNESS-048 — why the parser, not a regex. The ARCH-005 S2 conformance audit planted a probe file with a
 * destructured identity (`const { id } = profile`), an aliased one (`const a = profile.id`), the bracket
 * form of a banned global (`globalThis['process'].env['HOME']`), an aliased `process`, a computed identity
 * index, a dynamic `import()`, and a member access split over lines — and the line-regex scan still printed
 * "passed". Parsing each file with the TypeScript compiler API (already a workspace devDependency — no new
 * parser dep) removes that whole evasion class at once: syntax, not text. Two syntactic resolutions do the
 * real work — an ALIAS map (`const proc = process` → `proc.env` reads as `process.env`) and static
 * bracket→dot normalisation (`x['id']` reads as `x.id`) — plus destructured bindings of `id`/`agentName`
 * being tracked as identity aliases, which is the evasion a contributor is most likely to hit ACCIDENTALLY.
 * Comments need no special-casing: the parser does not produce nodes for them.
 *
 * A configured package whose `src/` or `package.json` is missing is a hard SCAN-TARGET-MISSING finding, not
 * a silent pass (mirrors the check-dependency-direction purity guard — a dead guard is a defect).
 *
 * The content checks are exported as pure functions so the test can prove each guard FAILS on a planted
 * violation. Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import * as ts from './lib/ts-ast.mjs';
import { listSourceFiles } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * Collect all `.ts`/`.tsx` files under a src tree (tests included — the guard is total), relative to root.
 *
 * HARNESS-062: the walk is the shared lister; `excludeTests: false` states the "the guard is total"
 * intent as an option rather than as an omission from a private exclusion set. Measured on the real
 * tree when routed: 2443 files before, 2443 after.
 */
function walkTsFiles(target, root = WORKSPACE_ROOT) {
  const full = path.join(root, target);
  return listSourceFiles(full, { excludeTests: false, extensions: ['.ts', '.tsx'] }).map((file) =>
    path.relative(root, file),
  );
}

/** (a) Forbidden dependencies declared in a manifest (exact names + prefix matches). Pure. */
export function findForbiddenDependencies(manifest, rule) {
  const findings = [];
  const exact = new Set(rule.forbiddenDependencies ?? []);
  const prefixes = rule.forbiddenDependencyPrefixes ?? [];
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const deps = manifest[section];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      const prefixHit = prefixes.find((prefix) => dep.startsWith(prefix));
      if (exact.has(dep) || prefixHit !== undefined) {
        findings.push({
          kind: 'forbidden-dependency',
          id: dep,
          detail: `declared in [${section}]`,
        });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Syntax helpers — the shared AST vocabulary both content guards read.
// ---------------------------------------------------------------------------

/** Parse one source string. `setParentNodes` is required: the guards walk upward to reject declarations. */
function parseSource(source, file) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

/** Every node in the tree, in source order. Comments produce no nodes — the guards ignore them for free. */
function collectNodes(root) {
  const out = [];
  const visit = (node) => {
    out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out;
}

/** The compile-time-constant string a node denotes (`'x'`, `` `x` ``), or undefined. */
function staticString(node) {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Strip the wrappers that do not change what an expression denotes (`(x)`, `x!`, `x as T`). */
function unwrap(node) {
  let current = node;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The dotted access path an expression denotes, as segments, or undefined when it is not a static access.
 * Bracket access with a literal key normalises to a dot segment (`globalThis['process']` → `globalThis`,
 * `process`), and a known alias expands to the path it was bound to (`proc` → `process`). These two
 * normalisations are what close the bracket/alias evasions.
 */
function accessPath(node, aliases) {
  const target = unwrap(node);
  if (target === undefined) return undefined;
  if (ts.isIdentifier(target)) {
    const alias = aliases.get(target.text);
    return alias === undefined ? [target.text] : [...alias];
  }
  if (ts.isPropertyAccessExpression(target)) {
    const base = accessPath(target.expression, aliases);
    if (base === undefined || !ts.isIdentifier(target.name)) return undefined;
    return [...base, target.name.text];
  }
  if (ts.isElementAccessExpression(target)) {
    const base = accessPath(target.expression, aliases);
    const key = staticString(target.argumentExpression);
    if (base === undefined || key === undefined) return undefined;
    return [...base, key];
  }
  return undefined;
}

const IDENTITY_PROPS = new Set(['id', 'agentName']);

function isBindingPattern(node) {
  return ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node);
}

/**
 * Bind each name a destructuring pattern introduces: to its full path, and to the identity set when apt.
 * Recurses into nested patterns, so `const { profile: { id } } = opts` is as visible as `const { id } =
 * profile`. An ARRAY pattern binds by position and so contributes no named segment — the path stops being
 * resolvable there, but the identity binding is still tracked.
 */
function bindPattern(pattern, basePath, aliases, identityLocals) {
  const bindsByName = ts.isObjectBindingPattern(pattern);
  for (const element of pattern.elements) {
    if (!ts.isBindingElement(element) || element.dotDotDotToken !== undefined) continue;
    // An ARRAY HOLE (`const [, b] = xs`) introduces no binding, so there is nothing to track. The
    // two parsers spell it differently — the legacy AST emits an `OmittedExpression` (which
    // `isBindingElement` already rejected above), the native one a `BindingElement` with no `name`
    // — and this skip makes both reach the same place.
    if (element.name === undefined) continue;
    let key;
    if (bindsByName) {
      const keyNode = element.propertyName ?? element.name;
      key = ts.isIdentifier(keyNode) ? keyNode.text : staticString(keyNode);
      if (key === undefined) continue;
    }
    const childPath = basePath === undefined || key === undefined ? undefined : [...basePath, key];
    if (ts.isIdentifier(element.name)) {
      if (childPath !== undefined) aliases.set(element.name.text, childPath);
      if (key !== undefined && IDENTITY_PROPS.has(key)) identityLocals.add(element.name.text);
    } else if (isBindingPattern(element.name)) {
      bindPattern(element.name, childPath, aliases, identityLocals);
    }
  }
}

/**
 * File-level alias resolution. Deliberately scope-free (over-approximating): a guard may flag a shadowed
 * name, but it must never MISS a real one. `identityLocals` holds names destructured out of an `id` /
 * `agentName` property even when the source object is not statically resolvable.
 */
function collectAliases(nodes) {
  const aliases = new Map();
  const identityLocals = new Set();
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      const basePath = accessPath(node.initializer, aliases);
      if (ts.isIdentifier(node.name)) {
        if (basePath !== undefined) aliases.set(node.name.text, basePath);
      } else if (isBindingPattern(node.name)) {
        bindPattern(node.name, basePath, aliases, identityLocals);
      }
    } else if (ts.isParameter(node) && isBindingPattern(node.name)) {
      bindPattern(node.name, undefined, aliases, identityLocals);
    }
  }
  return { aliases, identityLocals };
}

/** 1-based line of a node's first token. */
function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/** A short, single-line rendering of a node's source — used to name the offender in the finding. */
function snippet(sourceFile, node) {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 60);
}

// ---------------------------------------------------------------------------
// (b) Purity / no-IO
// ---------------------------------------------------------------------------

/** The module string a node imports, whatever the import form (static, type, `export from`, dynamic, require). */
function moduleSpecifierOf(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return staticString(node.moduleSpecifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return staticString(node.moduleReference.expression);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return staticString(node.argument.literal);
  }
  if (ts.isCallExpression(node)) {
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (isDynamicImport || isRequire) return staticString(node.arguments[0]);
  }
  return undefined;
}

/** An identifier only READS a name here — declaration names and property keys are not IO edges. */
function isReferencePosition(node) {
  if (!ts.isIdentifier(node)) return true;
  const parent = node.parent;
  if (parent === undefined) return false;
  // `x.readSettings` — the member name is not a bare reference to the banned reader.
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) || ts.isTypeReferenceNode(parent)) return false;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent)
  ) {
    return false;
  }
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) {
    return false;
  }
  // Anything that DECLARES this name (`const readSettings = …`, `{ readSettings: … }`, `foo(readSettings)`
  // as a parameter, a method/property/type/enum member name, …).
  const declaresName =
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isModuleDeclaration(parent) ||
    ts.isTypeParameterDeclaration(parent);
  return !(declaresName && parent.name === node);
}

/** Longest forbidden identifier (as segments) that PREFIXES this access path, dotted — or undefined. */
function longestForbiddenPrefix(pathSegments, forbidden) {
  let best;
  for (const segments of forbidden) {
    if (segments.length > pathSegments.length) continue;
    if (!segments.every((segment, index) => segment === pathSegments[index])) continue;
    if (best === undefined || segments.length > best.length) best = segments;
  }
  return best === undefined ? undefined : best.join('.');
}

/** (b) IO violations in a source string — forbidden module imports + forbidden IO identifiers. Pure. */
export function findIoViolations(source, file, rule) {
  const sourceFile = parseSource(source, file);
  const nodes = collectNodes(sourceFile);
  const { aliases } = collectAliases(nodes);
  const lines = source.split('\n');
  const forbiddenImports = new Set(rule.forbiddenImports ?? []);
  const forbiddenIdentifiers = (rule.forbiddenIdentifiers ?? []).map((id) => id.split('.'));

  const record = (kind, id, node) => {
    const line = lineOf(sourceFile, node);
    return { kind, id, file, line, text: (lines[line - 1] ?? '').trim().slice(0, 120) };
  };

  const findings = [];
  const identifierHits = [];
  for (const node of nodes) {
    const specifier = moduleSpecifierOf(node);
    if (specifier !== undefined && forbiddenImports.has(specifier)) {
      findings.push(record('forbidden-io-import', specifier, node));
    }

    const isAccess =
      ts.isIdentifier(node) ||
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node);
    if (!isAccess || !isReferencePosition(node)) continue;
    const segments = accessPath(node, aliases);
    if (segments === undefined) continue;
    const hit = longestForbiddenPrefix(segments, forbiddenIdentifiers);
    if (hit !== undefined) identifierHits.push({ node, id: hit });
  }

  // `process.env.HOME` matches at both `process.env` and `process.env.HOME`; report the OUTERMOST access
  // only, so one read is one finding.
  const bySpanDescending = [...identifierHits].sort(
    (a, b) => b.node.end - b.node.pos - (a.node.end - a.node.pos),
  );
  const outermost = [];
  for (const hit of bySpanDescending) {
    const contained = outermost.some(
      (kept) =>
        kept.node.getStart(sourceFile) <= hit.node.getStart(sourceFile) &&
        kept.node.end >= hit.node.end,
    );
    if (!contained) outermost.push(hit);
  }
  for (const hit of outermost) findings.push(record('forbidden-io-identifier', hit.id, hit.node));

  return findings.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// (c) No product-name conditionals
// ---------------------------------------------------------------------------

/**
 * The ways a fold can special-case ONE product by its identity (`.id` / `.agentName`). Equality is only the
 * most obvious of them — a `switch`, a string predicate, or a lookup table keyed by the identity reaches the
 * same "hard-codes a product's choices" outcome, so all four forms are banned. Reading the identity as DATA
 * (`id: profile.id`, passing it through, comparing two ids to each other) stays legal: the guard bans
 * BRANCHING on a product's identity, not touching it.
 */
const STRING_PREDICATES = new Set(['startsWith', 'endsWith', 'includes', 'match', 'matchAll']);
const EQUALITY_OPERATORS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);

/** (c) Product-name conditionals in a source string. Pure. */
export function findProductNameConditionals(source, file) {
  const sourceFile = parseSource(source, file);
  const nodes = collectNodes(sourceFile);
  const { aliases, identityLocals } = collectAliases(nodes);
  const lines = source.split('\n');

  /** An expression that denotes a product identity — directly, via bracket form, or via an alias. */
  const isIdentity = (node) => {
    const target = unwrap(node);
    if (target === undefined) return false;
    const segments = accessPath(target, aliases);
    if (segments !== undefined && segments.length >= 2 && IDENTITY_PROPS.has(segments.at(-1))) {
      return true;
    }
    return ts.isIdentifier(target) && identityLocals.has(target.text);
  };

  const findings = [];
  const claimedLines = new Set();
  const add = (form, node, identityNode) => {
    const line = lineOf(sourceFile, node);
    // One finding per line — the fix is the same regardless of how many forms match.
    if (claimedLines.has(line)) return;
    claimedLines.add(line);
    findings.push({
      kind: 'product-name-conditional',
      id: form,
      file,
      line,
      detail: `branches on \`${snippet(sourceFile, identityNode)}\``,
      text: (lines[line - 1] ?? '').trim().slice(0, 120),
    });
  };

  for (const node of nodes) {
    if (ts.isBinaryExpression(node) && EQUALITY_OPERATORS.has(node.operatorToken.kind)) {
      if (staticString(unwrap(node.right)) !== undefined && isIdentity(node.left)) {
        add('equality', node, node.left);
      } else if (staticString(unwrap(node.left)) !== undefined && isIdentity(node.right)) {
        add('equality', node, node.right);
      }
      continue;
    }
    if (ts.isSwitchStatement(node) && isIdentity(node.expression)) {
      add('switch', node, node.expression);
      continue;
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const isProperty = ts.isPropertyAccessExpression(callee);
      const isElement = ts.isElementAccessExpression(callee);
      if (!isProperty && !isElement) continue;
      const method = isProperty
        ? ts.isIdentifier(callee.name)
          ? callee.name.text
          : undefined
        : staticString(callee.argumentExpression);
      if (method !== undefined && STRING_PREDICATES.has(method) && isIdentity(callee.expression)) {
        add('string-predicate', node, callee.expression);
      }
      continue;
    }
    if (ts.isElementAccessExpression(node) && isIdentity(node.argumentExpression)) {
      add('identity-index', node, node.argumentExpression);
    }
  }

  return findings.sort((a, b) => a.line - b.line);
}

/** Run all three checks over the configured packages against the real tree. */
export function scanCompositionNeutrality(
  root = WORKSPACE_ROOT,
  rules = loadHarnessConfig().compositionNeutrality ?? [],
) {
  const findings = [];
  for (const rule of rules) {
    const srcRel = path.join(rule.dir, 'src');
    const pkgJsonRel = path.join(rule.dir, 'package.json');
    const srcAbs = path.join(root, srcRel);
    const pkgJsonAbs = path.join(root, pkgJsonRel);

    if (!existsSync(srcAbs) || !statSync(srcAbs).isDirectory()) {
      findings.push({ kind: 'scan-target-missing', id: srcRel, detail: 'src/ dir does not exist' });
    }
    if (!existsSync(pkgJsonAbs)) {
      findings.push({
        kind: 'scan-target-missing',
        id: pkgJsonRel,
        detail: 'package.json does not exist',
      });
    }

    if (existsSync(pkgJsonAbs)) {
      const manifest = JSON.parse(readFileSync(pkgJsonAbs, 'utf8'));
      findings.push(
        ...findForbiddenDependencies(manifest, rule).map((f) => ({ ...f, dir: rule.dir })),
      );
    }

    if (existsSync(srcAbs)) {
      for (const rel of walkTsFiles(srcRel, root)) {
        const source = readFileSync(path.join(root, rel), 'utf8');
        findings.push(...findIoViolations(source, rel, rule));
        findings.push(...findProductNameConditionals(source, rel));
      }
    }
  }
  return findings;
}

/**
 * One report line. The offending dependency / identifier is ALWAYS printed: guard (a) has always recorded
 * WHICH dependency it found, but the old reporter dropped it and printed only the package directory.
 */
export function formatFinding(finding) {
  const location = finding.file ? `${finding.file}:${finding.line}` : (finding.dir ?? finding.id);
  const parts = [`  [${finding.kind}]`, location];
  if (finding.id !== undefined && finding.id !== location) parts.push(finding.id);
  const tail = [finding.detail, finding.text].filter(Boolean).join('  ·  ');
  if (tail) parts.push(`— ${tail}`);
  return parts.join('  ').trimEnd();
}

function main() {
  const findings = scanCompositionNeutrality();
  if (findings.length === 0) {
    console.log('composition-neutrality scan passed.');
    process.exit(0);
  }
  console.error(
    'composition-neutrality scan FAILED — a product-composition assembler broke a neutrality guard:',
  );
  for (const f of findings) console.error(formatFinding(f));
  console.error(
    '\nThe ARCH-005 L129 carve-out holds ONLY while the assembler stays pure, IO-free, and product-neutral:\n' +
      '  (a) no concrete transport/TUI/CLI dependency,\n' +
      '  (b) no fs/env/settings read in src (resolved data is fed in from the shell),\n' +
      '  (c) no product-identity BRANCH — equality (`X.id === "…"`), `switch (X.id)`,\n' +
      '      `X.id.startsWith/includes/endsWith(…)`, or a lookup table keyed by `X.id`.\n' +
      'Fix the assembler, not the guard.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
