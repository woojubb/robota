/**
 * INFRA-074 — which script does this module actually hand to a shell?
 *
 * ## The question this replaces
 *
 * The relation it serves used to answer "does this test execute this hook?" with two INDEPENDENT
 * text checks: the hook's basename appears somewhere in the comment-stripped source, AND the file
 * spawns `bash` somewhere. Nothing tied the spawn to the name, so a test that named hook A in real
 * code while spawning hook B counted as executing A. That was a fair trade while the answer only
 * fed an advisory coverage message; INFRA-071 gave it a second job — picking which tests may SET a
 * red-proof verdict — and a bystander could then supply a verdict about a hook it never ran.
 *
 * A narrower text pattern is not the fix, and that is measured rather than assumed: requiring the
 * name inside a `path.join(...)` missed every test that passes the basename to a helper which joins
 * it (`run('some-hook.sh', …)`), and those run the hook just as truly. The binding is a VALUE
 * FLOWING THROUGH A CALL, not a lexical adjacency, so the only thing that can answer it is the call
 * graph.
 *
 * ## What it does
 *
 * Parses the module, finds every real spawn call (a binding imported from `child_process` — a
 * `spawnSync('bash', …)` written inside a STRING LITERAL is not one), and resolves the expression
 * that names the executed file back through the module's own bindings: literals, template and `+`
 * concatenation, `path.join`/`path.resolve`, `const` initialisers, object and array literals,
 * `for…of` element bindings, destructuring, local function return values, and — this is the part
 * text could not do — a PARAMETER, by unioning the arguments at every call site of its function.
 *
 * ## Three answers, never a guess
 *
 * Resolution is partial by nature: a path built from `readdirSync()` cannot be pinned. Each spawn
 * target therefore resolves to one of three answers per script, and the caller decides what an
 * UNDETERMINED one is worth — the coverage floor treats it as covered (a floor that fires on
 * correct work gets switched off), the red-proof gate refuses to let it decide (a verdict from a
 * test that may not have run the subject is the defect this whole gate exists to catch).
 *
 * ## Stated limits
 *
 * - ONE MODULE. A module that spawned the script through a helper imported from another file would
 *   read as not executing it. Measured over `scripts/harness/__tests__` on 2026-08-01: four files
 *   name a hook without importing `child_process` at all, and none of them spawns anything through
 *   an imported helper. A false "not executed" is loud rather than silent — it makes the coverage
 *   floor FAIL — which is the right direction for a limit to fail in.
 * - REACHABILITY IS NOT MODELLED, exactly as it was not before: a spawn inside a branch that never
 *   runs still counts, and elements dropped by an intervening `.filter()` still count. The question
 *   is "does this module hand this script to an interpreter", not "does that line execute".
 * - BASENAME GRANULARITY. Two scripts with the same basename in different directories are one
 *   subject here.
 */

import path from 'node:path';

import * as ts from './ts-ast.mjs';

const K = ts.SyntaxKind;

/** The three answers. A caller that collapses UNDETERMINED into either of the others owns that choice. */
export const EXECUTION = Object.freeze({
  EXECUTES: 'executes',
  NOT_EXECUTED: 'not-executed',
  UNDETERMINED: 'undetermined',
});

/** Names from `child_process` that start a process. */
const SPAWN_FUNCTIONS = new Set([
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
]);

/**
 * Commands that RUN A FILE NAMED IN THEIR ARGUMENTS. Anything else — `git`, `pnpm`, `gh` — cannot
 * reach a script through its argv, so its unresolvable arguments raise no ambiguity at all. Without
 * this distinction every `spawnSync('git', ['-C', tmpDir, …])` in the suite would make its file
 * undetermined for every script, and the answer would be "don't know" everywhere.
 */
const INTERPRETERS = new Set([
  'bash',
  'sh',
  'dash',
  'zsh',
  'ksh',
  'node',
  'bun',
  'deno',
  'tsx',
  'python',
  'python3',
  'ruby',
  'perl',
]);

/** `node:path` members whose result this analysis can follow. */
const PATH_FUNCTIONS = new Set(['join', 'resolve', 'basename', 'normalize']);

