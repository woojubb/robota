#!/usr/bin/env node

/**
 * ARCH-013 stage 2: a resolved-preset field must reach a declared projection surface.
 *
 * ## What this measures, and why it is not "is the name read somewhere"
 *
 * `IResolvedPresetOptions` carries a claim in its own docblock — *"Every field maps to an existing
 * `agent-framework` session/assembly seam"* — and that claim has never been checked. Stage 1 built
 * `scan-option-reachability`, which covers the LAST hop (a declared `ICreateSessionOptions` key that
 * no production code assigns). This covers the FIRST hop, and the two together span the chain:
 *
 *   resolved preset → projection surface → IInitOptions → ICreateSessionOptions → createSession
 *                     ^^^^^^^^^^^^^^^^^^                                          ^^^^^^^^^^^^^
 *                     this scan                                                   stage 1's scan
 *
 * The obvious check — "grep each field name and see if anything reads it" — was tried and discarded,
 * for the reason stage 1 recorded when its own first version found 1 of 12: these names are not
 * unique. `temperature`, `allowedTools` and `model` each name keys of unrelated types across the
 * repo, so a name-anywhere search reports every field as reached and the floor can never fail.
 *
 * ## The actual defect: two hand-derived surfaces, neither checked against the source
 *
 * A resolved preset reaches a session through exactly two declared shapes, and BOTH are hand-written
 * subsets of the 20-field source with nothing tying them to it:
 *
 *   - `IPresetApplicationOptions` (10 fields) — the LIVE path, what `/preset` re-applies mid-session.
 *   - `IPresetSurfaceOptions` (7 fields) — the STARTUP path, what the shell forwards at launch.
 *
 * So this scan asks two questions a reader cannot answer by inspection:
 *
 *   1. **Is every source field projected at all?** A field in neither surface is computed, validated,
 *      and discarded — which is what `defaultTrustLevel` was measured to be.
 *   2. **Do the two surfaces agree?** A field one path applies and the other drops means ONE SESSION
 *      HOLDS TWO ANSWERS for the same preset depending on when it was chosen. That is not
 *      hypothetical: `effort` was exactly this — three of the four built-in presets set it, `/preset`
 *      applied it mid-session, and startup dropped it. Stage 1 fixed that instance. This rule is what
 *      makes the next one fail instead of shipping.
 *
 * A field that legitimately does not project is listed in `derivationOnly` with a reason — named and
 * expiring, never a structural skip. `autonomy` and `defaultPermissionMode` are the real cases: both
 * are INPUTS to the permission-mode derivation (`resolvePreset` promotes them into `permissionMode`),
 * so they are consumed before any surface sees them. An entry that stops matching a live field is
 * reported, so an exemption cannot outlive its reason.
 *
 * ## What this does NOT measure, stated because the difference is easy to misread
 *
 * A DECLARED projection is a surface interface member or a `Pick` of the source. A field read
 * straight off a resolved-preset value — `const modelId = resolvedPreset.model ?? …` in `cli.ts` —
 * is NOT one, and this floor reports it. That is deliberate, and it is not a false positive: `model`
 * genuinely does reach the session that way, so the finding is not "the field is dropped", it is
 * "the field is hand-mapped outside any declared surface". Hand-mapping is precisely what ARCH-013
 * was filed about — *"resolved intent is mapped to session options by hand at four sites and checked
 * at none"* — so the floor is right to name it, and the message says which of the two it means.
 *
 * Deciding "is this field read ANYWHERE" instead would need the type checker: the value arrives in
 * `cli.ts` as `preset.options` through an interface member, so no syntactic walk can tell that
 * identifier apart from any other. An earlier revision of this file tried, and its messages asserted
 * fields were "resolved, validated and then discarded" — false for `model`. The rule was narrowed to
 * what it can actually decide rather than left claiming more than it knows.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

/**
 * What the last run actually read. Exported so a test asserts the same number the scan prints
 * (measurement-provenance.md): a size only the scan reports is one nothing can contradict, and
 * "examined 0 interfaces" reads exactly like a fully-projected surface.
 */
let examinedInterfaces = 0;

export function examinedInterfaceCount() {
  return examinedInterfaces;
}

/**
 * The declared property names of one interface in `content`, in declaration order.
 *
 * Returns `undefined` when the interface is not declared in this file — distinct from "declared and
 * empty", because those two must not read alike. A renamed or moved interface is the commonest way
 * this kind of floor silently stops measuring anything.
 */
export function declaredFields(content, fileName, interfaceName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  let fields;
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name?.text === interfaceName) {
      // Accumulate rather than assign: TypeScript merges two declarations of one interface name, and
      // a floor that keeps only the last reads a type the compiler does not have. (ARCH-029 measured
      // this exact evasion on the command-host floor.)
      fields = [...(fields ?? []), ...(node.members ?? []).map(memberName).filter(Boolean)];
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return fields;
}

