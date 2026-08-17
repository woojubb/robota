#!/usr/bin/env node

/**
 * ARCH-037: a barrel-exported function's parameter types must be exported from the same barrel.
 *
 * ## The defect this exists for, twice
 *
 * `subagentExecutionRoot` is on `agent-executor`'s barrel. Its parameter type
 * `ISubagentExecutionEnvelope` was declared and exported at its own module and appeared on neither
 * the sub-barrel nor the package barrel, so **a consumer of the public function could not name what
 * it must pass.** ARCH-025 had already fixed the identical shape for `IScheduleEditPatch`. The repair
 * did not become a habit, which is the whole argument for a mechanism rather than a third note.
 *
 * A published function whose argument is unnameable is not a smaller version of a published function
 * — it is one the consumer must reverse-engineer or cast into. That is why this is a floor and not a
 * lint preference.
 *
 * ## What it checks, and the two things it deliberately does not
 *
 * For each configured package barrel: every function it exports, whether declared there or re-exported
 * from a module beneath it, must have every NAMED type in its parameter positions exported from that
 * same barrel.
 *
 * NOT checked, because each would fire on correct code:
 *
 *   - **Return types.** A consumer can hold a returned value without naming its type
 *     (`const x = f()`), so an unexported return type is a smaller problem and a much noisier rule.
 *   - **Types owned by another package.** `IAgentDefinition` arriving from `@robota-sdk/agent-core`
 *     is nameable by any consumer that may depend on that package; requiring the barrel to
 *     re-export it would demand exactly the pass-through re-exports STRUCT-07 bans. Only types
 *     DECLARED inside the package are required to be on its barrel.
 *
 * Built-ins and utility types (`string`, `Promise`, `Record`, …) fall out of that same gate rather
 * than needing a list of their own: they are not declared in the package, so `declaredInPackage`
 * already excludes them. An earlier revision kept a 34-name `AMBIENT_TYPES` set beside this
 * sentence; round-2 review found the set was consulted nowhere, and restoring the guard would have
 * been WORSE than deleting it — a package that declares its own `Date` or `Buffer` and exports a
 * function taking it owes that type on its barrel exactly like any other, and the guard would have
 * skipped it by name. The behaviour was right; only this sentence was wrong.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

/**
 * What the last run read. Exported so a test asserts the number the scan prints
 * (measurement-provenance.md) — "examined 0 barrels" reads exactly like a clean repository.
 */
let examinedBarrels = 0;

export function examinedBarrelCount() {
  return examinedBarrels;
}

/** The tail identifier of a possibly-qualified type name. */
function tailName(node) {
  let tail = node?.typeName ?? node?.exprName;
  while (tail && ts.isQualifiedName(tail)) tail = tail.right;
  return tail?.text ?? tail?.escapedText;
}

/** The LEFTMOST identifier of a possibly-qualified type name — `other` in `other.IThing`. */
function rootName(node) {
  let head = node?.typeName ?? node?.exprName;
  while (head && ts.isQualifiedName(head)) head = head.left;
  return head?.text ?? head?.escapedText;
}

/**
 * Every named type in `node`'s parameter list, each with the ROOT of its qualified name.
 *
 * The root is what distinguishes `IThing` from `other.IThing`. Round-4 review showed the tail alone
 * is not enough: `import * as other from '@robota-sdk/other'` records no named binding, so a
 * parameter typed `other.IThing` reduced to `IThing` and was decided by name — one unrelated local
 * `IThing` in the package and the floor fired on correct code.
 */
export function parameterTypeRefs(fn) {
  // Keyed by name AND root. An earlier revision keyed by the tail alone and kept the first root,
  // so `f(a: other.IThing, b: IThing)` collapsed to one ref carrying the FOREIGN root — and the
  // genuine `IThing` was suppressed by the namespace skip. Reversing the parameter order made it
  // fire, which is how review demonstrated it.
  const refs = new Map();
  const walk = (node) => {
    if (ts.isTypeReferenceNode(node)) {
      const name = tailName(node);
      if (!name) return ts.forEachChild(node, walk);
      const root = rootName(node);
      refs.set(`${root ?? ''}.${name}`, { name, root });
    }
    ts.forEachChild(node, walk);
  };
  for (const parameter of fn.parameters ?? []) {
    if (parameter.type) walk(parameter.type);
  }
  return [...refs.values()];
}

/** Every named type appearing anywhere inside `node`'s parameter list. */
export function parameterTypeNames(fn) {
  return parameterTypeRefs(fn).map((ref) => ref.name);
}

