#!/usr/bin/env node

/**
 * ARCH-029 TC-06: a role port carries no optional members.
 *
 * ## Why this and not an aggregate-level ceiling
 *
 * The obvious floor — "cap the optional-member count on the aggregate" — would NOT have caught the
 * regression it is meant to catch. Measured on the contract this guards: `getAgentJobCapability?()`
 * adds **15** members to the surface a command can reach while contributing **1** to any optional
 * count, and `getSession()` adds **18** while contributing **0**, because it is required. The
 * quantity a ceiling measures and the quantity that actually grew are different quantities.
 *
 * The per-port rule is the one that binds. An optional member on a role port means "this host may
 * or may not do this", and every consumer of that port then has to invent an answer for the absent
 * case — which is where a framework-owned default becomes a second implementation nobody owns. The
 * contract this guards had thirteen such sites and one of them, `clearConversationHistory`, diverged
 * behaviourally: the host path broadcast `history_cleared` to every attached surface and the
 * fallback did not, so a fallback clear left other surfaces still showing the transcript.
 *
 * ## The carve-out is named, and it is a real distinction
 *
 * A genuinely variational adapter bag is not the same thing. `getCommandHostAdapters?()` returns a
 * bag whose CONTENTS vary by host by design; making it required would force every host to answer a
 * question that has no single answer. That is the difference the rule keeps: a member may be
 * optional when its VALUE is legitimately variational, never merely because a host might not have
 * got round to it. Each carve-out is listed in the harness config with a reason, so adding one is a
 * visible config change.
 *
 * ## Names resolve through the DECLARING FILE, and an unresolved name is a finding
 *
 * Four review rounds each closed one syntactic form on this floor — a heritage clause, an import
 * alias, a qualified name, a cross-file duplicate — and every one was the same shape underneath: a
 * name the scan could not resolve, treated as ABSENCE, and absence read as a pass. Round three
 * adopted half the remedy ("an unresolvable name is a finding") and left the other half, which is
 * the half that actually binds: **resolve a name through the file that declares it, not through one
 * flat repo-wide map.**
 *
 * A bare-name map is wrong in both directions, and round four demonstrated both on the real guarded
 * files, all four routes compiling clean under `--strict`:
 *
 *   - **Mis-resolution.** `import type { IEvil as ICommandSessionHistory } from './hidden.js'` in
 *     the aggregate's own file resolved the heritage edge to the INNOCENT declaration a sibling
 *     scanned file happens to hold. The evil members were live on the aggregate and unread here.
 *   - **Overwrite within one file.** TypeScript merges two declarations of one interface name. A
 *     `Map.set` keeps only the last, so writing the decoy half FIRST hid the real optional member —
 *     on a role port, and on the aggregate itself, where it also silenced TC-04.
 *
 * So a declaration is keyed by `file#name`, member lists ACCUMULATE across merged declarations, and
 * a heritage name is looked up in the declaring file's own scope (its local declarations, then its
 * imports, following a relative specifier to another scanned file). Anything that does not resolve
 * to a declaration this floor actually read is a finding — including a construct it cannot model,
 * such as an interface nested in a namespace.
 */

