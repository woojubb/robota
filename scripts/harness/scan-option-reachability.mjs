#!/usr/bin/env node

/**
 * A declared option that nothing ever sets is a capability that cannot fire.
 *
 * WHY THIS EXISTS, measured (ARCH-013). `ICreateSessionOptions` declares `guardrails` and
 * `retrievalAdapter`; both are read at the consuming end (`create-session.ts:147-161`,
 * `create-tools.ts:72-74`) and **no production code anywhere assigns either**. Two shipped,
 * documented capabilities — SELFHOST-005 and SELFHOST-003 — that no shipped surface can turn on.
 * Nothing failed, nothing logged, and both were recorded as delivered.
 *
 * The cause is not the two fields. It is that the projection from resolved intent into session
 * options is hand-written at several sites and mechanically checked at none, so a field added
 * anywhere in the chain is silently dropped everywhere it was not remembered. `IResolvedPresetOptions`
 * even states the invariant in a comment — "Every field maps to an existing agent-framework
 * session/assembly seam" — which is precisely the shape of claim that stops the next reader from
 * checking.
 *
 * WHAT IT CHECKS. For each configured interface, every declared property must be set on an object
 * literal that either (a) is passed to one of that interface's configured CONSTRUCTORS — for
 * `ICreateSessionOptions`, `createSession` — or (b) is returned by a function that DECLARES it
 * returns the interface. Conditional spreads — `...(x !== undefined ? { key: x } : {})`, how this
 * repository writes an optional field — are descended into, because their keys are statically
 * visible.
 *
 * Case (b) exists because extracting the literal into a named builder is this repository's own remedy
 * for a projection buried in an implementation file, and the first version reported all 39 assigned
 * keys as unreachable the moment ARCH-013 performed that extraction.
 *
 * The first version matched property names anywhere in the tree, and MEASURED on this repository it
 * found 1 of the 12 keys that are actually unreachable: `guardrails` also names a property of an
 * unrelated zod schema and `retrievalAdapter` a key of the tool-assembly options, so both looked
 * set. Scoping to the constructor is what makes the answer mean anything.
 *
 * WHAT IT CANNOT DO, stated so a pass is not over-read:
 *
 * - Constructors are matched by CALLEE NAME and producers by their declared RETURN TYPE. A
 *   same-named function in another package counts; a constructor invoked through a variable, or a
 *   builder with an inferred return type, does not.
 * - A spread whose keys cannot be read — `...base`, a call result — is reported as OPAQUE rather
 *   than assumed empty or assumed complete. Guessing either way would make the count untrustworthy
 *   in a direction nobody could see.
 * - A key set only in tests is not an assignment. That is deliberate: a capability only a test can
 *   turn on is exactly the defect.
 * - Setting a key is not the same as it having an effect. A value passed and then ignored downstream
 *   still counts here.
 *
 * A RATCHET, NOT A BAN. The keys that are unreachable today are frozen in
 * `option-reachability-baseline.json`. The set may shrink and must never grow: a new declared option
 * with no setter fails immediately, and a repair must be re-frozen in the same change so the gain is
 * locked. Banning outright would be unlandable today and would be suppressed rather than obeyed.
 *
 * NEUTRAL BY CONSTRUCTION: the interfaces it watches are data in `.agents/harness.config.json` →
 * `optionReachability`, so another repository names its own and changes no code here.
 *
 * FAIL-CLOSED: the declaring file of every configured interface must exist, and the interface must be
 * found in it. A run that could not read the declarations reports that rather than a pass.
 *
 * Exit code 0 = the unreachable set matches the frozen baseline, 1 = it grew, shrank, or could not
 * be measured.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ScriptTarget,
  SyntaxKind,
  createSourceFile,
  forEachChild,
  isBinaryExpression,
  isIdentifier,
  isInterfaceDeclaration,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignature,
  isStringLiteral,
  isTypeReferenceNode,
} from './lib/ts-ast.mjs';

import { loadHarnessConfig } from './harness-config.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const BASELINE_PATH = path.join(
  WORKSPACE_ROOT,
  'scripts/harness/option-reachability-baseline.json',
);
const SOURCE_ROOTS = ['packages', 'apps'];

/** A file that ships. Tests, fixtures and build output are not production setters. */
function isProductionSource(file) {
  return (
    /\.(ts|tsx)$/.test(file) &&
    !/\.(test|spec|bintest)\.tsx?$/.test(file) &&
    !file.includes(`${path.sep}__tests__${path.sep}`) &&
    !file.includes(`${path.sep}__fixtures__${path.sep}`) &&
    !file.includes(`${path.sep}testing${path.sep}`) &&
    !file.includes(`${path.sep}dist${path.sep}`) &&
    !file.includes(`${path.sep}node_modules${path.sep}`)
  );
}

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (isProductionSource(full)) out.push(full);
  }
  return out;
}