/**
 * What one file declares and publishes: `{ functions, exportedNames, reexports, starExports }`.
 *
 * `functions` covers the shapes review MEASURED an earlier revision missing silently:
 * `export const f = (…) => …`, `export default function`, an overload set (only the first signature
 * was read, so the dirty overload was invisible), a name arriving through `export * from`, and a
 * deferred `export { f };` whose binding came from an import. A floor that reads one declaration
 * form reports zero for every other, which is the shape this whole item is about.
 *
 * It does NOT cover every shape. An earlier revision claimed it did; the revision after that listed
 * five gaps, and review found the list itself wrong in two places — one entry described behaviour
 * the code does not have, and the entry with 38 live instances was missing. Each remaining gap
 * below was re-confirmed by fixture:
 *   - `function f(…) {} export default f;` — an export ASSIGNMENT, not a modifier;
 *   - `export default (a: IThing) => {};` — an anonymous default;
 *   - a `class`'s CONSTRUCTOR parameters, which a consumer equally cannot name;
 *   - an inline `import('./thing.js').IThing` parameter type (`ImportTypeNode` carries `qualifier`,
 *     not `typeName`, so `tailName` reads nothing).
 * Each under-reports, which is the dangerous direction — so they are listed rather than left for
 * the next reader to find the way review found these.
 *
 * `export * as ns from '…'` is NOT in that list: a `NamespaceExport` clause carries no `elements`,
 * so it is followed as a star export. That is the right answer for this floor's question — every
 * name in the target is nameable by the consumer, as `ns.X` — even though the names are unioned
 * bare. A previous revision listed it as an unfollowed gap, which was the opposite of the truth.
 *
 * A REAL limit, stated because it is the half of the round-3 collision fix that is still open:
 * `exportedNames` is a flat set of names, so a barrel that publishes its own `IThing` silences a
 * finding about a DIFFERENT `IThing` reaching the signature from a submodule. Closing it needs
 * declaration identity (`file#name`) rather than a name set; it is HARNESS-108's TC-01.
 *
 * `starExports` is tracked rather than ignored for the same reason, and it cut BOTH ways before it
 * was: a function published by `export *` was never checked, and a TYPE published by `export *` was
 * reported as unexported — ten false positives on `agent-core` alone, whose barrel publishes that way.
 */