/** Work budget. An adversarial or pathological module gets UNDETERMINED, never an infinite walk. */
const STEP_BUDGET = 200_000;

// ── The value domain ──────────────────────────────────────────────────────────────────────────────
//
// A candidate is a possible value of an expression, recorded as the part of the string that IS
// known: `{ text, complete }`. `complete` means the whole value is `text`; otherwise `text` is a
// known SUFFIX with unknown text in front of it — which is the common shape here, because
// `path.join(HOOKS_DIR, 'branch-guard.sh')` has an unknowable root and a decisive tail.

const NOTHING_KNOWN = Object.freeze({ text: '', complete: false });

function literal(text) {
  return { text, complete: true };
}

/** `a` followed by `b`. If `b`'s own head is unknown, everything before it is lost. */
function concatCandidates(left, right) {
  const out = [];
  for (const a of left) {
    for (const b of right) {
      out.push(b.complete ? { text: a.text + b.text, complete: a.complete } : b);
    }
  }
  return capped(out);
}

/** Bound the cross product so a module full of unions cannot blow up. */
function capped(candidates) {
  const seen = new Map();
  for (const c of candidates) {
    const key = `${c.complete ? '=' : '~'}${c.text}`;
    if (!seen.has(key)) seen.set(key, c);
    if (seen.size > 128) return [NOTHING_KNOWN];
  }
  return seen.size === 0 ? [NOTHING_KNOWN] : [...seen.values()];
}

/** `path.join(a, b)` — the separator is what makes a known tail decisive. */
function joinCandidates(parts) {
  let acc = [literal('')];
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) acc = concatCandidates(acc, [literal('/')]);
    acc = concatCandidates(acc, parts[i]);
  }
  return acc;
}

/**
 * Does a candidate name the file `basename`? Three answers, and the middle one is the point.
 *
 * A candidate with a `/` in its known tail has a KNOWN basename even when its head is unknown, so
 * it answers yes or no outright. One without a separator is a suffix of an unknown name — `.sh`
 * could be anything ending in `.sh` — and that is the only case that is genuinely undetermined.
 */
export function candidateNames(candidate, basename) {
  const { text, complete } = candidate;
  if (complete) return path.basename(text) === basename ? 'yes' : 'no';
  if (text.includes('/')) return text.slice(text.lastIndexOf('/') + 1) === basename ? 'yes' : 'no';
  return basename.endsWith(text) ? 'maybe' : 'no';
}

// ── Scope + binding index ─────────────────────────────────────────────────────────────────────────

/** Drop names the pinned parser does not define, so an absent kind can never match `node.kind`. */
function kindSet(names) {
  return new Set(names.map((name) => K[name]).filter((kind) => typeof kind === 'number'));
}

const SCOPE_KINDS = kindSet([
  'SourceFile',
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunction',
  'MethodDeclaration',
  'Constructor',
  'Block',
  'ForOfStatement',
  'ForInStatement',
  'ForStatement',
  'CatchClause',
  'CaseBlock',
  'ModuleBlock',
]);

const FUNCTION_KINDS = kindSet([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunction',
  'MethodDeclaration',
  'Constructor',
]);

function nearestScope(node) {
  for (let cur = node.parent; cur; cur = cur.parent) if (SCOPE_KINDS.has(cur.kind)) return cur;
  return null;
}

/**
 * Every name a module binds, with enough about each binding to resolve it later.
 *
 * Bindings are keyed by their enclosing scope NODE rather than flattened per module, because two
 * `it()` callbacks in the same file routinely bind the same `hook` to different scripts — flattening
 * them would union the two and report each test as running both.
 */