import { readFileSync } from 'node:fs';
import { dirname, join as joinPosix } from 'node:path/posix';
import { join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

/**
 * What the last `findRolePortOptionalFindings` run actually read. Exported for the same reason the
 * sibling scan exports its counter: a self-reported size is one nothing can contradict, and this
 * scan already shipped one silent version whose detector reported zero for every input.
 *
 * Reset at the start of every run, so a second assertion over one fixture tells an accumulating
 * counter apart from a growing subject.
 */
let examinedFiles = 0;

export function examinedFileCount() {
  return examinedFiles;
}

/**
 * A member's name for reporting. Index, call and construct signatures have no name at all, so they
 * are printed as their source text — `<unnamed>` names nothing a reader can act on, and these
 * shapes DO reach the `aggregate-has-own-members` rule.
 */
function memberLabel(member, sourceFile) {
  const named = member.name?.text ?? member.name?.escapedText;
  if (named) return named;
  const text = member.getText?.(sourceFile)?.split('\n')[0]?.trim();
  return text ? text.slice(0, 80) : '<unnamed>';
}

/**
 * Everything in ONE file that this floor resolves names against:
 *
 * - `interfaces`: name → `{ members, optional, parents }`, **accumulated** across every declaration
 *   of that name in this file. TypeScript merges them into one type, so a floor that keeps only the
 *   last declaration reads a type the compiler does not have.
 * - `imports`: local name → `{ module, exported }`, so a heritage name this file does not declare
 *   can be followed to the file that does.
 * - `nested`: interfaces declared inside a `namespace`/`module` block. This floor addresses
 *   declarations by top-level name and cannot model namespace scope, so it reports them rather than
 *   folding them in — a decoy `declare namespace d { interface IPortA { … } }` beside a real
 *   `IPortA` is otherwise indistinguishable from a second declaration of the real one.
 * - `unreadable`: a heritage expression no name could be read from at all.
 */
export function declarationsOf(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const interfaces = new Map();
  const imports = new Map();
  const nested = [];
  const unreadable = [];

  const readInterface = (node) => {
    const parents = [];
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types ?? []) {
        let expr = type.expression;
        // `extends ns.IPort` parses as a PropertyAccessExpression, which answers neither `.text`
        // nor `.escapedText`. Walking to the tail identifier gives a name to resolve; resolution
        // then fails in the declaring file (the tail is neither local nor a named import), which is
        // the fail-closed answer a qualified heritage name deserves here.
        while (expr && ts.isPropertyAccessExpression(expr)) expr = expr.name;
        const name = expr?.text ?? expr?.escapedText;
        if (name) parents.push(name);
        else unreadable.push({ child: node.name.text, text: type.getText?.(sourceFile) ?? '?' });
      }
    }

    // `postfixToken`, NOT `questionToken`. The native AST does not populate `questionToken` on a
    // type member — it answers `undefined` for `a?(): void` just as it does for `b(): void`, so a
    // detector reading it reports zero optionals for every input and its floor cannot fail. This
    // was measured, not assumed: reintroducing an optional member left the scan green.
    // `postfixToken` also draws the line this rule needs — `e(x?: number)` has an optional
    // PARAMETER and no postfix, so a required member with an optional argument is not flagged.
    const members = (node.members ?? []).map((member) => memberLabel(member, sourceFile));
    const optional = (node.members ?? [])
      .filter((member) => member.postfixToken?.kind === ts.SyntaxKind.QuestionToken)
      .map((member) => memberLabel(member, sourceFile));

    const existing = interfaces.get(node.name.text);
    if (existing) {
      existing.members.push(...members);
      existing.optional.push(...optional);
      existing.parents.push(...parents);
      existing.declarations += 1;
    } else {
      interfaces.set(node.name.text, { members, optional, parents, declarations: 1 });
    }
  };

  const visit = (node, inModule) => {
    if (ts.isModuleDeclaration(node)) {
      const collect = (inner) => {
        if (ts.isInterfaceDeclaration(inner)) nested.push({ name: inner.name.text });
        ts.forEachChild(inner, collect);
      };
      ts.forEachChild(node, collect);
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      if (inModule) nested.push({ name: node.name.text });
      else readInterface(node);
    }
    if (ts.isImportDeclaration(node)) {
      const module = node.moduleSpecifier?.text;
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        const local = element.name?.text;
        if (local) imports.set(local, { module, exported: element.propertyName?.text ?? local });
      }
    }
    ts.forEachChild(node, (child) => visit(child, inModule));
  };
  visit(sourceFile, false);

  return { interfaces, imports, nested, unreadable };
}

/**
 * Optional members of each interface declared in `content`, by interface name.
 *
 * Read from the AST: a regex over `name?(` also matches an optional CALL in a docblock example and
 * misses a property-signature form written as `name?: () => void`. Both directions matter here —
 * this floor is meant to reach zero and stay there, and one that over-fires gets silenced.
 */
export function findOptionalMembers(content, fileName, only) {
  const { interfaces } = declarationsOf(content, fileName);
  if (!only) return interfaces;
  return new Map([...interfaces].filter(([name]) => only.has(name)));
}

/**
 * The scanned file a relative module specifier names, or `undefined`.
 *
 * Only relative specifiers can reach another scanned file; a package specifier necessarily leaves
 * the governed set, and saying so is the point — the caller turns that into a finding.
 */