export function readBarrel(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const functions = [];
  const exportedNames = new Set();
  const reexports = [];
  const starExports = [];
  /** local name → where it was imported from, for deferred `export { … };` with no module. */
  const importedFrom = new Map();
  /** local namespace alias → module, for a qualified parameter type like `other.IThing`. */
  const importedNamespaces = new Map();

  const isExported = (node) =>
    (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node) =>
    (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  /**
   * Callables declared in this file WITHOUT `export`, keyed by name. A deferred `export { f };`
   * publishes them, and collecting only `isExported` declarations missed the shape entirely.
   *
   * On the IMPACT, because the first version of this comment got it wrong: review counted 38 live
   * instances of the shape, all in one package's UI components, and I wrote that the reader had
   * been blind to all 38. Re-measured across all 55 package barrels, the reader collects 695
   * functions (466 with a named parameter type) BOTH before and after this change — identical.
   * None of the 38 sits on a published graph, because that package's barrel is a single
   * `export *` over a directory those files are not under. So this closes a real shape with zero
   * measured effect on today's tree, which is worth having before the widening and is not worth
   * claiming as a fix for 38 invisible functions.
   */
  const localCallables = new Map();

  const visit = (node, atTopLevel = false) => {
    // ONLY a top-level declaration can be published by a later `export { … };`. `visit` recurses
    // into bodies, so an earlier revision registered closure-scoped callables under their bare
    // names — `export function outer() { function f(x: ISecret) {} }` beside a top-level
    // `function f(a: IPublic) {}` reported `ISecret`, a purely internal type, on a name the
    // barrel does publish. Over-firing is the direction that gets a floor switched off.
    if (atTopLevel && ts.isFunctionDeclaration(node) && !isExported(node) && node.name?.text) {
      const existing = localCallables.get(node.name.text) ?? [];
      existing.push(node);
      localCallables.set(node.name.text, existing);
    }
    if (
      atTopLevel &&
      ts.isVariableStatement(node) &&
      !isExported(node) &&
      (node.declarationList?.declarations ?? []).length > 0
    ) {
      for (const declaration of node.declarationList.declarations) {
        const name = declaration.name?.text;
        if (!name || !declaration.initializer?.parameters) continue;
        const existing = localCallables.get(name) ?? [];
        existing.push(declaration.initializer);
        localCallables.set(name, existing);
      }
    }
    if (ts.isFunctionDeclaration(node) && isExported(node)) {
      // An overload set declares the same name several times; every signature is part of the
      // published contract, so each is read rather than only the first.
      // A default export is reachable under BOTH names: `export default function f` is imported
      // as `default` by `export { default as g } from …` and as `f` by anything in-module. Test
      // found the single-name registration missing the re-export form entirely.
      const names = new Set();
      if (node.name?.text) names.add(node.name.text);
      if (isDefault(node)) names.add('default');
      for (const name of names) {
        exportedNames.add(name);
        functions.push({ name, node });
      }
    }
    // `export const f = (…) => …` / `= function (…) …`: a published callable with no
    // FunctionDeclaration anywhere.
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList?.declarations ?? []) {
        const name = declaration.name?.text;
        if (!name) continue;
        exportedNames.add(name);
        const init = declaration.initializer;
        if (init?.parameters) functions.push({ name, node: init });
      }
    }
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      isExported(node) &&
      node.name?.text
    ) {
      exportedNames.add(node.name.text);
    }
    if (ts.isClassDeclaration(node) && isExported(node) && node.name?.text) {
      exportedNames.add(node.name.text);
    }
    // `import { f } from './impl.js'` — recorded so a DEFERRED `export { f };` below still knows
    // where `f` comes from. Round-2 review found this idiom evades the floor entirely: the name
    // lands in `exportedNames` but no edge is followed, so the function's parameters are never read.
    if (ts.isImportDeclaration(node)) {
      const module = node.moduleSpecifier?.text;
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        const local = element.name?.text;
        if (local && module) {
          importedFrom.set(local, { original: element.propertyName?.text ?? local, module });
        }
      }
      // `import f from './impl.js'` binds a default under a local name; without this the deferred
      // `export { f };` form still evades through the default-import door.
      const defaultLocal = node.importClause?.name?.text;
      if (defaultLocal && module) {
        importedFrom.set(defaultLocal, { original: 'default', module });
      }
      // `import * as other from '…'` binds a NAMESPACE. It publishes no name of its own, so it is
      // kept apart from `importedFrom`: it answers "where does `other.X` live", never "what is X".
      const namespaceLocal = node.importClause?.namedBindings?.name?.text;
      if (namespaceLocal && module && !node.importClause?.namedBindings?.elements) {
        importedNamespaces.set(namespaceLocal, module);
      }
    }
    if (ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier?.text;
      const elements = node.exportClause?.elements;
      if (!elements && module) {
        // `export * from './x.js'` — publishes whatever that module publishes, transitively.
        starExports.push({ module });
      }
      for (const element of elements ?? []) {
        const local = element.name?.text;
        const original = element.propertyName?.text ?? local;
        if (!local) continue;
        exportedNames.add(local);
        // An ALIASED re-export publishes the local name; the original is what the target declares.
        if (module) {
          reexports.push({ local, original, module });
        } else {
          const source = importedFrom.get(original);
          if (source) {
            reexports.push({ local, original: source.original, module: source.module });
          } else {
            // Not an import — the name was DECLARED here without `export` and is published by
            // this statement. There is no edge to follow; the declaration is right here.
            for (const node of localCallables.get(original) ?? []) {
              functions.push({ name: local, node });
            }
          }
        }
      }
    }
    // A `namespace`/`declare module` body is NOT the file's export surface — `export function`
    // inside one publishes into the namespace, not out of the module. Round-2 review demonstrated
    // both shapes producing a finding; descending into them treats a nested name as a barrel export.
    if (ts.isModuleDeclaration(node)) return;
    ts.forEachChild(node, (child) => visit(child, false));
  };
  ts.forEachChild(sourceFile, (statement) => visit(statement, true));

  return { functions, exportedNames, reexports, starExports, importedFrom, importedNamespaces };
}

/** Resolve a relative module specifier to a file inside the package, or undefined. */
function resolveModule(fromFile, specifier, root) {
  if (!specifier?.startsWith('.')) return undefined;
  const base = join(dirname(fromFile), specifier).replace(/\.(js|mjs|cjs)$/, '');
  // `index.tsx` is in the list because 10+ exist in this workspace; omitting it makes the walk
  // stop at a directory edge it should have followed, which under-reports rather than over-reports.
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(resolve(root, candidate))) return candidate;
  }
  return undefined;
}