function parse(file, source) {
  return createSourceFile(file, source, ScriptTarget.Latest, true);
}

/** The declared property names of a named interface, or null when the interface is not in the file. */
export function declaredKeys(source, fileName, interfaceName) {
  const ast = parse(fileName, source);
  let keys = null;
  const visit = (node) => {
    if (isInterfaceDeclaration(node) && node.name.getText(ast) === interfaceName) {
      keys = [];
      for (const member of node.members) {
        if (!isPropertySignature(member)) continue;
        const name = member.name;
        if (isIdentifier(name)) keys.push(name.text);
        else if (isStringLiteral(name)) keys.push(name.text);
      }
    }
    forEachChild(node, visit);
  };
  visit(ast);
  return keys;
}

/**
 * The keys an object literal sets, following the shapes a real options literal is built from.
 *
 * A conditional spread — `...(x !== undefined ? { key: x } : {})` — is how this repository writes an
 * optional field, and its keys are statically visible, so spreads of object literals, conditionals
 * and `&&`/`??` chains are descended into. A spread of an IDENTIFIER or a call (`...base`) is not:
 * its keys cannot be read here, so the literal is marked OPAQUE and reported rather than silently
 * treated as setting nothing. Guessing in either direction would make the result a number nobody can
 * trust.
 */
function literalKeys(node, into, opaque) {
  for (const property of node.properties) {
    if (
      isPropertyAssignment(property) ||
      property.kind === SyntaxKind.ShorthandPropertyAssignment
    ) {
      const name = property.name;
      if (name !== undefined && (isIdentifier(name) || isStringLiteral(name))) into.add(name.text);
      continue;
    }
    if (property.kind === SyntaxKind.SpreadAssignment) {
      spreadKeys(property.expression, into, opaque);
    }
  }
}

/** The keys a spread can contribute, or a note that they cannot be decided. */
function spreadKeys(expression, into, opaque) {
  if (expression.kind === SyntaxKind.ObjectLiteralExpression) {
    literalKeys(expression, into, opaque);
    return;
  }
  if (expression.kind === SyntaxKind.ParenthesizedExpression) {
    spreadKeys(expression.expression, into, opaque);
    return;
  }
  if (expression.kind === SyntaxKind.ConditionalExpression) {
    spreadKeys(expression.whenTrue, into, opaque);
    spreadKeys(expression.whenFalse, into, opaque);
    return;
  }
  if (isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (
      op === SyntaxKind.AmpersandAmpersandToken ||
      op === SyntaxKind.BarBarToken ||
      op === SyntaxKind.QuestionQuestionToken
    ) {
      spreadKeys(expression.left, into, opaque);
      spreadKeys(expression.right, into, opaque);
      return;
    }
  }
  // `...base` — the keys are somewhere else entirely.
  opaque.push(expression.getText().slice(0, 60));
}

/**
 * Keys set on object literals that reach a configured CONSTRUCTOR — an argument to one of the named
 * calls, or a literal annotated with the interface.
 *
 * Matching by name across the whole tree was the first version and it under-reported badly: measured
 * on this repository it found 1 of the 11 keys the audit names, because `guardrails` also appears as
 * a property of an unrelated zod schema and `retrievalAdapter` as a key of the tool-assembly options.
 * A read (`options.key`) is never an assignment; the defect is a field read everywhere and written
 * nowhere.
 */