export function resolveModuleFile(fromFile, specifier, fileSet) {
  if (!specifier || !specifier.startsWith('.')) return undefined;
  const base = joinPosix(dirname(fromFile), specifier).replace(/\.(js|mjs|cjs)$/, '');
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
  ]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The inheritance closure of `aggregates`, as `file#name` keys — the aggregates INCLUDED.
 *
 * Seeding with the aggregates themselves, rather than with their `extends` names, is what covers the
 * motion this design's trajectory table actually measures: the contract reached 46 members by
 * accreting them into its OWN body, and a scope built from the `extends` list exempts the one
 * interface the floor protects.
 *
 * Every edge is resolved in the file that declares the child. A name that resolves to no declaration
 * this floor read is returned as a finding, never dropped: a dropped edge takes its members out of
 * scope silently, which is the failure this whole floor is a response to.
 */
export function resolveScope(fileDecls, aggregates, fileSet) {
  const findings = [];
  const scope = new Map();
  const queue = [];

  for (const aggregate of aggregates) {
    const homes = [...fileDecls].filter(([, decls]) => decls.interfaces.has(aggregate));
    if (homes.length > 1) {
      findings.push({
        rule: 'aggregate-declared-in-multiple-files',
        detail:
          `${aggregate} is declared in ${homes.length} scanned files (${homes.map(([f]) => f).join(', ')}). ` +
          `This floor resolves an aggregate through the file that declares it, and two homes make ` +
          `"the declaring file" ambiguous — one of them would be checked and the other would not.`,
      });
      continue;
    }
    if (homes.length === 1) queue.push({ file: homes[0][0], name: aggregate });
  }

  while (queue.length > 0) {
    const { file, name } = queue.pop();
    const key = `${file}#${name}`;
    if (scope.has(key)) continue;
    const entry = fileDecls.get(file)?.interfaces.get(name);
    if (!entry) continue;
    scope.set(key, { file, name, entry });

    for (const parent of entry.parents) {
      if (fileDecls.get(file).interfaces.has(parent)) {
        queue.push({ file, name: parent });
        continue;
      }
      const imported = fileDecls.get(file).imports.get(parent);
      const target = imported ? resolveModuleFile(file, imported.module, fileSet) : undefined;
      if (target && fileDecls.get(target)?.interfaces.has(imported.exported)) {
        queue.push({ file: target, name: imported.exported });
        continue;
      }
      findings.push({
        rule: 'role-port-declaration-unscanned',
        detail:
          `${file}: ${name} extends ${parent}, which resolves to no declaration this floor read ` +
          `(${imported ? `imported from '${imported.module}'` : 'not declared in this file and not imported'}). ` +
          `Its members are reachable through the aggregate and went unchecked — add the declaring ` +
          `file to rolePortOptionals.files. Renaming on import is how a decoy is substituted for a ` +
          `real port, so a name that does not resolve is a finding rather than a skip.`,
      });
    }
  }

  return { scope, findings };
}

/**
 * `examined` is an OUTPUT, so `settings` is injectable and the count is asserted exactly against a
 * fixture of known size (measurement-provenance.md) — a self-reported size nothing checks is how a
 * scan that read nothing reports a pass.
 */