function indexBindings(sourceFile) {
  const scopes = new Map(); // scope node → Map(name → binding[])
  const spawnNames = new Map(); // local name → the child_process function it is bound to
  const spawnNamespaces = new Set(); // local names bound to `import * as cp from 'child_process'`
  const pathNames = new Map(); // local name → the node:path function it is bound to
  const pathNamespaces = new Set(); // local names bound to `import path from 'node:path'`

  const declare = (scope, name, binding) => {
    if (!scope || !name) return;
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    const byName = scopes.get(scope);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(binding);
  };

  const declarePattern = (scope, nameNode, make) => {
    if (!nameNode) return;
    if (nameNode.kind === K.Identifier) {
      declare(scope, nameNode.text, make(null));
      return;
    }
    if (nameNode.kind === K.ObjectBindingPattern) {
      for (const element of nameNode.elements ?? []) {
        if (!element?.name || element.name.kind !== K.Identifier) continue;
        const property = element.propertyName?.text ?? element.name.text;
        declare(scope, element.name.text, make(property));
      }
      return;
    }
    // Array destructuring is positional and nothing in this tree uses it for a script path; an
    // unresolvable binding is simply absent, and an absent binding resolves to "unknown".
  };

  const walk = (node) => {
    if (node.kind === K.ImportDeclaration) {
      collectModuleImports(node, ['node:child_process', 'child_process'], SPAWN_FUNCTIONS, {
        named: spawnNames,
        namespaces: spawnNamespaces,
      });
      collectModuleImports(node, ['node:path', 'path'], PATH_FUNCTIONS, {
        named: pathNames,
        namespaces: pathNamespaces,
      });
    }

    if (node.kind === K.VariableDeclaration) {
      const scope = nearestScope(node);
      const forOf = node.parent?.parent;
      if (forOf?.kind === K.ForOfStatement) {
        declarePattern(scope, node.name, (property) => ({
          kind: 'element',
          expression: forOf.expression,
          property,
        }));
      } else {
        declarePattern(scope, node.name, (property) => ({
          kind: 'value',
          expression: node.initializer,
          property,
        }));
        // `const run = (…) => …` is a callable binding as well as a value one.
        if (node.name?.kind === K.Identifier && isFunctionNode(node.initializer))
          declare(scope, node.name.text, { kind: 'function', node: node.initializer });
      }
    }

    if (node.kind === K.Parameter) {
      const fn = node.parent;
      if (FUNCTION_KINDS.has(fn?.kind)) {
        const index = (fn.parameters ?? []).indexOf(node);
        declarePattern(fn, node.name, (property) => ({
          kind: 'parameter',
          fn,
          index,
          property,
          fallback: node.initializer,
        }));
      }
    }

    if (node.kind === K.FunctionDeclaration && node.name?.kind === K.Identifier)
      declare(nearestScope(node), node.name.text, { kind: 'function', node });

    ts.forEachChild(node, walk);
  };
  walk(sourceFile);

  return { scopes, spawnNames, spawnNamespaces, pathNames, pathNamespaces };
}

function isFunctionNode(node) {
  return Boolean(node) && FUNCTION_KINDS.has(node.kind);
}

/**
 * Record what a module's bindings actually refer to.
 *
 * By BINDING, never by spelling. `resolve(HARNESS_DIR, name)` is `path.resolve` in one file and an
 * unrelated local in another; reading the import is the difference between resolving a path and
 * inventing one. `import path from 'node:path'` binds a namespace-like default, so both the default
 * clause and `import * as` are collected.
 */
function collectModuleImports(node, specifiers, functions, into) {
  const specifier = node.moduleSpecifier?.text;
  if (!specifiers.includes(specifier)) return;
  const clause = node.importClause;
  if (!clause) return;
  if (clause.name?.text) into.namespaces.add(clause.name.text); // `import path from 'node:path'`
  const bindings = clause.namedBindings;
  if (!bindings) return;
  if (bindings.kind === K.NamespaceImport) {
    if (bindings.name?.text) into.namespaces.add(bindings.name.text);
    return;
  }
  for (const element of bindings.elements ?? []) {
    const imported = element.propertyName?.text ?? element.name?.text;
    if (imported && functions.has(imported) && element.name?.text)
      into.named.set(element.name.text, imported);
  }
}