export function assignedKeys(
  source,
  fileName,
  constructorNames,
  into = new Set(),
  opaque = [],
  interfaceName = undefined,
) {
  const ast = parse(fileName, source);
  const calls = new Set(constructorNames);
  const visit = (node) => {
    // A PRODUCER: a function that declares it returns the interface. Extracting an options literal
    // into such a function is the repository's own remedy for a projection buried in an
    // implementation file — and the first version of this scan reported all 39 assigned keys as
    // unreachable the moment that extraction happened, which is how this branch came to exist.
    if (interfaceName !== undefined && returnsInterface(node, ast, interfaceName)) {
      collectReturnedLiterals(node, into, opaque);
    }
    if (node.kind === SyntaxKind.CallExpression) {
      const callee = node.expression;
      const name = isIdentifier(callee)
        ? callee.text
        : isPropertyAccessExpression(callee)
          ? callee.name.getText(ast)
          : undefined;
      if (name !== undefined && calls.has(name)) {
        for (const argument of node.arguments) {
          if (argument.kind === SyntaxKind.ObjectLiteralExpression) {
            literalKeys(argument, into, opaque);
          }
        }
      }
    }
    forEachChild(node, visit);
  };
  visit(ast);
  return into;
}

/**
 * True when a function-like node's declared return type names the interface.
 *
 * `Pick<I, …>` counts. A function that declares it returns a Pick of the interface is producing a
 * DECLARED projection of it — the same vocabulary `scan-preset-projection.mjs` uses — and the keys it
 * sets are as reachable as those set by a producer returning the whole thing. Before this, extracting
 * a group of keys into a helper typed by its `Pick` made every one of them read as unassigned, which
 * reports a refactor as a missing capability: a false finding that pushes people back toward the
 * monolith the size floor is trying to break up.
 */
function returnsInterface(node, ast, interfaceName) {
  const type = node.type;
  if (type === undefined || !isTypeReferenceNode(type)) return false;
  const kind = node.kind;
  if (
    kind !== SyntaxKind.FunctionDeclaration &&
    kind !== SyntaxKind.MethodDeclaration &&
    kind !== SyntaxKind.ArrowFunction &&
    kind !== SyntaxKind.FunctionExpression
  ) {
    return false;
  }
  if (type.typeName.getText(ast) === interfaceName) return true;
  // Only the FIRST type argument names the source of a `Pick`; the second lists the keys.
  const [source] = type.typeArguments ?? [];
  return (
    type.typeName.getText(ast) === 'Pick' &&
    source !== undefined &&
    isTypeReferenceNode(source) &&
    source.typeName.getText(ast) === interfaceName
  );
}

/** Every object literal a producer returns, including through a conditional. */
function collectReturnedLiterals(node, into, opaque) {
  const walk = (child) => {
    if (child.kind === SyntaxKind.ReturnStatement && child.expression !== undefined) {
      spreadKeys(child.expression, into, opaque);
      return;
    }
    forEachChild(child, walk);
  };
  if (node.body !== undefined) {
    if (node.body.kind === SyntaxKind.ObjectLiteralExpression) literalKeys(node.body, into, opaque);
    else forEachChild(node.body, walk);
  }
}

/**
 * Keys declared by each configured interface that no production file assigns.
 *
 * `configs` defaults to the live configuration so that a caller handing only a root — which is how
 * the guard-scope floor invokes every finder — exercises the REAL fail-closed path. Without the
 * default it threw `TypeError: Cannot read properties of undefined`, which still counted as "threw"
 * and so still satisfied that floor, while the behaviour recorded beside the classification was not
 * the behaviour that fired. Caught in review; the measurement had been taken with two arguments.
 */