export function findRolePortOptionalFindings(root = process.cwd(), settingsOverride) {
  const settings = settingsOverride ?? loadHarnessConfig(root).rolePortOptionals ?? {};
  const files = settings.files ?? [];
  const aggregates = settings.aggregates ?? [];

  // Fail CLOSED on an empty scope, at BOTH config keys. Returning `{ findings: [] }` here made
  // deleting one config array a silent way to switch the floor off — the same "absence reads as a
  // pass" shape this scan exists to close, moved one layer out into the config. Found by review,
  // which noted the asymmetry (empty `aggregates` already failed closed) marked it an oversight.
  if (files.length === 0 || aggregates.length === 0) {
    return {
      findings: [
        {
          rule: 'role-port-scope-empty',
          detail:
            `rolePortOptionals is configured with ${files.length} file(s) and ${aggregates.length} ` +
            `aggregate(s). An empty scope examines nothing, and a floor that examines nothing prints ` +
            `the same result as a clean tree.`,
        },
      ],
      examined: 0,
      carveOuts: 0,
    };
  }

  // Fail CLOSED over a root without the governed tree: "no findings" for a tree never read is
  // indistinguishable from a clean one.
  requireGovernedTree(root, files, { scan: 'role-port-optionals' });

  const carveOuts = new Map(
    (settings.carveOuts ?? []).map((entry) => [`${entry.interface}.${entry.member}`, entry.reason]),
  );

  // Read every file FIRST, keeping each file's declarations separate. Merging them into one
  // repo-wide name map is the defect round four demonstrated: a name then resolves to whichever
  // scanned file happens to declare it rather than to the file the declaring file's own imports
  // point at.
  examinedFiles = 0;
  const fileSet = new Set(files);
  const fileDecls = new Map();
  for (const file of files) {
    fileDecls.set(file, declarationsOf(readFileSync(join(root, file), 'utf8'), file));
    examinedFiles += 1;
  }

  const findings = [];

  for (const [file, decls] of fileDecls) {
    // An unresolvable name is a finding — the rule the earlier rounds each patched one form of.
    for (const entry of decls.unreadable) {
      findings.push({
        rule: 'heritage-name-unresolvable',
        detail:
          `${file}: ${entry.child} extends an expression this scan cannot read a name from ` +
          `(\`${entry.text}\`). Its members reach the aggregate and this floor cannot see them. ` +
          `Silence here is indistinguishable from safety, so it fails instead.`,
      });
    }
    // A namespace-scoped declaration is a construct this floor cannot model, so it says so instead
    // of guessing. Left unreported, `declare namespace d { interface IPortA { … } }` is read as a
    // second declaration of a top-level `IPortA` and merged into the real one.
    for (const entry of decls.nested) {
      findings.push({
        rule: 'namespace-scoped-declaration',
        detail:
          `${file}: ${entry.name} is declared inside a namespace. This floor addresses declarations ` +
          `by top-level name and cannot tell a namespaced interface from a second declaration of the ` +
          `top-level one, so a namespaced decoy would merge into a real role port.`,
      });
    }
  }

  const { scope, findings: scopeFindings } = resolveScope(fileDecls, aggregates, fileSet);
  findings.push(...scopeFindings);

  if (scope.size === 0) {
    // Fail CLOSED: nothing resolved means the aggregates were renamed or moved, and a scan that
    // then examines nothing reports a clean result for a check it never ran.
    findings.push({
      rule: 'role-port-scope-empty',
      detail: `no role ports resolved from ${JSON.stringify(aggregates)} across ${files.length} file(s) — the aggregates were renamed or moved, so this floor examined nothing.`,
    });
    return { findings, examined: examinedFiles, carveOuts: carveOuts.size };
  }

  // TC-04's "each aggregate is an empty `extends`" was mechanised NOWHERE — review found no check
  // for it anywhere in the harness. An optional member added to an aggregate body is caught by the
  // closure below, but a REQUIRED one is not, and that is the exact motion the design's trajectory
  // table records: this contract reached 46 members by accreting them into its body.
  for (const { file, name, entry } of scope.values()) {
    if (!aggregates.includes(name) || entry.members.length === 0) continue;
    findings.push({
      rule: 'aggregate-has-own-members',
      detail:
        `${file}: ${name} declares ${entry.members.length} member(s) of its own ` +
        `(${entry.members.join(', ')})${entry.declarations > 1 ? ` across ${entry.declarations} merged declarations` : ''}. ` +
        `An aggregate is an empty \`extends\` over role ports — a member added to its body belongs ` +
        `to no capability and is how this contract grew from 20 members to 46.`,
    });
  }

  for (const { file, name, entry } of scope.values()) {
    for (const member of entry.optional) {
      if (carveOuts.has(`${name}.${member}`)) continue;
      findings.push({
        rule: 'role-port-optional-member',
        detail:
          `${file}: ${name}.${member}? is optional. A role port carries no optional members — ` +
          `an absent member forces every consumer to invent an answer for it, which is how a ` +
          `framework-owned default becomes a second implementation nobody owns. Make it required, ` +
          `or add a carve-out with a reason if its VALUE is genuinely variational.`,
      });
    }
  }
  return { findings, examined: examinedFiles, carveOuts: carveOuts.size };
}

function main() {
  const { findings, examined, carveOuts } = findRolePortOptionalFindings(process.cwd());
  if (findings.length > 0) {
    console.error(`role-port-optionals failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} files`);
  console.log(
    `role-port-optionals passed (0 optional member(s), ${carveOuts} named carve-out(s), ${examined} file(s) examined).`,
  );
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