function memberName(member) {
  return member.name?.text ?? member.name?.escapedText ?? undefined;
}

/**
 * Fields projected by a `Pick<Source, 'a' | 'b'>` type reference in `content`.
 *
 * A named interface is not the only way a projection is declared, and treating it as the only way
 * made this scan's first run report two FALSE divergences. Startup does project the command-module
 * group — through `Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>`
 * in `robota-plumbing.ts`, not through the named startup interface. A floor that calls a real
 * projection a defect gets allowlisted into silence, so the mechanism has to see this form.
 *
 * `Pick` is also the BETTER form to find, because it is derived from the source type: rename a field
 * and it stops compiling, which a hand-copied interface member does not.
 */
export function pickedFields(content, fileName, sourceInterface) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const picks = [];
  const visit = (node) => {
    if (ts.isTypeReferenceNode(node)) {
      let name = node.typeName;
      while (name && ts.isQualifiedName(name)) name = name.right;
      if ((name?.text ?? name?.escapedText) === 'Pick') {
        const [target, keys] = node.typeArguments ?? [];
        let targetName = target?.typeName;
        while (targetName && ts.isQualifiedName(targetName)) targetName = targetName.right;
        if ((targetName?.text ?? targetName?.escapedText) === sourceInterface && keys) {
          const literals = [];
          const collect = (n) => {
            if (ts.isLiteralTypeNode(n) && n.literal?.text) literals.push(n.literal.text);
            ts.forEachChild(n, collect);
          };
          collect(keys);
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          // A `Pick` whose keys this walk cannot read is REPORTED by the caller, not treated as
          // projecting nothing — absence and unreadability must not print the same.
          picks.push({ file: fileName, line: line + 1, fields: literals });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return picks;
}

/**
 * Every `Pick<Source, …>` across the tracked TypeScript tree.
 *
 * The whole tree, not a configured file list: a projection can be declared anywhere, and a list of
 * places to look is a list that stops covering the place somebody adds. A cheap `includes` reject
 * keeps this to the handful of files that mention the source type at all.
 */
function discoverPicks(root, sourceInterface, settings) {
  const files =
    settings.trackedFiles ??
    execFileSync('git', ['ls-files', 'packages', 'apps'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mts'));

  const picks = [];
  for (const file of files) {
    let content;
    try {
      content = readFileSync(join(root, file), 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(sourceInterface) || !content.includes('Pick<')) continue;
    picks.push(...pickedFields(content, file, sourceInterface));
  }
  return picks;
}

/**
 * Findings for one configured source/surface set. `settings` is injectable so `examined` can be
 * asserted exactly against a fixture of known size rather than self-reported.
 */
export function findPresetProjectionFindings(root = process.cwd(), settingsOverride) {
  const settings = settingsOverride ?? loadHarnessConfig(root).presetProjection ?? {};
  const source = settings.source;
  const surfaces = settings.surfaces ?? [];

  // Fail CLOSED on an empty scope. Returning "no findings" here would make deleting one config key a
  // silent way to switch the floor off — the shape this whole family of scans exists to refuse.
  if (!source?.file || !source?.interface || surfaces.length === 0) {
    return {
      findings: [
        {
          rule: 'preset-projection-scope-empty',
          detail:
            `presetProjection is configured with source=${JSON.stringify(source ?? null)} and ` +
            `${surfaces.length} surface(s). An empty scope measures nothing and prints the same ` +
            `result as a fully-projected preset.`,
        },
      ],
      examined: 0,
    };
  }

  const files = [source.file, ...surfaces.map((s) => s.file)];
  requireGovernedTree(root, files, { scan: 'preset-projection' });

  examinedInterfaces = 0;
  const findings = [];

  const sourceFields = declaredFields(
    readFileSync(join(root, source.file), 'utf8'),
    source.file,
    source.interface,
  );
  if (sourceFields === undefined) {
    findings.push({
      rule: 'preset-projection-source-missing',
      detail:
        `${source.file} declares no interface named ${source.interface}. This floor derives every ` +
        `question from that declaration, so a rename or a move leaves it measuring nothing — and ` +
        `"no unprojected fields" would then read exactly like a finished projection.`,
    });
    return { findings, examined: examinedInterfaces };
  }
  examinedInterfaces += 1;

  const projected = new Map();
  for (const surface of surfaces) {
    const fields = declaredFields(
      readFileSync(join(root, surface.file), 'utf8'),
      surface.file,
      surface.interface,
    );
    if (fields === undefined) {
      findings.push({
        rule: 'preset-projection-surface-missing',
        detail:
          `${surface.file} declares no interface named ${surface.interface}. A surface this floor ` +
          `cannot read is treated as a finding rather than as "projects nothing", because the ` +
          `second would silently widen every other rule here.`,
      });
      continue;
    }
    examinedInterfaces += 1;
    projected.set(surface.interface, { fields: new Set(fields), surface });
  }

  // Discovered projections: every `Pick<Source, …>` in the tracked tree, attributed to a role by the
  // path prefixes each surface declares. A Pick under NO declared prefix is reported rather than
  // dropped — otherwise the prefix list could silently narrow what "the startup path" means, which
  // is the same absence-reads-as-a-pass shape the rest of this file refuses.
  for (const pick of discoverPicks(root, source.interface, settings)) {
    const owner = surfaces.find((s) =>
      (s.paths ?? []).some((prefix) => pick.file.startsWith(prefix)),
    );
    if (!owner) {
      findings.push({
        rule: 'preset-projection-unattributed',
        detail:
          `${pick.file}:${pick.line} projects ${source.interface} via Pick<…> but sits under no ` +
          `declared surface path. This floor cannot tell which path applies it, so it cannot tell ` +
          `whether the two paths agree — add the file's prefix to a surface's \`paths\`.`,
      });
      continue;
    }
    const entry = projected.get(owner.interface);
    if (entry) for (const field of pick.fields) entry.fields.add(field);
  }

  const derivationOnly = new Map(
    (settings.derivationOnly ?? []).map((entry) => [entry.field, entry.reason]),
  );
  // `pendingProjection` is the burn-down: a field this floor HAS measured as undeclared, whose fix
  // needs a decision this scan cannot make. It is a list of named fields with reasons, not an opaque
  // count, and that is the whole point — ARCH-029 spent two review rounds establishing that an
  // exemption which is unnamed or non-expiring is indistinguishable from no floor. Each entry is
  // visible in review, must name what would resolve it, and is REPORTED the moment it stops
  // matching. The list may shrink and must never grow without a reviewed reason beside it.
  const pending = new Map((settings.pendingProjection ?? []).map((e) => [e.field, e.reason]));
  const sourceFieldSet = new Set(sourceFields);
  for (const [field, list] of [
    ...[...derivationOnly.keys()].map((f) => [f, 'derivationOnly']),
    ...[...pending.keys()].map((f) => [f, 'pendingProjection']),
  ]) {
    if (sourceFieldSet.has(field)) continue;
    findings.push({
      rule: 'preset-exemption-unused',
      detail:
        `${field} is listed in presetProjection.${list} but ${source.interface} no longer declares ` +
        `it. An exemption that matches no live field describes nothing, and one nobody can see ` +
        `expire is how it outlives its reason.`,
    });
  }

  // (1) Every source field must reach at least one declared surface.
  for (const field of sourceFields) {
    if (derivationOnly.has(field) || pending.has(field)) continue;
    const reached = [...projected.values()].some((p) => p.fields.has(field));
    if (reached) continue;
    findings.push({
      rule: 'preset-field-undeclared',
      field,
      detail:
        `${source.interface}.${field} is declared on the source but appears in no declared ` +
        `projection surface (${[...projected.keys()].join(', ')}) and no Pick of the source. Either ` +
        `it reaches no session at all, or it is hand-mapped somewhere this floor cannot see — and ` +
        `ARCH-013 exists because those two are indistinguishable from the type alone. Declare it on ` +
        `a surface, or list it in presetProjection.derivationOnly with a reason.`,
    });
  }

  // (2) The surfaces must not diverge. A field one path applies and another drops means one session
  //     holds two answers for the same preset depending on when it was chosen.
  for (const [name, entry] of projected) {
    for (const field of entry.fields) {
      if (!sourceFieldSet.has(field)) continue;
      if (pending.has(field)) continue;
      for (const [otherName, other] of projected) {
        if (otherName === name || other.fields.has(field)) continue;
        findings.push({
          rule: 'preset-surface-divergence',
          field,
          detail:
            `${field} is declared by ${name} (${entry.surface.role}) but by no declared projection ` +
            `on ${otherName} (${other.surface.role}). Either that path drops the field — one session ` +
            `then holding two answers for the same preset depending on WHEN it was chosen, which is ` +
            `what \`effort\` did before stage 1 — or it hand-maps the field outside any declared ` +
            `surface, which is this item's cause rather than its exception. Check which, then ` +
            `declare it on that surface.`,
        });
      }
    }
  }

  return { findings, examined: examinedInterfaces };
}

function main() {
  const { findings, examined } = findPresetProjectionFindings(process.cwd());
  if (findings.length > 0) {
    console.error(`preset-projection failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} interfaces`);
  console.log(`preset-projection passed (${examined} interface(s) examined).`);
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