export function findUnreachableOptions(root, configs = liveConfigs()) {
  if (configs.length === 0) return { unreachable: {}, examined: 0 };

  const declared = new Map();
  for (const config of configs) {
    const file = path.join(root, config.file);
    if (!existsSync(file)) {
      // Fail closed: a missing declaration file means the scan could not judge, not that all is well.
      throw new Error(
        `option-reachability: ${config.file} does not exist under ${root} — the declarations for ` +
          `${config.name} could not be read.`,
      );
    }
    const keys = declaredKeys(readFileSync(file, 'utf8'), file, config.name);
    if (keys === null) {
      throw new Error(
        `option-reachability: interface ${config.name} was not found in ${config.file}. Either it ` +
          'was renamed and the config is stale, or the parse failed — both are errors, not passes.',
      );
    }
    declared.set(config.name, { keys, config });
  }

  const roots = SOURCE_ROOTS.map((dir) => path.join(root, dir)).filter((dir) => existsSync(dir));
  if (roots.length === 0) {
    throw new Error(
      `option-reachability: none of ${SOURCE_ROOTS.join(', ')} exist under ${root} — no production ` +
        'source could be examined.',
    );
  }
  const files = roots.flatMap((dir) => sourceFiles(dir));

  // One pass over the tree collecting every assigned name, rather than one pass per interface.
  const assigned = new Map();
  const opaque = new Map();
  for (const config of configs) {
    const seen = new Set();
    const unknown = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const mentions =
        config.constructors.some((name) => source.includes(name)) || source.includes(config.name);
      if (!mentions) continue;
      assignedKeys(source, file, config.constructors, seen, unknown, config.name);
    }
    assigned.set(config.name, seen);
    opaque.set(config.name, unknown);
  }

  const unreachable = {};
  for (const [name, { keys, config }] of declared) {
    const allow = new Set(config.allow ?? []);
    const seen = assigned.get(name) ?? new Set();
    const missing = keys.filter((key) => !seen.has(key) && !allow.has(key));
    if (missing.length > 0) unreachable[name] = missing.sort();
  }
  return {
    unreachable,
    examined: files.length,
    opaque: Object.fromEntries([...opaque].filter(([, list]) => list.length > 0)),
  };
}

function liveConfigs() {
  return loadHarnessConfig().optionReachability ?? [];
}

function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};
}

function main() {
  const configured = liveConfigs();
  if (configured.length === 0) {
    console.log(
      'option-reachability: NO INTERFACES CONFIGURED (.agents/harness.config.json) — nothing was checked.',
    );
    return;
  }

  const { unreachable, examined, opaque } = findUnreachableOptions(WORKSPACE_ROOT, configured);
  const baseline = loadBaseline();

  const grown = [];
  const shrunk = [];
  for (const { name } of configured) {
    const frozen = new Set(baseline[name] ?? []);
    const found = unreachable[name] ?? [];
    const isNew = found.filter((key) => !frozen.has(key));
    const fixed = [...frozen].filter((key) => !found.includes(key));
    if (isNew.length > 0) grown.push({ name, keys: isNew });
    if (fixed.length > 0) shrunk.push({ name, keys: fixed });
  }

  if (grown.length > 0) {
    console.error(`option-reachability scan failed: ${grown.length} interface(s) grew:`);
    for (const { name, keys } of grown) {
      console.error(
        `- [option-declared-never-set] ${name}: ${keys.map((k) => `\`${k}\``).join(', ')} ` +
          'declared, and no production code assigns it. A capability nothing can turn on is not ' +
          'delivered — wire it from the surface that owns it, or remove the declaration.',
      );
    }
    process.exitCode = 1;
    return;
  }
  if (shrunk.length > 0) {
    console.error(
      'option-reachability: the unreachable set SHRANK ' +
        `(${shrunk.map(({ name, keys }) => `${name}: ${keys.join(', ')}`).join('; ')}). ` +
        'Re-freeze it in the SAME change — `node scripts/harness/scan-option-reachability.mjs ' +
        '--write-baseline` — or the gain is a licence to drop them again.',
    );
    process.exitCode = 1;
    return;
  }

  for (const [name, spreads] of Object.entries(opaque)) {
    // Not a failure — a stated limit on what the number below means.
    console.log(
      `option-reachability: ${name} has ${spreads.length} spread(s) whose keys could not be read ` +
        `(${[...new Set(spreads)].slice(0, 3).join(', ')}). Keys they carry are invisible here.`,
    );
  }

  const total = Object.values(unreachable).reduce((sum, keys) => sum + keys.length, 0);
  console.log(
    `option-reachability scan passed (${configured.length} interface(s), ${total} key(s) ` +
      `unreachable at baseline, ${examined} production file(s) examined).`,
  );
}

function writeBaseline() {
  const { unreachable } = findUnreachableOptions(WORKSPACE_ROOT, liveConfigs());
  writeFileSync(BASELINE_PATH, `${JSON.stringify(unreachable, null, 2)}\n`);
  console.log(`option-reachability baseline regenerated: ${JSON.stringify(unreachable)}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
