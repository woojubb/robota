#!/usr/bin/env node

/**
 * ARCH-029: a command must name the roles it needs, not the aggregate.
 *
 * ## The class
 *
 * A "god contract" is not fixed by decomposing it. It is fixed when the CONSUMERS stop naming the
 * aggregate — and those are two different events, separated by every declaration in the repo.
 *
 * This repo has the controlled experiment. REFACTOR-006 (2026-05) was filed against the same
 * contract, closed on removing a cast, and a production `as unknown as ICommandHostContext` landed
 * **the next day**. The contract went 20 members / 50% optional at filing to 46 / 70% today. Every
 * criterion in that attempt could be — and was — ticked while the facade survived untouched,
 * because nothing measured the quantity that was actually growing: how many places name it.
 *
 * So this is the floor ARCH-029 marks load-bearing. Its own acceptance criterion says it plainly:
 * *"the decomposition is not real until this falls"*. A criterion of "frozen and falling" was
 * written into an earlier revision of that document and rejected there, because it would close the
 * design green with 127 of 128 declarations still naming the 46-member facade — which is precisely
 * what REFACTOR-006 shipped.
 *
 * ## What counts
 *
 * A **type-position reference**: any `TypeReferenceNode` naming a guarded aggregate. That is the
 * broad definition the criterion asks for, and it is deliberately broader than the `: IAggregate`
 * grep that produced the design's first estimate — it also catches `Partial<I>`, `Pick<I, …>`,
 * indexed access (`I['getContextState']`), function-return position (`() => I`), array and union
 * members, and type arguments to any generic.
 *
 * An `import type { I }` specifier is NOT a reference: it names nothing in a type position, and a
 * file that imports without referencing has an unused import its linter already owns. Counting the
 * import as well would double-count every honest site and make the number mean two things.
 *
 * ## The allowlist is per-file AND named
 *
 * Three places must keep naming the aggregate, and each is a place where naming it is the point:
 * its own declaration, the dispatch contract every command is assigned to, the production host that
 * implements it, and the conformant double that stands in for it. They are listed by path in the
 * harness config with a reason each, so an addition is a visible config change and not a silent
 * regex loosening.
 *
 * ## Why the baseline comes from this scan and not from a grep
 *
 * The number this freezes must be the number this measures. The design's estimate of 128 was taken
 * with a narrower pattern than the criterion states, and its own text flags the gap ("roughly 6
 * more"). Taking the baseline from anything but this scan's own definition would freeze one
 * quantity while checking another — the shape of a floor that cannot fail.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

const BASELINE_FILE = 'scripts/harness/aggregate-naming-baseline.json';

/**
 * What the last `collectAggregateNaming` walk actually read. Exported so a test asserts the same
 * number the scan prints (measurement-provenance.md) — a size only the scan itself reports is one
 * nothing can contradict, and "examined 0 files" then reads exactly like a clean repository.
 *
 * Reset at the start of every run, so asserting it twice over one fixture distinguishes an
 * accumulating counter from a growing subject.
 */
let examinedFiles = 0;

export function examinedFileCount() {
  return examinedFiles;
}

/**
 * Every type-position reference to one of `aggregates` in `content`.
 *
 * Read from the AST rather than a regex for the reason the sibling scan records in its own header:
 * a regex over `: IAggregate` sees neither `Partial<IAggregate>` nor `() => IAggregate`, and sees
 * prose in a docblock that explains why a file must not name it. This file's own header names the
 * guarded aggregate repeatedly; a text scan would flag itself.
 */
/**
 * The tail identifier of a type node that names something, or `undefined`.
 */
function tailName(type) {
  // A heritage clause type is an `ExpressionWithTypeArguments` and carries `.expression`; a type
  // reference carries `.typeName`; an `import()` type carries `.qualifier`. Reading the property
  // rather than testing the node kind covers all three without a guard this AST may not export.
  let tail = type?.typeName ?? type?.qualifier ?? type?.expression;
  while (tail && (ts.isQualifiedName(tail) || ts.isPropertyAccessExpression(tail))) {
    tail = tail.right ?? tail.name;
  }
  return tail?.text ?? tail?.escapedText;
}

/**
 * The aggregate a type node names DIRECTLY — `IAggregate`, `ns.IAggregate`, or
 * `import('pkg').IAggregate` — or `undefined`. A wrapped use (`Partial<IAggregate>`,
 * `IAggregate['x']`, `() => IAggregate`) is a reference, not a rename, so it is not matched here.
 */