/**
 * Everything a barrel publishes, resolved to a FIXPOINT rather than to a fixed number of hops.
 *
 * Review demonstrated the cost of a hop limit on a configured barrel: `agent-executor`'s
 * `index.ts` → `background-tasks/index.ts` → `runners/index.ts` → the runner modules is THREE hops.
 * Measured on that barrel, the two-hop walk collected 11 functions (8 with a named parameter type)
 * where this fixpoint collects 14 (11 with one) — it was blind to `createManagedShellProcessRunner`,
 * `createScheduledTaskRunner` and `resolveBackgroundTaskShellCommand`, so deleting their parameter
 * types from the barrel left the floor GREEN. (An earlier revision of this paragraph said "10 of its
 * 13"; both numbers were asserted rather than counted, and both are wrong. They are counted now.)
 * A `visited` set makes the depth a property of the tree rather than of this function.
 */
export function resolvePublished(barrel, root, readFile) {
  const exportedNames = new Set();
  const functions = [];
  const visited = new Set();

  /**
   * `wanted` is the crux, and an earlier revision got it wrong in the widening direction: it unioned
   * every name each visited module declared, so a name the BARREL does not re-export still counted as
   * published. Deleting a real re-export line then changed nothing and the floor stayed green — a
   * resolver reading a WIDER surface than the package actually has, which hides findings rather than
   * inventing them.
   *
   * So a module reached by a NAMED re-export contributes only that name; one reached by `export *`
   * contributes everything it publishes, because that is what `export *` means.
   */
  const walk = (file, wanted) => {
    const key = `${file}#${wanted ?? '*'}`;
    if (visited.has(key)) return;
    visited.add(key);

    let content;
    try {
      content = readFile(file);
    } catch {
      return;
    }
    const read = readBarrel(content, file);

    if (wanted === undefined) {
      for (const name of read.exportedNames) exportedNames.add(name);
      for (const fn of read.functions) {
        functions.push({
          ...fn,
          declaredIn: file,
          imports: read.importedFrom,
          namespaces: read.importedNamespaces,
        });
      }
    } else {
      if (read.exportedNames.has(wanted)) exportedNames.add(wanted);
      for (const fn of read.functions) {
        if (fn.name === wanted) {
          functions.push({
            ...fn,
            declaredIn: file,
            imports: read.importedFrom,
            namespaces: read.importedNamespaces,
          });
        }
      }
    }

    for (const entry of read.reexports) {
      const target = resolveModule(file, entry.module, root);
      if (!target) continue;
      // Follow a named re-export only when the barrel actually asked for that name (or asked for
      // everything). The alias case matters: the barrel publishes `local`, the target declares
      // `original`.
      if (wanted === undefined || entry.local === wanted) walk(target, entry.original);
    }
    for (const star of read.starExports) {
      const target = resolveModule(file, star.module, root);
      if (target) walk(target, wanted);
    }
  };

  walk(barrel, undefined);
  return { exportedNames, functions };
}

/**
 * Findings for one configured barrel. `settings` is injectable so `examined` is asserted against a
 * fixture of known size rather than self-reported.
 */
