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
 */

import { readFileSync } from 'node:fs';
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
 * The role ports a set of aggregates is composed from — every name in their `extends` clauses.
 *
 * Derived rather than listed, because a hand-maintained list of ports is a list that silently stops
 * covering a port somebody adds. This is the same reason the scan checks only these interfaces: the
 * guarded file also declares DATA shapes (`IModelReapplyOptions` is a patch; every field is
 * legitimately absent), and a rule about capability contracts does not apply to an options bag.
 */
export function heritageOf(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const edges = new Map();
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      const parents = [];
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types ?? []) {
          const name = type.expression?.text ?? type.expression?.escapedText;
          if (name) parents.push(name);
        }
      }
      edges.set(node.name.text, parents);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges;
}

/**
 * Every interface in the aggregates' inheritance closure — the aggregates INCLUDED.
 *
 * Seeded with the aggregates and closed transitively, because the first two versions of this scan
 * both scoped it one hop and both were walked past. Review demonstrated each:
 *
 *   A. an optional member written into the AGGREGATE'S OWN BODY. Scoping to the `extends` names
 *      exempts the very interface the floor protects — and that is not an exotic route, it is the
 *      one the design's trajectory table measures: this contract went 20 members to 46 by having
 *      members added to its body.
 *   B. an optional member one hop BELOW a listed port (`IPort extends IPortExtra`), in a file the
 *      scan already reads.
 *
 * A closure closes both, and any deeper nesting, without a list to keep current.
 */
export function rolePortsOf(content, fileName, aggregates) {
  const edges = heritageOf(content, fileName);
  const scope = new Set();
  const queue = [...aggregates];
  while (queue.length > 0) {
    const name = queue.pop();
    if (scope.has(name)) continue;
    scope.add(name);
    for (const parent of edges.get(name) ?? []) queue.push(parent);
  }
  return scope;
}

/**
 * Optional members of each interface declared in `content`, by interface name.
 *
 * Read from the AST: a regex over `name?(` also matches an optional CALL in a docblock example and
 * misses a property-signature form written as `name?: () => void`. Both directions matter here —
 * this floor is meant to reach zero and stay there, and one that over-fires gets silenced.
 */
export function findOptionalMembers(content, fileName, only) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const byInterface = new Map();

  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && (!only || only.has(node.name.text))) {
      // `postfixToken`, NOT `questionToken`. The native AST does not populate `questionToken` on a
      // type member — it answers `undefined` for `a?(): void` just as it does for `b(): void`, so a
      // detector reading it reports zero optionals for every input and its floor cannot fail. This
      // was measured, not assumed: reintroducing an optional member left the scan green.
      // `postfixToken` also draws the line this rule needs — `e(x?: number)` has an optional
      // PARAMETER and no postfix, so a required member with an optional argument is not flagged.
      const named = (member) => member.name?.text ?? member.name?.escapedText ?? '<unnamed>';
      const members = (node.members ?? []).map(named);
      const optional = (node.members ?? [])
        .filter((member) => member.postfixToken?.kind === ts.SyntaxKind.QuestionToken)
        .map(named);
      byInterface.set(node.name.text, { members, optional });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return byInterface;
}

/**
 * `examined` is an OUTPUT, so `settings` is injectable and the count is asserted exactly against a
 * fixture of known size (measurement-provenance.md) — a self-reported size nothing checks is how a
 * scan that read nothing reports a pass.
 */
export function findRolePortOptionalFindings(root = process.cwd(), settingsOverride) {
  const settings = settingsOverride ?? loadHarnessConfig(root).rolePortOptionals ?? {};
  const files = settings.files ?? [];
  if (files.length === 0) return { findings: [], examined: 0 };

  // Fail CLOSED over a root without the governed tree: "no findings" for a tree never read is
  // indistinguishable from a clean one.
  requireGovernedTree(root, files, { scan: 'role-port-optionals' });

  const carveOuts = new Map(
    (settings.carveOuts ?? []).map((entry) => [`${entry.interface}.${entry.member}`, entry.reason]),
  );
  const aggregates = settings.aggregates ?? [];

  // TWO passes over the whole file set, not one pass per file. Scoping per file was wrong in both
  // directions: a file that declares ports but no aggregate looked like an empty scope, and a port
  // declared in a file the aggregate does not live in was never inspected at all. Review
  // demonstrated the second: a new role file with an optional member, added to the aggregate's
  // `extends`, printed "0 optional member(s)" while that member was reachable through the aggregate.
  examinedFiles = 0;
  const declared = new Map();
  const edges = new Map();
  for (const file of files) {
    const content = readFileSync(join(root, file), 'utf8');
    examinedFiles += 1;
    // Heritage edges are merged across the WHOLE file set before the closure is taken: the
    // aggregates live in one file and inherit ports declared in others, so a per-file closure stops
    // at the first file boundary and silently narrows the scope it is meant to widen.
    for (const [name, parents] of heritageOf(content, file)) edges.set(name, parents);
    for (const [name, entry] of findOptionalMembers(content, file)) {
      declared.set(name, { file, ...entry });
    }
  }

  const ports = new Set();
  const queue = [...aggregates];
  while (queue.length > 0) {
    const name = queue.pop();
    if (ports.has(name)) continue;
    ports.add(name);
    for (const parent of edges.get(name) ?? []) queue.push(parent);
  }

  const findings = [];
  if (ports.size === 0) {
    // Fail CLOSED: no ports resolved means the aggregates were renamed or moved, and a scan that
    // then examines nothing reports a clean result for a check it never ran.
    findings.push({
      rule: 'role-port-scope-empty',
      detail: `no role ports resolved from ${JSON.stringify(aggregates)} across ${files.length} file(s) — the aggregates were renamed or moved, so this floor examined nothing.`,
    });
    return { findings, examined: examinedFiles, carveOuts: carveOuts.size };
  }

  // TC-04's "each aggregate is an empty `extends`" was mechanised NOWHERE — review found no check
  // for it anywhere in the harness. An optional member added to an aggregate body is now caught by
  // the closure above, but a REQUIRED one is not, and that is the exact motion the design's
  // trajectory table records: this contract reached 46 members by accreting them into its body.
  for (const aggregate of aggregates) {
    const decl = declared.get(aggregate);
    if (decl && decl.members.length > 0) {
      findings.push({
        rule: 'aggregate-has-own-members',
        detail:
          `${decl.file}: ${aggregate} declares ${decl.members.length} member(s) of its own ` +
          `(${decl.members.join(', ')}). An aggregate is an empty \`extends\` over role ports — a ` +
          `member added to its body belongs to no capability and is how this contract grew from 20 ` +
          `members to 46.`,
      });
    }
  }

  for (const port of ports) {
    const decl = declared.get(port);
    if (!decl) {
      findings.push({
        rule: 'role-port-declaration-unscanned',
        detail:
          `${port} is named in an aggregate's \`extends\` clause but is declared in no scanned file. ` +
          `Its members are reachable through the aggregate and this floor never read them — add its ` +
          `file to rolePortOptionals.files.`,
      });
      continue;
    }
    for (const member of decl.optional) {
      if (carveOuts.has(`${port}.${member}`)) continue;
      findings.push({
        rule: 'role-port-optional-member',
        detail:
          `${decl.file}: ${port}.${member}? is optional. A role port carries no optional members — ` +
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