function directlyNamedAggregate(type, aggregates) {
  if (!type) return undefined;
  const name = tailName(type);
  return name && aggregates.includes(name) ? name : undefined;
}

/**
 * The first guarded aggregate named ANYWHERE inside `type`, however deeply wrapped — skipping the
 * two positions where naming it is a USE rather than a new handle.
 *
 * Used only for allowlisted files. `directlyNamedAggregate` is exact about what a rename is, and
 * exactness is right where references are still counted — but an allowlisted file's references are
 * NOT counted, so both channels are off there and two characters were enough to slip through:
 * `type IHostAll = ICommandHostContext & {}` measured green, as did `Omit<I, never>`,
 * `Pick<I, keyof I>`, `Readonly<I>`, a conditional resolving to `I`, and bare parentheses. Chasing
 * wrapper shapes one at a time is the loop this whole review has been about, so inside an
 * allowlisted file the question stops being "which wrapper is this" and becomes "does this
 * declaration mint a NEW NAME from the aggregate at all".
 *
 * ## The one skipped position, and why it is the only one
 *
 * The distinction is not syntactic position but DIRECTION: a type that something outside can
 * address mints a handle; a type that is only consumed does not. Exactly one kind is skipped
 * STRUCTURALLY:
 *
 *   - **Parameters.** `ISystemCommand.execute(context: ICommandHostContext)` is the dispatch
 *     contract every command is assigned to, and naming the widest type there is the entire reason
 *     that file is allowlisted. Nothing can address the aggregate through it. This one is
 *     unbounded-but-safe: a parameter is not addressable in ANY instance, so a blanket rule and a
 *     per-site rule would exempt the same set.
 *
 * Four kinds have been in this set and are not. `FunctionType` and `ConstructorType` went first:
 * review measured the tree green without them, and they had cost three routes — `export type
 * TGetHost = () => ICommandHostContext` reached as `ReturnType<TGetHost>`, `() => Array<IAggregate>`
 * and `new () => IAggregate`. `MethodSignature`, `CallSignature` and `ConstructSignature` followed,
 * and that removal is the more instructive one:
 *
 * A structural skip is an UNNAMED, NON-EXPIRING exemption over an UNBOUNDED set. `MethodSignature`
 * was forced by exactly two sites, and in exchange it exempted every future method-signature handle
 * in all ten allowlisted files — `getEverything(): ICommandHostContext` was green while the
 * identical member in property syntax was red, which is a rule keyed on syntax rather than on the
 * property. `CallSignature` and `ConstructSignature` were forced by nothing whatsoever. The two real
 * sites are now named `renameCarveOuts` entries with reasons and exact expected types, so
 * `rename-carve-out-unused` reports them the moment they stop matching. That is the disposition this
 * file has converged on over four rounds: an exact assertion plus a rule that fires when it expires
 * is the only form of exemption that cannot outlive its reason.
 *
 * ## Stated limits
 *
 * Two routes a NAME-ONLY walk cannot close. Both are written here rather than left implicit, because
 * an undocumented limit is what the preceding review rounds were about:
 *
 *   1. A factory's return type is addressable — `type IHostAll = ReturnType<typeof
 *      createTestCommandHost>` takes the whole surface in one line with NO allowlisted file
 *      modified. `createTestCommandHost` must return `ICommandHostContext`; that is what makes it a
 *      conformant double.
 *   2. A carved-out member is addressable through indexed access. Review compiled the proof against
 *      `ICreateTestCommandHostOptions['overrides']`: `keyof` yields the full member-name list, each
 *      member's type is recoverable and callable, and a mapped type over them supports a function
 *      taking the whole surface — with the aggregate never named. See `renameCarveOuts` in the
 *      harness config, whose reason previously asserted the opposite.
 *
 * Closing either needs the type checker, not a name walk.
 */
const CONSUMED_POSITIONS = new Set([ts.SyntaxKind.Parameter]);

function mentionsAggregate(type, aggregates) {
  let found;
  const walk = (node) => {
    if (found) return;
    if (CONSUMED_POSITIONS.has(node.kind)) return;
    const name = tailName(node);
    if (name && aggregates.includes(name)) found = name;
    else ts.forEachChild(node, walk);
  };
  if (type) walk(type);
  return found;
}

