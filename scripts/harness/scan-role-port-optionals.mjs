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
export function rolePortsOf(content, fileName, aggregates) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const ports = new Set();
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && aggregates.includes(node.name.text)) {
      for (const clause of node.heritageClauses ?? []) {
        for (const type of clause.types ?? []) {
          const name = type.expression?.text ?? type.expression?.escapedText;
          if (name) ports.add(name);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ports;
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
      const optional = (node.members ?? [])
        .filter((member) => member.postfixToken?.kind === ts.SyntaxKind.QuestionToken)
        .map((member) => member.name?.text ?? member.name?.escapedText ?? '<unnamed>');
      byInterface.set(node.name.text, optional);
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
  const findings = [];
  let examined = 0;
  examinedFiles = 0;

  const aggregates = settings.aggregates ?? [];
  for (const file of files) {
    const content = readFileSync(join(root, file), 'utf8');
    const ports = rolePortsOf(content, file, aggregates);
    if (ports.size === 0) {
      // Fail CLOSED: no ports resolved means the aggregates were renamed or the file moved, and a
      // scan that then examines nothing reports a clean result for a check it never ran.
      findings.push({
        rule: 'role-port-scope-empty',
        detail: `${file}: no role ports resolved from ${JSON.stringify(aggregates)} — the aggregates were renamed or moved, so this floor examined nothing.`,
      });
      continue;
    }
    const byInterface = findOptionalMembers(content, file, ports);
    examined += 1;
    examinedFiles += 1;
    for (const [name, optional] of byInterface) {
      for (const member of optional) {
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
  }
  return { findings, examined, carveOuts: carveOuts.size };
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