/** Every call whose callee resolves to a given local function, so a parameter can be read backwards. */
function indexCallSites(sourceFile, resolveCallee) {
  const callsTo = new Map();
  const walk = (node) => {
    if (node.kind === K.CallExpression) {
      for (const fn of resolveCallee(node.expression)) {
        if (!callsTo.has(fn)) callsTo.set(fn, []);
        callsTo.get(fn).push(node);
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return callsTo;
}

// ── The analyzer ──────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve every spawn target in one module.
 *
 * @param {string} sourceText
 * @param {string} [fileName] reporting name only
 * @returns {{
 *   targets: Array<{
 *     kind: 'file' | 'command-line',
 *     candidates: Array<{ text: string, complete: boolean }>,
 *   }>,
 *   exhausted: boolean,
 * }} one entry per expression that could name an executed file, plus whether the work budget ran
 *   out — a partial walk that found nothing has not established that there is nothing.
 */
export function analyzeSpawnTargets(sourceText, fileName = 'module.mjs') {
  const sourceFile = ts.createSourceFile(fileName, sourceText);
  const { scopes, spawnNames, spawnNamespaces, pathNames, pathNamespaces } =
    indexBindings(sourceFile);

  let steps = 0;
  const spend = () => (steps += 1) < STEP_BUDGET;

  /** Bindings for `name`, looked up from `node` outwards. Inner scopes shadow outer ones. */
  const lookup = (node, name) => {
    for (let cur = node; cur; cur = cur.parent) {
      if (!SCOPE_KINDS.has(cur.kind)) continue;
      const found = scopes.get(cur)?.get(name);
      if (found) return found;
    }
    return null;
  };

  const resolveCallee = (calleeNode) => {
    if (calleeNode?.kind !== K.Identifier) return [];
    return (lookup(calleeNode, calleeNode.text) ?? [])
      .filter((b) => b.kind === 'function')
      .map((b) => b.node);
  };
  const callsTo = indexCallSites(sourceFile, resolveCallee);

  // Guards against a binding that resolves through itself (`const a = a` and, more realistically, a
  // recursive helper). A node under evaluation resolves to "unknown" rather than recursing.
  const active = new Set();

  /** Candidate string values of an expression. */
  const evaluate = (node) => {
    if (!node || !spend() || active.has(node)) return [NOTHING_KNOWN];
    active.add(node);
    try {
      return evaluateInner(node);
    } finally {
      active.delete(node);
    }
  };

  const evaluateInner = (node) => {
    switch (node.kind) {
      case K.StringLiteral:
      case K.NoSubstitutionTemplateLiteral:
      case K.NumericLiteral:
        return [literal(node.text)];

      case K.TemplateExpression: {
        let acc = [literal(node.head?.text ?? '')];
        for (const span of node.templateSpans ?? []) {
          acc = concatCandidates(acc, evaluate(span.expression));
          acc = concatCandidates(acc, [literal(span.literal?.text ?? '')]);
        }
        return acc;
      }

      case K.BinaryExpression:
        if (node.operatorToken?.kind === K.PlusToken)
          return concatCandidates(evaluate(node.left), evaluate(node.right));
        return [NOTHING_KNOWN];

      case K.ParenthesizedExpression:
      case K.AsExpression:
      case K.SatisfiesExpression:
      case K.NonNullExpression:
      case K.AwaitExpression:
      case K.TypeAssertionExpression:
        return evaluate(node.expression);

      case K.ConditionalExpression:
        return capped([...evaluate(node.whenTrue), ...evaluate(node.whenFalse)]);

      case K.Identifier:
        return capped((lookup(node, node.text) ?? [{ kind: 'unknown' }]).flatMap(evaluateBinding));

      case K.PropertyAccessExpression:
        // `process.execPath` is the running node binary. Its directory is unknowable and its name
        // is not: leaving it wholly unknown made every `execFileSync(process.execPath, …)` in the
        // suite — the ordinary way this harness runs its own scans — read as "might be any script".
        if (node.expression?.kind === K.Identifier && node.expression.text === 'process')
          return node.name?.text === 'execPath'
            ? [{ text: '/node', complete: false }]
            : [NOTHING_KNOWN];
        return readProperty(node.expression, node.name?.text);

      case K.NewExpression:
        // `new URL('../scan.mjs', import.meta.url)` — resolving a relative reference never changes
        // its final segment, which is the only part this analysis reads.
        if (node.expression?.kind === K.Identifier && node.expression.text === 'URL')
          return capped(
            evaluate((node.arguments ?? [])[0]).map((c) =>
              c.complete
                ? { text: `/${c.text.slice(c.text.lastIndexOf('/') + 1)}`, complete: false }
                : NOTHING_KNOWN,
            ),
          );
        return [NOTHING_KNOWN];

      case K.CallExpression:
        return evaluateCall(node);

      default:
        return [NOTHING_KNOWN];
    }
  };

  const evaluateBinding = (binding) => {
    switch (binding.kind) {
      case 'value':
        return binding.property
          ? readProperty(binding.expression, binding.property)
          : evaluate(binding.expression);
      case 'element': {
        const { elements, unknown } = elementsOf(binding.expression);
        const values = elements.flatMap((element) =>
          binding.property ? propertyOfObject(element, binding.property) : evaluate(element),
        );
        return unknown ? [...values, NOTHING_KNOWN] : values;
      }
      case 'parameter': {
        const values = (callsTo.get(binding.fn) ?? []).flatMap((call) => {
          const argument = (call.arguments ?? [])[binding.index];
          if (!argument) return binding.fallback ? evaluate(binding.fallback) : [NOTHING_KNOWN];
          if (argument.kind === K.SpreadElement) return [NOTHING_KNOWN];
          return binding.property ? readProperty(argument, binding.property) : evaluate(argument);
        });
        // A function nothing calls (an exported helper, a callback) tells us nothing about its
        // parameter — which is "unknown", not "no values".
        return values.length > 0 ? values : [NOTHING_KNOWN];
      }
      default:
        return [NOTHING_KNOWN];
    }
  };

  /** `expr.prop`, where `expr` may be an object literal, a variable holding one, or a call returning one. */
  const readProperty = (expression, property) => {
    if (!expression || !property || !spend()) return [NOTHING_KNOWN];
    const { objects, unknown } = objectsOf(expression);
    const values = objects.flatMap((object) => propertyOfObject(object, property));
    if (unknown || values.length === 0) return capped([...values, NOTHING_KNOWN]);
    return capped(values);
  };

  const propertyOfObject = (node, property) => {
    if (node?.kind !== K.ObjectLiteralExpression) {
      // The element of a `for…of` may itself be a variable holding the object.
      const { objects, unknown } = objectsOf(node);
      if (objects.length === 0) return [NOTHING_KNOWN];
      const values = objects.flatMap((o) => propertyOfObject(o, property));
      return unknown ? [...values, NOTHING_KNOWN] : values;
    }
    let spread = false;
    for (const member of node.properties ?? []) {
      if (member.kind === K.SpreadAssignment) {
        spread = true;
        continue;
      }
      const name = member.name?.text;
      if (name !== property) continue;
      if (member.kind === K.PropertyAssignment) return evaluate(member.initializer);
      if (member.kind === K.ShorthandPropertyAssignment) return evaluate(member.name);
      return [NOTHING_KNOWN];
    }
    // An absent property on a fully-written literal is `undefined`, not an unknown — unless a spread
    // could have supplied it.
    return spread ? [NOTHING_KNOWN] : [];
  };

  /** Object-literal nodes an expression may evaluate to. */
  const objectsOf = (node) => {
    if (!node || !spend() || active.has(node)) return { objects: [], unknown: true };
    active.add(node);
    try {
      switch (node.kind) {
        case K.ObjectLiteralExpression:
          return { objects: [node], unknown: false };
        case K.ParenthesizedExpression:
        case K.AsExpression:
        case K.NonNullExpression:
        case K.AwaitExpression:
          return objectsOf(node.expression);
        case K.ConditionalExpression: {
          const a = objectsOf(node.whenTrue);
          const b = objectsOf(node.whenFalse);
          return { objects: [...a.objects, ...b.objects], unknown: a.unknown || b.unknown };
        }
        case K.Identifier: {
          const bindings = lookup(node, node.text);
          if (!bindings) return { objects: [], unknown: true };
          return mergeObjects(bindings.map(objectsOfBinding));
        }
        case K.CallExpression: {
          const returns = returnExpressionsOf(node);
          if (returns === null) return { objects: [], unknown: true };
          return mergeObjects(returns.map(objectsOf));
        }
        default:
          return { objects: [], unknown: true };
      }
    } finally {
      active.delete(node);
    }
  };

  const objectsOfBinding = (binding) => {
    switch (binding.kind) {
      case 'value':
        return binding.property ? { objects: [], unknown: true } : objectsOf(binding.expression);
      case 'element': {
        if (binding.property) return { objects: [], unknown: true };
        const { elements, unknown } = elementsOf(binding.expression);
        return mergeObjects([...elements.map(objectsOf), { objects: [], unknown }]);
      }
      case 'parameter': {
        const calls = callsTo.get(binding.fn) ?? [];
        if (calls.length === 0) return { objects: [], unknown: true };
        return mergeObjects(
          calls.map((call) => {
            const argument = (call.arguments ?? [])[binding.index];
            return argument && argument.kind !== K.SpreadElement
              ? objectsOf(argument)
              : { objects: [], unknown: true };
          }),
        );
      }
      default:
        return { objects: [], unknown: true };
    }
  };

  const mergeObjects = (parts) => ({
    objects: parts.flatMap((p) => p.objects),
    unknown: parts.some((p) => p.unknown),
  });

  /**
   * Element expressions an array-valued expression may yield.
   *
   * `.filter`/`.sort`/`.slice`/`.reverse` pass their receiver's elements through. That is an
   * over-approximation — a filter may drop one — and it is the same approximation the relation
   * always made about reachability: an `if (false)` around a spawn never counted either. What
   * changed here is the NAME-TO-SPAWN binding, not whether the line runs.
   */
  const elementsOf = (node) => {
    if (!node || !spend() || active.has(node)) return { elements: [], unknown: true };
    active.add(node);
    try {
      switch (node.kind) {
        case K.ArrayLiteralExpression: {
          const elements = [];
          let unknown = false;
          for (const element of node.elements ?? []) {
            if (element.kind === K.SpreadElement) {
              const inner = elementsOf(element.expression);
              elements.push(...inner.elements);
              unknown = unknown || inner.unknown;
              continue;
            }
            elements.push(element);
          }
          return { elements, unknown };
        }
        case K.ParenthesizedExpression:
        case K.AsExpression:
        case K.NonNullExpression:
        case K.AwaitExpression:
          return elementsOf(node.expression);
        case K.Identifier: {
          const bindings = lookup(node, node.text);
          if (!bindings) return { elements: [], unknown: true };
          return mergeElements(
            bindings.map((binding) =>
              binding.kind === 'value' && !binding.property
                ? elementsOf(binding.expression)
                : { elements: [], unknown: true },
            ),
          );
        }
        case K.CallExpression: {
          const callee = node.expression;
          if (
            callee?.kind === K.PropertyAccessExpression &&
            ['filter', 'sort', 'slice', 'reverse', 'flat'].includes(callee.name?.text)
          )
            return elementsOf(callee.expression);
          if (callee?.kind === K.PropertyAccessExpression && callee.name?.text === 'concat')
            return mergeElements([
              elementsOf(callee.expression),
              ...(node.arguments ?? []).map(elementsOf),
            ]);
          const returns = returnExpressionsOf(node);
          if (returns === null) return { elements: [], unknown: true };
          return mergeElements(returns.map(elementsOf));
        }
        default:
          return { elements: [], unknown: true };
      }
    } finally {
      active.delete(node);
    }
  };

  const mergeElements = (parts) => ({
    elements: parts.flatMap((p) => p.elements),
    unknown: parts.some((p) => p.unknown),
  });

  /** Expressions a local function returns, or `null` when the callee is not a local function. */
  const returnExpressionsOf = (call) => {
    const fns = resolveCallee(call.expression);
    if (fns.length === 0) return null;
    const out = [];
    for (const fn of fns) {
      const body = fn.body;
      if (!body) continue;
      if (body.kind !== K.Block) {
        out.push(body); // concise arrow body
        continue;
      }
      const collect = (node) => {
        if (node.kind === K.ReturnStatement && node.expression) out.push(node.expression);
        if (FUNCTION_KINDS.has(node.kind) && node !== fn) return; // a nested function's returns are its own
        ts.forEachChild(node, collect);
      };
      collect(body);
    }
    return out;
  };

  /** `path.join` / `path.resolve` / bare `join` imported from `node:path`, whichever spelling. */
  const pathFunctionOf = (callee) => {
    if (callee?.kind === K.Identifier) return pathNames.get(callee.text) ?? null;
    if (
      callee?.kind === K.PropertyAccessExpression &&
      callee.expression?.kind === K.Identifier &&
      pathNamespaces.has(callee.expression.text) &&
      PATH_FUNCTIONS.has(callee.name?.text)
    )
      return callee.name.text;
    return null;
  };

  const evaluateCall = (node) => {
    const callee = node.expression;
    const pathFunction = pathFunctionOf(callee);
    if (pathFunction === 'join' || pathFunction === 'resolve' || pathFunction === 'normalize')
      return joinCandidates((node.arguments ?? []).map(evaluate));
    if (pathFunction === 'basename')
      return capped(
        evaluate((node.arguments ?? [])[0]).map((c) =>
          c.complete || c.text.includes('/')
            ? literal(c.text.slice(c.text.lastIndexOf('/') + 1))
            : c,
        ),
      );
    if (callee?.kind === K.PropertyAccessExpression) {
      const member = callee.name?.text;
      if (member === 'trim' || member === 'toString') return evaluate(callee.expression);
    }
    // `fileURLToPath` restates a `file:` URL as a path; the final segment is carried through.
    if (
      callee?.kind === K.Identifier &&
      (callee.text === 'String' || callee.text === 'fileURLToPath')
    )
      return evaluate((node.arguments ?? [])[0]);
    const returns = returnExpressionsOf(node);
    if (returns === null || returns.length === 0) return [NOTHING_KNOWN];
    return capped(returns.flatMap(evaluate));
  };

  // ── Spawn sites ────────────────────────────────────────────────────────────────────────────────

  const targets = [];

  /**
   * The `child_process` function this call invokes, or null when it is not one.
   *
   * Resolution goes through the IMPORT BINDING, not the spelling: `spawnSync('bash', …)` written
   * inside a string literal — which a test of this very relation is full of — is not a call at all,
   * and a locally-defined `spawnSync` is not `child_process`'s.
   */
  const spawnFunctionName = (node) => {
    const callee = node.expression;
    if (callee?.kind === K.Identifier) return spawnNames.get(callee.text) ?? null;
    if (
      callee?.kind === K.PropertyAccessExpression &&
      callee.expression?.kind === K.Identifier &&
      spawnNamespaces.has(callee.expression.text) &&
      SPAWN_FUNCTIONS.has(callee.name?.text)
    )
      return callee.name.text;
    return null;
  };

  const isSpawnCall = (node) => spawnFunctionName(node) !== null;

  /**
   * Record what one spawn call can execute.
   *
   * The precision that matters is ARGV POSITION. `bash foo.sh a b` executes `foo.sh` and hands `a`
   * and `b` to it; `node run.mjs <tmpdir>` executes `run.mjs`. Treating every argv element as a
   * possible script made an unresolvable temp-directory argument read as "this file might run any
   * script at all", and measured over the harness suite that produced 331 undetermined pairs
   * against 27 resolved ones — an analysis that answers "don't know" everywhere is the grep it
   * replaced, wearing a more expensive costume.
   */
  const recordSpawn = (node, functionName) => {
    const args = node.arguments ?? [];
    if (args.length === 0) return;

    // `exec`/`execSync` take a SHELL COMMAND LINE, not a file.
    if (functionName === 'exec' || functionName === 'execSync') {
      targets.push({ kind: 'command-line', candidates: evaluate(args[0]) });
      return;
    }

    // The command itself. `spawnSync('/path/to/hook.sh')` executes it directly.
    const command = evaluate(args[0]);
    targets.push({ kind: 'file', candidates: command });

    // argv can only name an executed file when the command is an INTERPRETER. `git` or `pnpm`
    // cannot reach a script through its argv, so its unresolvable arguments raise no ambiguity.
    const interpreterPossible = command.some((c) => {
      if (!c.complete && !c.text.includes('/')) return true; // could be any command
      return INTERPRETERS.has(c.text.slice(c.text.lastIndexOf('/') + 1));
    });
    if (!interpreterPossible) return;

    const argv = args[1];
    if (!argv) return;
    if (argv.kind !== K.ArrayLiteralExpression) {
      // `spawnSync('bash', argv)` — the vector itself is opaque, so its head could be anything.
      targets.push({ kind: 'file', candidates: [NOTHING_KNOWN] });
      return;
    }

    // Scan forward to the first element that is not an option. That element is the script.
    for (const element of argv.elements ?? []) {
      if (element.kind === K.SpreadElement) {
        // A spread could contribute the script position or push it further along; either way the
        // head of the remaining vector stops being knowable.
        targets.push({ kind: 'file', candidates: [NOTHING_KNOWN] });
        return;
      }
      const value = evaluate(element);
      const single = value.length === 1 && value[0].complete ? value[0].text : null;
      if (single !== null && (single === '-c' || single === '-e')) {
        // What follows is INLINE CODE, not a path — `sh -c 'command -v jq'`.
        const index = (argv.elements ?? []).indexOf(element);
        const inline = (argv.elements ?? [])[index + 1];
        targets.push({
          kind: 'command-line',
          candidates: inline ? evaluate(inline) : [NOTHING_KNOWN],
        });
        return;
      }
      if (single !== null && single.startsWith('-') && single !== '-') continue; // `-n`, `-x`, `--`
      targets.push({ kind: 'file', candidates: value });
      return;
    }
  };

  const walk = (node) => {
    if (node.kind === K.CallExpression && isSpawnCall(node))
      recordSpawn(node, spawnFunctionName(node));
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);

  return { targets, exhausted: steps >= STEP_BUDGET };
}

/**
 * Does the analyzed module execute `scriptPath`? EXECUTES / NOT_EXECUTED / UNDETERMINED.
 *
 * `exhausted` — the work budget ran out — is UNDETERMINED by construction: a partial walk that
 * found nothing has not established that there is nothing.
 */
export function classifyExecution(analysis, scriptPath) {
  const basename = scriptPath.split('/').pop();
  let maybe = analysis.exhausted === true;
  for (const target of analysis.targets) {
    for (const candidate of target.candidates) {
      const answer =
        target.kind === 'command-line'
          ? commandLineNames(candidate, basename)
          : candidateNames(candidate, basename);
      if (answer === 'yes') return EXECUTION.EXECUTES;
      if (answer === 'maybe') maybe = true;
    }
  }
  return maybe ? EXECUTION.UNDETERMINED : EXECUTION.NOT_EXECUTED;
}

/**
 * Does a shell COMMAND LINE (`sh -c '…'`, `execSync('…')`) run the file `basename`?
 *
 * A command line is not a path, so the name has to sit on a token boundary — otherwise `hook.sh`
 * would be found inside `my-hook.sh`. Unknown text anywhere in the line could hold anything, so an
 * incomplete candidate with no match is undetermined rather than a no.
 */
export function commandLineNames(candidate, basename) {
  const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = new RegExp(`(?:^|[\\s'"\`/=(;&|])${escaped}(?:$|[\\s'"\`);&|])`);
  if (boundary.test(candidate.text)) return 'yes';
  return candidate.complete ? 'no' : 'maybe';
}

// Parsing is the expensive part and both consumers ask about many scripts per module, so a module's
// analysis is computed once. Keyed by text, because that is all one of the callers has.
const cache = new Map();

/** {@link analyzeSpawnTargets}, memoised per source text. */
export function analyzeSpawnTargetsCached(sourceText, fileName) {
  const key = String(sourceText ?? '');
  if (!cache.has(key)) {
    if (cache.size > 512) cache.clear();
    cache.set(key, analyzeSpawnTargets(key, fileName));
  }
  return cache.get(key);
}
