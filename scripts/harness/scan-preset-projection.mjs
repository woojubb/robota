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
 * subsets of the 19-field source with nothing tying them to it:
 *
 *   - `IPresetApplicationOptions` (10 fields) — the LIVE path, what `/preset` re-applies mid-session.
 *   - `IPresetSurfaceOptions` (7 members, 6 of them preset fields — `activePresetId` is the preset's
 *     id, not one of its options) — the STARTUP path, what the shell forwards at launch.
 *
 * So this scan asks two questions a reader cannot answer by inspection:
 *
 *   1. **Is every source field DECLARED in some projection?** A field in neither surface either
 *      reaches nothing — which is what `defaultTrustLevel` was measured to be — or is hand-mapped
 *      somewhere this walk cannot see, which is `model`. The rule does not distinguish them and does
 *      not claim to; see the stated limit below.
 *   2. **Do the two surfaces agree?** A field one path applies and the other drops means ONE SESSION
 *      HOLDS TWO ANSWERS for the same preset depending on when it was chosen. That is not
 *      hypothetical: `effort` was exactly this — three of the four built-in presets set it, `/preset`
 *      applied it mid-session, and startup dropped it. Stage 1 fixed that instance. This rule is what
 *      makes the next one fail instead of shipping.
 *
 * A field that legitimately does not project is listed in `derivationOnly` with a reason — named and
 * expiring, never a structural skip. `autonomy` and `defaultPermissionMode` are the real cases: both
 * are INPUTS to the permission-mode derivation (`resolvePreset` promotes them into `permissionMode`),
 * so the surfaces project the derived field instead. They do survive on the resolved object — the
 * resolver spreads (`{ ...resolved, permissionMode }`) — so the precise statement is that they are
 * not projected, not that they are gone. An entry that stops matching a live field is reported, so
 * an exemption cannot outlive its reason.
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
 * The two readers deliberately disagree about SCOPE, and the difference is worth stating because it
 * looks like an inconsistency. `declaredFields` collects module-scope declarations only, because a
 * nested `interface` is a scope TypeScript does not merge — folding it in would read a type the
 * compiler does not have. `pickedFields` walks recursively, because a `Pick<Source, …>` written as a
 * type annotation inside a function body IS a real projection of real code, whatever scope it sits
 * in. One is about which declaration exists; the other is about which fields something consumes.
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
 * Local names bound to `sourceInterface` by an aliased import in this file.
 *
 * Extracted so BOTH readers share it. Review round 2 found the alias map living only in
 * `pickedFields`, so `declaredFields`' heritage walk called `pickFromType` without it and a surface
 * written as `extends Pick<AliasedSource, …>` produced a FALSE `preset-projection-heritage-unresolved`
 * — the recommended derived form plus an aliased import, which is round 1's MUST recurring one level
 * in. One map, one call site each, so the two cannot drift apart again.
 */