/**
 * Every place `content` RENAMES a guarded aggregate — gives its whole surface a second name that
 * this ratchet is not looking for.
 *
 * This exists because patching syntactic forms did not converge. Four review rounds closed a
 * heritage clause, an aliased import, an aliased re-export, and then a type alias: the scan resolves
 * names per file, so ANY renaming indirection defeats it. The class is closed instead of the form —
 * there is no legitimate reason to rename these aggregates, so renaming one is itself the finding,
 * and the reference count stops being the only thing standing between a consumer and the whole
 * 46-member surface. Verified against the tree at the time of writing: zero legitimate sites.
 *
 * Four forms, all demonstrated to leave the ratchet at its baseline before this covered them:
 * an import specifier rename, an export specifier rename, `type IHostAll = IAggregate`, and
 * `interface IAlsoEverything extends IAggregate`. A class `implements IAggregate` is NOT a rename —
 * that is conformance to the contract, which is what the production host is supposed to declare.
 *
 * Round four's finding: this check used to sit AFTER the allowlist skip, so the ten allowlisted
 * files — which include the declaration site — could rename freely. One line there, plus an ordinary
 * consumer naming the alias, left the real tree GREEN. The allowlist exempts a file from having its
 * REFERENCES counted; it never had a reason to exempt it from the rename ban.
 */
/**
 * The names a file exports through a deferred `export { X }` statement.
 *
 * "Has an `export` modifier" and "is exported" are different predicates, and review reproduced the
 * gap on the real tree: `interface IHostBox { readonly it: ICommandHostContext }` followed by
 * `export { IHostBox };` read as unexported, so the mint rule skipped it while a consumer addressed
 * the whole surface through `IHostBox['it']`. Same for the const and generic-default forms.
 */
function deferredExports(sourceFile) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier) {
      for (const element of node.exportClause?.elements ?? []) {
        if (element.propertyName?.text) names.add(element.propertyName.text);
        else if (element.name?.text) names.add(element.name.text);
      }
    }
    // `export default theHost` is an ExportAssignment, not an ExportDeclaration, and it publishes
    // the declaration just as effectively — review reproduced the whole route through
    // `typeof theHost` on a consumer, compiled. `export =` needs no handling: it does not compile
    // under this repo's ES-module target (TS1203), which was measured rather than assumed.
    if (node.kind === ts.SyntaxKind.ExportAssignment && node.isExportEquals !== true) {
      const named = node.expression?.text ?? node.expression?.escapedText;
      if (named) names.add(named);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/**
 * Type text with formatting removed, so a carve-out asserts a TYPE and not a line break.
 *
 * Collapsing whitespace runs is not enough: a member wrapped across lines by the formatter reads as
 * `TOverrides< ICommandHostContext >`, which no longer equals the configured
 * `TOverrides<ICommandHostContext>`. That turns a purely cosmetic reformat into a red load-bearing
 * floor AND a `rename-carve-out-unused` finding claiming the exemption describes nothing, when it
 * describes the identical type. Not reachable at today's member lengths, but a longer port name or a
 * print-width change makes it reachable, and an over-fire is how a floor gets silenced.
 *
 * Whitespace adjacent to punctuation is therefore dropped, while whitespace that SEPARATES
 * identifiers is kept — `keyof T` must not collapse into a different token.
 */
function normalizeType(text) {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([<>(),[\]|&])\s*/g, '$1')
    .trim();
}