export function findBarrelParameterTypeFindings(root = process.cwd(), settingsOverride) {
  const settings = settingsOverride ?? loadHarnessConfig(root).barrelParameterTypes ?? {};
  const barrels = settings.barrels ?? [];

  // Fail CLOSED on an empty scope: a floor that examines nothing prints what a clean tree prints.
  if (barrels.length === 0) {
    return {
      findings: [
        {
          rule: 'barrel-scope-empty',
          detail:
            'barrelParameterTypes.barrels is empty, so this floor reads no barrel and cannot fail. ' +
            'The scope is the check.',
        },
      ],
      examined: 0,
    };
  }

  // Contained — HARNESS-108. This floor reads 2 of the workspace's 55 package barrels; the other 53
  // hold 16 findings, and widening before the declaration-identity limit above is closed would
  // redden CI on correct code. The label lives here rather than beside the list in
  // `.agents/harness.config.json`, because no label reader scans JSON — a containment nobody can
  // verify is the shape this whole item is about.
  requireGovernedTree(root, barrels, {
    scan: 'barrel-parameter-types',
    why: 'each configured barrel is a package entry point this floor reads to decide whether a published function names a type the barrel withholds; a barrel missing from the tree means that package went unchecked, not that it is clean',
  });

  examinedBarrels = 0;
  const findings = [];

  const readCache = new Map();
  const readFile = (file) => {
    if (!readCache.has(file)) readCache.set(file, readFileSync(join(root, file), 'utf8'));
    return readCache.get(file);
  };

  for (const barrel of barrels) {
    const { exportedNames, functions } = resolvePublished(barrel, root, readFile);
    examinedBarrels += 1;

    for (const fn of functions) {
      // A function's OWN generic parameters are not types the barrel owes anyone — `<TItem>` is
      // bound by the signature. Review found this over-firing where a generic's name collided with
      // an exported alias, which a `T`-prefixing repo makes likely rather than exotic.
      const ownTypeParameters = new Set(
        (fn.node.typeParameters ?? []).map((p) => p.name?.text).filter(Boolean),
      );
      // `typeRoot`, not `root`: the enclosing `root` is the repository root this whole scan resolves
      // against, and shadowing it silently handed `declaredInPackage` a type name where it expected
      // a path. The tests caught it; the name is explicit now so they do not have to again.
      for (const { name: typeName, root: typeRoot } of parameterTypeRefs(fn.node)) {
        if (ownTypeParameters.has(typeName)) continue;
        // A QUALIFIED type resolves through its root, not its tail. `other.IThing` where `other` is
        // a namespace import from another package is that package's type however many local
        // `IThing`s exist.
        if (typeRoot && typeRoot !== typeName) {
          const viaNamespace = fn.namespaces?.get(typeRoot);
          if (viaNamespace && !viaNamespace.startsWith('.')) continue;
        }
        if (exportedNames.has(typeName)) continue;
        // RESOLVE rather than look the name up. `declaredInPackage` alone asks "does any file under
        // this package declare something called X?", so an unrelated local `IForeign` anywhere in
        // the package made a genuinely foreign parameter type look local and the floor fired on
        // correct code. Asking the DECLARING file where ITS `X` comes from cannot collide.
        const boundTo = fn.imports?.get(typeName);
        if (boundTo && !boundTo.module.startsWith('.')) continue;
        if (!declaredInPackage(root, barrel, typeName)) continue;
        findings.push({
          rule: 'barrel-parameter-type-unexported',
          detail:
            `${barrel}: \`${fn.name}\` (declared in ${fn.declaredIn}) is exported but its parameter ` +
            `type \`${typeName}\` is not. A consumer of the function cannot name what it must pass, ` +
            `so they reverse-engineer the shape or cast into it — which is the defect ARCH-025 fixed ` +
            `for \`IScheduleEditPatch\` and ARCH-037 found again on \`subagentExecutionRoot\` and ` +
            `\`createDefaultTools\`. Export it from this barrel.`,
        });
      }
    }
  }

  return { findings, examined: examinedBarrels };
}

/**
 * Whether `typeName` is DECLARED in the barrel's own package `src` — the gate that keeps this floor
 * off other packages' types, which a barrel must not re-export (STRUCT-07).
 *
 * Test files are excluded wherever they sit, not only under `__tests__/`: review found a type
 * declared in a sibling `*.test.ts` counted as the package's, so the floor demanded a barrel publish
 * a fixture. Results are cached per package because an unmatched name otherwise re-walks the whole
 * `src` tree — measured at 7 s across 55 barrels.
 */
const declaredCache = new Map();

function declaredInPackage(root, barrel, typeName) {
  const packageSrc = barrel.slice(0, barrel.indexOf('/src/') + 5);
  if (!packageSrc) return false;
  const cacheKey = `${root}::${packageSrc}`;
  if (!declaredCache.has(cacheKey)) {
    const declared = new Set();
    const stack = [resolve(root, packageSrc)];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') stack.push(full);
          continue;
        }
        // `.tsx` counts: round-2 review measured 46 exported types living in `.tsx` files, each of
        // which a `.ts`-only walk would call "not this package's" and silently skip.
        const isSource = entry.endsWith('.ts') || entry.endsWith('.tsx');
        const isTest =
          entry.endsWith('.test.ts') ||
          entry.endsWith('.test.tsx') ||
          entry.endsWith('.ptytest.ts') ||
          entry.endsWith('.ptytest.tsx');
        if (!isSource || isTest) continue;
        const content = readFileSync(full, 'utf8');
        // `abstract` and `const` sit between `export` and the keyword; review found 10+ live
        // `export abstract class` declarations that the narrower pattern read as undeclared.
        for (const m of content.matchAll(
          /export (?:declare )?(?:abstract |const )?(?:interface|type|class|enum) (\w+)/g,
        )) {
          declared.add(m[1]);
        }
      }
    }
    declaredCache.set(cacheKey, declared);
  }
  return declaredCache.get(cacheKey).has(typeName);
}

function main() {
  const { findings, examined } = findBarrelParameterTypeFindings(process.cwd());
  if (findings.length > 0) {
    console.error(`barrel-parameter-types failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} barrels`);
  console.log(`barrel-parameter-types passed (${examined} barrel(s) examined).`);
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