function importAliases(sourceFile, sourceInterface) {
  const aliases = new Map();
  if (!sourceInterface) return aliases;
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        if (element.propertyName?.text === sourceInterface && element.name?.text) {
          aliases.set(element.name.text, sourceInterface);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

/**
 * `{ fields, unresolved }` for one MODULE-SCOPE interface in `content`, following `extends`.
 *
 * `fields` is every property name the interface declares or inherits, in declaration order.
 * `unresolved` is every heritage clause the walk could not follow — a base in another file, an
 * unmodelled utility type, or a `Pick`/`Omit` whose key list yields no literal. The caller reports
 * those: a heritage name read as nothing leaves this floor seeing a NARROWER type than the compiler,
 * and fewer fields prints exactly like progress.
 *
 * Returns `undefined` when no module-scope declaration of that name exists — distinct from "declared
 * and empty", because those two must not read alike. A renamed, moved or namespaced interface is the
 * commonest way this kind of floor silently stops measuring anything.
 */
export function declaredFields(content, fileName, interfaceName, resolveAgainst = {}) {
  const { sourceInterface, sourceFieldNames } = resolveAgainst;
  const sourceFile = ts.createSourceFile(fileName, content);
  const aliases = importAliases(sourceFile, sourceInterface);
  const byName = new Map();

  // MODULE SCOPE ONLY. TypeScript merges declarations that share a scope, so collecting every
  // `interface` at any nesting depth reads a WIDER type than the compiler has — and wider masks
  // findings rather than inventing them, which is the direction that prints as progress. Review
  // measured both halves of the damage: a nested `interface IStartup { b }` inside a function body
  // made `b` count as declared by the configured surface, AND, combined with an external `extends`,
  // it cancelled the `preset-projection-heritage-unresolved` report that should have fired — turning
  // a fail-closed signal into a silent pass with the wrong type.
  // Only TOP-LEVEL declarations. A nested one is a different scope, so merging it in would read a
  // type the compiler does not have; a namespaced one is also a different scope, and leaving it out
  // makes a namespaced surface report "not declared", which fails closed rather than guessing.
  for (const statement of sourceFile.statements ?? []) {
    if (!ts.isInterfaceDeclaration(statement) || !statement.name?.text) continue;
    // Accumulate rather than assign: two declarations of one name in ONE scope ARE merged by
    // TypeScript, and a floor that keeps only the last reads a type the compiler does not have.
    const prior = byName.get(statement.name.text) ?? { members: [], heritage: [] };
    prior.members.push(...(statement.members ?? []).map(memberName).filter(Boolean));
    for (const clause of statement.heritageClauses ?? []) {
      prior.heritage.push(...(clause.types ?? []));
    }
    byName.set(statement.name.text, prior);
  }

  const root = byName.get(interfaceName);
  if (!root) return undefined;

  // Follow `extends`. Review demonstrated both directions of ignoring it: moving two brand-new
  // unprojected fields onto a base interface the SOURCE extends left the floor green with nothing
  // reported, and rewriting a SURFACE as `extends Pick<Source, …>` — the very form this file's own
  // docblock calls "the BETTER form" — produced five false divergences. A floor that blocks the
  // refactor it exists to encourage gets removed, not obeyed.
  const fields = [];
  const unresolved = [];
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = byName.get(name);
    if (!entry) return;
    fields.push(...entry.members);
    for (const type of entry.heritage) {
      const picked = pickFromType(
        type,
        sourceInterface ?? interfaceName,
        sourceFile,
        fileName,
        sourceFieldNames,
        aliases,
      );
      if (picked) {
        fields.push(...picked.fields);
        if (picked.unreadable) unresolved.push(picked);
        continue;
      }
      let expr = type.expression ?? type.typeName;
      while (expr && (ts.isPropertyAccessExpression(expr) || ts.isQualifiedName(expr))) {
        expr = expr.name ?? expr.right;
      }
      const parent = expr?.text ?? expr?.escapedText;
      if (parent && byName.has(parent)) walk(parent);
      // A heritage name declared in another file cannot be followed by a single-file walk. It is
      // recorded so the caller reports it rather than silently reading a narrower type.
      else if (parent && KNOWN_UTILITY_TYPES.has(parent)) {
        unresolved.push({ file: fileName, name: parent, utility: true });
      } else unresolved.push({ file: fileName, name: parent ?? '?', external: true });
    }
  };
  walk(interfaceName);

  // A RECORD, not an array carrying a hidden property. An earlier revision attached `unresolved`
  // non-enumerably, and review measured it surviving `.sort()` but vanishing silently through
  // `.filter()`, `.map()` and spread — so losing the diagnostic took one ordinary refactor and
  // failed in the direction this file's own thesis names: fewer reported problems prints as
  // progress. Losing it now requires deleting code.
  return { fields, unresolved };
}

/**
 * Utility types that WRAP a type rather than name a declaration. Reporting `extends Partial<ISource>`
 * as "a base interface declared in another file" sent the reader to look for a file declaring
 * `Partial`. Failing closed is right; pointing at the wrong thing is not.
 */
const IDENTITY_WRAPPERS = new Set(['Readonly', 'Required', 'Partial']);

const KNOWN_UTILITY_TYPES = new Set([
  'Record',
  'Exclude',
  'Extract',
  'NonNullable',
  'Parameters',
  'ReturnType',
  'InstanceType',
]);

function memberName(member) {
  return member.name?.text ?? member.name?.escapedText ?? undefined;
}

/** Tail identifier of a type node, following qualified names. */
function tailOf(node) {
  let name = node?.typeName ?? node?.expression;
  while (name && (ts.isQualifiedName(name) || ts.isPropertyAccessExpression(name))) {
    name = name.right ?? name.name;
  }
  return name?.text ?? name?.escapedText;
}

/**
 * `{ fields, unreadable }` when `type` is a `Pick<Source, …>` or `Omit<Source, …>`, else undefined.
 *
 * `Omit` is `Pick`'s direct sibling and is derived-from-source in exactly the way this file praises,
 * so treating one as a projection and the other as a defect was arbitrary. An `Omit` projects every
 * source field EXCEPT the named ones, which is why it needs the source's own field list.
 */
function pickFromType(type, sourceInterface, sourceFile, fileName, sourceFieldNames, aliases) {
  const head = tailOf(type);
  // `Readonly`/`Required`/`Partial` preserve the KEY SET exactly, so a surface written as
  // `extends Readonly<Source>` is a fully correct derived projection of every field. Treating it as
  // unresolvable made it maximally red — round 1's MUST one wrapper over, where the floor blocks the
  // refactor it exists to encourage. They take no key list, so they resolve straight to the source's
  // own fields.
  if (IDENTITY_WRAPPERS.has(head)) {
    const target = tailOf((type.typeArguments ?? [])[0]);
    if ((aliases?.get(target) ?? target) !== sourceInterface) return undefined;
    const { line } = sourceFile.getLineAndCharacterOfPosition(type.getStart(sourceFile));
    return { file: fileName, line: line + 1, fields: [...(sourceFieldNames ?? [])], form: head };
  }
  if (head !== 'Pick' && head !== 'Omit') return undefined;
  const [target, keys] = type.typeArguments ?? [];
  const targetName = tailOf(target);
  const canonical = aliases?.get(targetName) ?? targetName;
  if (canonical !== sourceInterface || !keys) return undefined;

  const literals = [];
  const collect = (n) => {
    if (ts.isLiteralTypeNode(n) && n.literal?.text) literals.push(n.literal.text);
    ts.forEachChild(n, collect);
  };
  collect(keys);
  const { line } = sourceFile.getLineAndCharacterOfPosition(type.getStart(sourceFile));

  // A `Pick`/`Omit` whose key list yields no literal is UNREADABLE, not empty — `Pick<S, K>` behind a
  // generic is the real case. An earlier revision claimed the caller reported this and nothing did,
  // so absence and unreadability printed the same. They no longer do.
  if (literals.length === 0) {
    return { file: fileName, line: line + 1, fields: [], unreadable: true, form: head };
  }
  const fields =
    head === 'Pick' ? literals : (sourceFieldNames ?? []).filter((f) => !literals.includes(f));
  return { file: fileName, line: line + 1, fields, form: head };
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
export function pickedFields(content, fileName, sourceInterface, sourceFieldNames) {
  const sourceFile = ts.createSourceFile(fileName, content);

  // An aliased import renames the source locally and every later `Pick` then names something this
  // walk was not looking for. Measured on the real tree: rewriting `robota-plumbing.ts`'s import to
  // `IResolvedPresetOptions as IPresetOpts` turned its three real projections into two false
  // divergences.
  const aliases = importAliases(sourceFile, sourceInterface);

  const picks = [];
  const visit = (node) => {
    // BOTH forms: a plain type reference, and a heritage clause. `interface X extends Pick<S, …>`
    // parses as an `ExpressionWithTypeArguments`, not a `TypeReferenceNode`, so matching only the
    // latter made the derived-from-source refactor this file recommends produce false findings.
    if (ts.isTypeReferenceNode(node) || node.heritageClauses) {
      const candidates = ts.isTypeReferenceNode(node)
        ? [node]
        : (node.heritageClauses ?? []).flatMap((c) => c.types ?? []);
      for (const candidate of candidates) {
        const picked = pickFromType(
          candidate,
          sourceInterface,
          sourceFile,
          fileName,
          sourceFieldNames,
          aliases,
        );
        if (picked) picks.push(picked);
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
function discoverPicks(root, sourceInterface, settings, sourceFieldNames) {
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
    // BOTH forms in the cheap reject. An earlier revision tested only `Pick<`, so every `Omit<`
    // projection was skipped before it was ever parsed — the filter silently narrowed the scan to
    // half the forms it claimed to support, and its own unit case caught it.
    const named = content.includes(sourceInterface);
    if (!named || (!content.includes('Pick<') && !content.includes('Omit<'))) continue;
    picks.push(...pickedFields(content, file, sourceInterface, sourceFieldNames));
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

  const sourceRead = declaredFields(
    readFileSync(join(root, source.file), 'utf8'),
    source.file,
    source.interface,
  );
  if (sourceRead === undefined) {
    findings.push({
      rule: 'preset-projection-source-missing',
      detail:
        `${source.file} declares no interface named ${source.interface}. This floor derives every ` +
        `question from that declaration, so a rename or a move leaves it measuring nothing — and ` +
        `"no unprojected fields" would then read exactly like a finished projection.`,
    });
    return { findings, examined: examinedInterfaces };
  }
  const sourceFields = sourceRead.fields;
  examinedInterfaces += 1;

  // Anything the heritage walk could not follow is a finding. A base interface declared in another
  // file, or a `Pick` whose keys are a generic parameter, leaves this floor reading a NARROWER type
  // than the compiler does — and a narrower type reports fewer fields, which prints as progress.
  const reportUnresolved = (list, where) => {
    for (const entry of list ?? []) {
      findings.push({
        rule: 'preset-projection-heritage-unresolved',
        detail:
          `${where}: ${
            entry.utility
              ? `extends \`${entry.name}<…>\`, a utility type this walk does not model — it wraps a type rather than naming a declaration`
              : entry.external
                ? `extends \`${entry.name}\`, declared in another file`
                : `${entry.form}<…> at line ${entry.line} whose key list yields no literal`
          }. ` +
          `This floor then reads a narrower type than the compiler does, and a narrower type reports ` +
          `fewer fields — which prints exactly like progress.`,
      });
    }
  };
  reportUnresolved(sourceRead.unresolved, `${source.file} ${source.interface}`);

  const projected = new Map();
  for (const surface of surfaces) {
    const read = declaredFields(
      readFileSync(join(root, surface.file), 'utf8'),
      surface.file,
      surface.interface,
      { sourceInterface: source.interface, sourceFieldNames: sourceFields },
    );
    if (read === undefined) {
      findings.push({
        rule: 'preset-projection-surface-missing',
        detail:
          `${surface.file} declares no MODULE-SCOPE interface named ${surface.interface}. It may be ` +
          `absent, renamed, or declared inside a namespace — this walk reads top-level statements ` +
          `only, because a nested declaration is a scope TypeScript does not merge. A surface this ` +
          `floor cannot read is treated as a finding rather than as "projects nothing", because the ` +
          `second would silently widen every other rule here.`,
      });
      continue;
    }
    examinedInterfaces += 1;
    reportUnresolved(read.unresolved, `${surface.file} ${surface.interface}`);
    projected.set(surface.interface, { fields: new Set(read.fields), surface });
  }

  // Discovered projections: every `Pick<Source, …>` in the tracked tree, attributed to a role by the
  // path prefixes each surface declares. A Pick under NO declared prefix is reported rather than
  // dropped — otherwise the prefix list could silently narrow what "the startup path" means, which
  // is the same absence-reads-as-a-pass shape the rest of this file refuses.
  for (const pick of discoverPicks(root, source.interface, settings, sourceFields)) {
    if (pick.unreadable) {
      findings.push({
        rule: 'preset-projection-heritage-unresolved',
        detail:
          `${pick.file}:${pick.line}: ${pick.form}<${source.interface}, …> whose key list yields no ` +
          `literal — a generic key parameter is the real case. Reporting it is the point: an earlier ` +
          `revision returned an empty field list here, so a projection this floor could not READ and ` +
          `one that projects NOTHING printed the same.`,
      });
      continue;
    }
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
  const pending = new Map((settings.pendingProjection ?? []).map((e) => [e.field, e]));
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

  // The burn-down must expire when a field is RESOLVED, not only when it is deleted. Review measured
  // the gap: declaring a pending field on one surface, on both, or removing its only declaration all
  // printed GREEN, so the list could not tell anyone when an entry was safe to delete — it was a
  // baseline with extra words. Each entry now records the surfaces it was measured on, and a live
  // state that differs in EITHER direction is reported. Stage 1's sibling scan already had this half
  // ("the unreachable set SHRANK … re-freeze it in the SAME change — or the gain is a licence to drop
  // them again"); this is that rule, per named field rather than per count.
  // The pending-state rules compare the live projection against a RECORDED one, so they are only
  // meaningful when every configured surface was actually read. Review measured the alternative on
  // the real tree: renaming one surface produced the correct `preset-projection-surface-missing`
  // PLUS four false findings, three of them instructing the reader to delete live exemptions for
  // fields that are still one-sidedly declared, and one claiming a field had lost a declaration that
  // nothing had touched. The run is red either way, so this was never a fail-open — it was a message
  // asserting a conclusion the scan had, one finding earlier, declared it could not reach. That is
  // the defect class every round of this review has closed, and it is not exempt here.
  if (pending.size > 0 && projected.size !== surfaces.length) {
    findings.push({
      rule: 'preset-pending-state-unknowable',
      detail:
        `${projected.size} of ${surfaces.length} configured surface(s) could be read, so the ` +
        `recorded \`declaredOn\` state of ${pending.size} pending exemption(s) cannot be compared ` +
        `against the live one. Those rules are SKIPPED for this run rather than answered from a set ` +
        `the scan already knows is incomplete — fix the unreadable surface above first.`,
    });
  }

  for (const [field, entry] of pending) {
    if (!sourceFieldSet.has(field)) continue;
    if (projected.size !== surfaces.length) continue;
    const live = [...projected.entries()]
      .filter(([, p]) => p.fields.has(field))
      .map(([name]) => name)
      .sort();
    const recorded = [...(entry.declaredOn ?? [])].sort();

    // A truthfully-recorded entry for a field with NO defect left is inert and permanent: it
    // suppresses both rules forever while its recorded state never changes. Review found this the
    // one way the burn-down can be gamed by telling the truth, so "fully projected" expires too.
    if (live.length === projected.size && projected.size > 0) {
      findings.push({
        rule: 'preset-pending-state-changed',
        field,
        detail:
          `${field} is exempted as pendingProjection but is now declared on every configured ` +
          `surface (${JSON.stringify(live)}). There is nothing left to be pending about — remove the ` +
          `entry, or the exemption silently suppresses both rules for a field that no longer needs it.`,
      });
      continue;
    }

    if (live.join(',') === recorded.join(',')) continue;
    const gained = live.filter((n) => !recorded.includes(n));
    const lost = recorded.filter((n) => !live.includes(n));
    findings.push({
      rule: 'preset-pending-state-changed',
      field,
      detail:
        `${field} is exempted as pendingProjection with declaredOn=${JSON.stringify(recorded)}, but ` +
        `it is now declared on ${JSON.stringify(live)}. ` +
        // Sets, not lengths. A one-for-one SWAP has equal lengths and is neither a gain nor a loss —
        // it is the field moving between paths, which is the `effort`/`agentName` divergence shape,
        // and an earlier revision reported it as a loss.
        (gained.length > 0 && lost.length > 0
          ? `It MOVED between surfaces (gained ${JSON.stringify(gained)}, lost ${JSON.stringify(lost)}) — ` +
            `which is the divergence shape this floor exists to catch, not progress.`
          : gained.length > 0
            ? `The exemption has been earned out — remove the entry so the floor holds the gain, or ` +
              `the progress is a licence to drop it again.`
            : `The field LOST a declaration while exempted, which is the regression the exemption was ` +
              `hiding. Restore it, or re-record the state with a reason for the loss.`),
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