function isExported(node, deferred) {
  if ((node.modifiers ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    return true;
  }
  const named = node.name?.text ?? node.declarationList?.declarations?.[0]?.name?.text;
  return Boolean(named && deferred.has(named));
}

export function findAggregateAliases(
  content,
  fileName,
  aggregates,
  { allowlisted = false, carveOuts = new Map(), carveOutsUsed } = {},
) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const deferred = deferredExports(sourceFile);
  const aliases = [];
  const note = (aggregate, alias, node, form) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    aliases.push({ aggregate, alias, line: line + 1, form });
  };
  // Inside an allowlisted file the aggregate may be NAMED — that is the whole reason each entry
  // exists — but a name it MINTS is a second handle on the surface that nothing downstream counts.
  //
  // An earlier revision applied this at two positions only, a type alias's right-hand side and a
  // heritage clause, on the reasoning that "a member's type is a use". Review measured that costing
  // three routes, each taking the whole 46-member surface with the ratchet unmoved: a member type
  // reached as `IHostBox['it']`, an exported const reached as `typeof theHost`, and a generic
  // default reached as `IBox['it']`. The reasoning was right and the implementation was positional:
  // what makes `execute(context: I)` harmless is not that it is a member, it is that nothing outside
  // can address the aggregate THROUGH it. {@link mentionsAggregate} skips exactly those consumed
  // positions and inspects everything else.
  //
  // Verified against the tree at the time of writing: zero findings across the ten allowlisted files.
  const renamedBy = (type) =>
    allowlisted ? mentionsAggregate(type, aggregates) : directlyNamedAggregate(type, aggregates);
  const visit = (node) => {
    const clause = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : undefined;
    const exported = ts.isExportDeclaration(node) ? node.exportClause : undefined;
    for (const element of clause?.elements ?? exported?.elements ?? []) {
      const imported = element.propertyName?.text;
      const local = element.name?.text;
      if (imported && local && imported !== local && aggregates.includes(imported)) {
        note(imported, local, element, clause ? 'an aliased import' : 'an aliased re-export');
      }
    }
    if (ts.isTypeAliasDeclaration(node)) {
      const aggregate = renamedBy(node.type);
      if (aggregate) note(aggregate, node.name.text, node, 'a type alias');
    }
    if (ts.isInterfaceDeclaration(node)) {
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types ?? []) {
          const aggregate = renamedBy(type);
          if (aggregate) note(aggregate, node.name.text, type, 'an interface that extends it');
        }
      }
      // Members and generic defaults, in an allowlisted and EXPORTED declaration only.
      // `IHostBox['it']` and `IBox['it']` address the aggregate from outside just as an alias does
      // — but only if the declaration carrying them is exported. Requiring export is not a
      // loosening: an unexported declaration mints no handle anything outside the file can reach,
      // which is the whole property this rule is about, and it is what keeps both doubles'
      // `const base: IAggregate = { … }` clean.
      if (allowlisted && isExported(node, deferred)) {
        for (const member of node.members ?? []) {
          const aggregate = renamedBy(member);
          if (!aggregate) continue;
          const alias = `${node.name.text}.${member.name?.text ?? '?'}`;
          // A carve-out exempts an EXACT type, not a member name. Two weaker versions were tried
          // and both were measured through: keying on the name alone exempted
          // `overrides?: IAggregate` under an entry written for `TOverrides<IAggregate>`, and
          // requiring merely "not syntactically bare" exempted `(I)`, `I & {}`, `I | I`, `I | never`
          // and `Readonly<I>` — every one a full handle. The entry now states the type it exempts
          // and it must match, which is safe rather than brittle precisely because
          // `rename-carve-out-unused` reports the entry the moment it stops matching: drift expires
          // the exemption loudly instead of silently widening it.
          const expected = carveOuts.get(`${fileName}#${alias}`);
          if (
            expected !== undefined &&
            expected === normalizeType(member.type?.getText(sourceFile))
          ) {
            carveOutsUsed?.add(`${fileName}#${alias}`);
            continue;
          }
          note(aggregate, alias, member, 'a member type');
        }
        for (const parameter of node.typeParameters ?? []) {
          // `defaultType`, NOT `default` — see the divergence list in `lib/ts-ast.mjs`. Reading
          // `.default` answered `undefined` for every type parameter, so this rule was written and
          // shipped unable to fire; `forEachChild` does not descend into it either, so a generic
          // walk would not have saved it. Caught by falsifying the route rather than by review.
          const aggregate = renamedBy(parameter.defaultType);
          if (aggregate) {
            note(aggregate, node.name.text, parameter, 'a generic parameter default');
          }
        }
      }
    }
    // An exported `const` typed as the aggregate is addressable as `typeof theHost`. A LOCAL one is
    // not, which is why the export check matters here too: both doubles build their answer as
    // `const base: IAggregate = { … }` inside the factory, and that is the cast-free conformance
    // the doubles exist to provide, not a handle anything can reach.
    if (allowlisted && ts.isVariableStatement(node) && isExported(node, deferred)) {
      for (const declaration of node.declarationList?.declarations ?? []) {
        const aggregate = renamedBy(declaration.type);
        if (aggregate) {
          note(aggregate, declaration.name?.text ?? '?', declaration, 'a typed binding');
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

export function findAggregateReferences(content, fileName, aggregates) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const found = [];

  // An ALIASED import renames the aggregate locally, and every later reference then uses a name this
  // scan was not looking for. The header's reason for skipping import specifiers — "it names nothing
  // in a type position" — holds only for the un-aliased form, where a real reference always
  // accompanies it. Under an alias the specifier is the ONLY place the guarded name appears, so
  // skipping it hides the whole file. Found by review, reproduced before being fixed:
  // `import type { ICommandHostContext as IHost } …` plus `interface IMine extends IHost {}` left
  // the ratchet at 0. Not hypothetical here — this document's own GATE-WRITE evidence records an
  // aliased import of this very symbol.
  const aliasOf = new Map();
  const canonical = (name) => aliasOf.get(name) ?? name;
  const local = new Set(aggregates);
  const collectAliases = (node) => {
    if (ts.isImportDeclaration(node)) {
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        const imported = element.propertyName?.text;
        if (imported && aggregates.includes(imported) && element.name?.text) {
          local.add(element.name.text);
          aliasOf.set(element.name.text, imported);
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sourceFile);
  const guarded = [...local];

  const note = (name, node) => {
    if (!name || !guarded.includes(name)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ aggregate: aggregates.includes(name) ? name : canonical(name), line: line + 1 });
  };

  const visit = (node) => {
    // A HERITAGE clause is not a TypeReferenceNode — `interface IMyHost extends ICommandHostContext {}`
    // and `class C implements ICommandHostContext` parse as `ExpressionWithTypeArguments`. Missing
    // this was the worst possible hole in this particular floor: re-aliasing the entire 46-member
    // surface takes ONE line, the aggregate keeps being named through the alias everywhere, and the
    // count stays at zero forever. Found by review after the scan shipped, and reproduced before
    // being fixed: adding `export interface IMyHost extends ICommandHostContext {}` to a consumer
    // left the ratchet reporting `0 reference(s)`.
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types ?? []) {
        let expr = type.expression;
        while (expr && ts.isPropertyAccessExpression(expr)) expr = expr.name;
        note(expr?.text, type);
      }
    }
    if (ts.isTypeReferenceNode(node)) {
      // `A.B.ICommandHostContext` resolves through a qualified name; the tail is the symbol.
      let name = node.typeName;
      while (name && ts.isQualifiedName(name)) name = name.right;
      note(name && ts.isIdentifier(name) ? name.text : undefined, node);
    }
    if (ts.isImportTypeNode(node)) {
      // `import('@robota-sdk/agent-framework').ICommandHostContext` is a type-position reference to
      // the aggregate that needs no import statement at all, and it parses as an ImportTypeNode
      // rather than a TypeReferenceNode. Round four demonstrated three such uses in one consumer
      // leaving the ratchet GREEN while the equivalent annotation went red — the header claims this
      // definition is broader than a `: IAggregate` grep, and this is a form the grep would catch
      // and the AST walk did not.
      let name = node.qualifier;
      while (name && ts.isQualifiedName(name)) name = name.right;
      note(name && ts.isIdentifier(name) ? name.text : undefined, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

/**
 * Which guarded aggregates `content` DECLARES, as an interface or a type alias.
 *
 * The ratchet freezes a reference count, and a count falls for two reasons that look identical from
 * outside: the consumers migrated, or the subject stopped existing under that name. Measured: with
 * only `IAgentJobHostContextRenamed` present, this scan counted 0 references for
 * `IAgentJobHostContext` against a frozen 18 and passed — reading as "the consumer migration
 * finished". The two aggregates frozen at 18 and 4 are exactly the ones that failure would misreport.
 */
export function findAggregateDeclarations(content, fileName, aggregates) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const declared = new Set();
  const visit = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      aggregates.includes(node.name?.text)
    ) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...declared];
}

function trackedSources(root) {
  const out = execFileSync('git', ['ls-files', 'packages', 'apps'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter(
      (f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mts') || f.endsWith('.cts'),
    );
}

/**
 * `examined` is an OUTPUT of this scan, so it is injectable and asserted exactly rather than
 * self-reported (measurement-provenance.md): a count nothing checks is how "examined 0 files"
 * reads as a clean repository.
 */
export function collectAggregateNaming(
  root = process.cwd(),
  config = loadHarnessConfig(root),
  files = trackedSources(root),
) {
  // Fail CLOSED here too, not only in the findings wrapper. This function is exported and takes a
  // root, so it is callable on its own — and on a root without the governed tree it would count 0
  // references, which reads exactly like a finished decomposition.
  requireGovernedTree(root, ['packages'], { scan: 'aggregate-naming' });
  const settings = config.aggregateNaming ?? {};
  const aggregates = settings.aggregates ?? [];
  const allowlist = new Set((settings.allowlist ?? []).map((entry) => entry.file));
  // Named, reasoned exceptions to the mint rule, in the same idiom as `rolePortOptionals.carveOuts`.
  // There are two, both on the doubles' own options bags, and they are listed rather than designed
  // around: an options type for a conformant double necessarily names the contract it doubles.
  const renameCarveOuts = new Map(
    (settings.renameCarveOuts ?? []).map((entry) => [
      `${entry.file}#${entry.declaration}`,
      normalizeType(entry.type),
    ]),
  );
  // Which carve-outs actually matched a live site. A carve-out that matches nothing is config
  // asserting an exception that does not exist — it fails closed, but this file's own standard is
  // that silence is not evidence, and an exception nobody can see expiring outlives its reason.
  const carveOutsUsed = new Set();

  const counts = new Map(aggregates.map((name) => [name, { references: 0, files: new Map() }]));
  const declaredIn = new Map(aggregates.map((name) => [name, []]));
  const aliasFindings = [];
  let examined = 0;
  examinedFiles = 0;

  for (const file of files) {
    const content = readFileSync(join(root, file), 'utf8');
    examined += 1;
    examinedFiles += 1;
    // A cheap reject before the RPC parse: most files never mention any aggregate at all.
    if (!aggregates.some((name) => content.includes(name))) continue;

    for (const name of findAggregateDeclarations(content, file, aggregates)) {
      declaredIn.get(name).push(file);
    }

    // The rename ban runs on EVERY file, allowlisted included. The allowlist's reason is always
    // "this file must name the aggregate" — never "this file may give it a second name" — and
    // placing the ban behind the skip meant the ten files most entitled to name it were the ten
    // that could rename it. Demonstrated on the real tree: one `export type IHostAll =
    // ICommandHostContext;` in the allowlisted declaration site, plus an ordinary consumer using
    // `IHostAll`, left the scan green at its frozen baseline.
    for (const alias of findAggregateAliases(content, file, aggregates, {
      allowlisted: allowlist.has(file),
      carveOuts: renameCarveOuts,
      carveOutsUsed,
    })) {
      aliasFindings.push({
        rule: 'aggregate-renamed',
        detail:
          `${file}:${alias.line}: ${alias.aggregate} is renamed to ${alias.alias} through ${alias.form}. ` +
          `Renaming a guarded aggregate makes every downstream reference invisible to this ratchet — ` +
          `one line is enough to keep the whole surface while the count reads zero. There is no ` +
          `legitimate reason to rename it; declare the role port instead.`,
      });
    }

    // The allowlist exempts a file's REFERENCES from the count, and nothing else.
    if (allowlist.has(file)) continue;
    for (const hit of findAggregateReferences(content, file, aggregates)) {
      const bucket = counts.get(hit.aggregate);
      bucket.references += 1;
      bucket.files.set(file, (bucket.files.get(file) ?? 0) + 1);
    }
  }

  for (const [key, expected] of renameCarveOuts) {
    if (carveOutsUsed.has(key)) continue;
    aliasFindings.push({
      rule: 'rename-carve-out-unused',
      detail:
        `${key}: a rename carve-out is configured for a declaration that no longer matches. Either ` +
        `the site moved or was renamed, or its type stopped being \`${expected}\` — the exact type ` +
        `the exemption is written for. Either way the exemption now describes nothing, and an ` +
        `exemption that describes nothing is how one outlives its reason. Remove or update it.`,
    });
  }

  return { counts, examined, aliasFindings, declaredIn };
}

export function findAggregateNamingFindings(
  root = process.cwd(),
  config = loadHarnessConfig(),
  files,
) {
  const settings = config.aggregateNaming ?? {};
  const aggregates = settings.aggregates ?? [];
  if (aggregates.length === 0) {
    // Fail CLOSED. Returning "no findings" here made deleting one config array a silent way to
    // switch the load-bearing floor off — the same "absence reads as a pass" shape this scan exists
    // to close, moved one layer out into the config. Found by review round four.
    return {
      findings: [
        {
          rule: 'aggregate-scope-empty',
          detail:
            'aggregateNaming.aggregates is empty, so this floor guards nothing and prints the same ' +
            'result as a repository with zero references. The scope is the check.',
        },
      ],
      examined: 0,
      counts: new Map(),
    };
  }

  // Fail CLOSED over a root without the governed tree: a scan that reported "no findings" for a
  // tree it never read is indistinguishable from a clean repo, and this is the floor the design
  // marks load-bearing.
  const { counts, examined, aliasFindings, declaredIn } = collectAggregateNaming(
    root,
    config,
    files ?? trackedSources(root),
  );

  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(resolve(root, BASELINE_FILE), 'utf8'));
  } catch {
    baseline = {};
  }

  const findings = [...aliasFindings];

  // The ratchet's subject must exist AT ITS DECLARATION SITE. A count of 0 for an aggregate nothing
  // declares is not a finished migration — it is a check with no subject, and it reads identically
  // to success.
  //
  // "Declared somewhere in the tree" is not enough, and review measured why: renaming the real
  // aggregate and dropping a bare `interface ICommandHostContext {}` into an unimported `.d.ts`
  // satisfied the predicate and the scan went green against a frozen baseline. A decoy declaration
  // is a cheaper evasion than any of the rename routes. The allowlist already names each real
  // declaration site with a reason of the form "Declares X as an empty `extends` over its role
  // ports", so the site is pinned rather than merely counted.
  const allowlistedFiles = new Set((settings.allowlist ?? []).map((entry) => entry.file));
  for (const [aggregate, homes] of declaredIn ?? []) {
    const atSite = homes.filter((file) => allowlistedFiles.has(file));
    if (atSite.length > 0) continue;
    findings.push({
      rule: 'aggregate-declaration-missing',
      aggregate,
      detail:
        `${aggregate} is guarded by this ratchet but is declared in no allowlisted declaration site ` +
        `${homes.length > 0 ? `(found only in ${homes.join(', ')}, which the allowlist does not name) ` : '(declared nowhere in the scanned tree) '}` +
        `— so its reference count measures nothing. A count falls either because every consumer ` +
        `migrated or because the subject stopped existing under that name, and those read ` +
        `identically. Update aggregateNaming.aggregates and its allowlist if the move was intended.`,
    });
  }

  for (const [aggregate, bucket] of counts) {
    const frozen = baseline[aggregate];
    if (frozen === undefined) {
      findings.push({
        rule: 'aggregate-naming-unfrozen',
        aggregate,
        detail: `${aggregate}: ${bucket.references} type-position reference(s) with no frozen baseline — run --write-baseline`,
      });
      continue;
    }
    if (bucket.references > frozen) {
      const worst = [...bucket.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      findings.push({
        rule: 'aggregate-naming-grew',
        aggregate,
        detail:
          `${aggregate}: ${bucket.references} type-position reference(s) across ${bucket.files.size} file(s), up from a frozen ${frozen}. ` +
          `A consumer that names the aggregate takes the whole surface instead of the role it uses — declare the role port it needs. ` +
          `Most references: ${worst.map(([f, n]) => `${f} (${n})`).join(', ')}`,
      });
    }
  }
  return { findings, examined, counts };
}

function main() {
  const root = process.cwd();
  if (process.argv.includes('--write-baseline')) {
    const { counts } = collectAggregateNaming(root);
    const next = Object.fromEntries([...counts].map(([name, b]) => [name, b.references]));
    writeFileSync(resolve(root, BASELINE_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`aggregate-naming baseline regenerated: ${JSON.stringify(next)}`);
    return;
  }

  const { findings, examined, counts } = findAggregateNamingFindings(root);
  if (findings.length > 0) {
    console.error(`aggregate-naming failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  const total = [...counts.values()].reduce((sum, b) => sum + b.references, 0);
  console.log(`::examined:: ${examined} files`);
  console.log(
    `aggregate-naming passed (${counts.size} aggregate(s), ${total} reference(s) at baseline, ${examined} file(s) examined).`,
  );
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
