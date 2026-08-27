#!/usr/bin/env node

/**
 * A GATE-APPROVAL entry must name its approval route, and a CLASS route must point at a class that
 * was registered before the approval (RULE-012).
 *
 * THE GAP THIS CLOSES, measured. `gate-catalogue.md` § GATE-APPROVAL required approval "in the
 * current conversation" while the same section's own example list admitted "끝까지 책임지고 작업해" —
 * an instruction that is standing by construction and cannot be in the current conversation for the
 * second item it authorizes. The gate's criterion and the gate's examples disagreed, so every session
 * resolved the contradiction privately.
 *
 * WHAT THAT COST, and it is the reason this scan exists rather than more prose. Three sessions counted
 * the documents whose approval rests on a standing instruction, from the same tree on the same day,
 * and produced 27, 43 and 52. Both instruments were then found defective — one read the FIRST
 * `[GATE-APPROVAL]` entry on documents carrying several, so a WITHDRAWN verdict was read as the
 * document's basis. But fixing that moved the numbers by one and by three. The spread was never a
 * counting bug: there was no shared definition of "standing basis" to count against. A definition
 * that only a guard can apply uniformly is the thing that settles it, and a count is the only form in
 * which the answer can be checked.
 *
 * THE VERDICT THAT COUNTS IS THE LAST ONE. A document may carry several `[GATE-APPROVAL]` entries —
 * a withdrawn verdict, a NON-COMPLIANCE record, then the pass that stands. This scan reads the last
 * `✅ PASS` not marked withdrawn, because that is the one the document is actually resting on. Taking
 * the first is the defect described above and is not repeated here.
 *
 * NEITHER THE FORM NOR THE REGISTRY IS HARD-CODED. Both are read out of
 * `backlog-execution.md` § Delegated Approval Classes, which owns them (AGENTS.md: one owner per
 * fact). The parse is FAIL-CLOSED: an unreadable section, a missing registry table, or an evidence
 * form that names no fields exits 1 rather than passing vacuously. A floor that cannot read its own
 * criteria has verified nothing.
 *
 * WHY A FROZEN SET AND NOT A FROZEN COUNT. Every approval recorded before this rule existed predates
 * the form and predates the registry, and by construction cannot cite a class registered before it.
 * The baseline is therefore the exempt SET — a document outside it must carry the form, and the set
 * may only shrink. **The baseline is not absolution.** It is the sorted record of what this rule found
 * when it was installed, reported on every run so the debt is counted rather than forgotten; what
 * becomes of those entries is an owner decision, filed separately and deliberately not taken here.
 *
 * Usage: `node scripts/harness/scan-standing-delegation-evidence.mjs`
 * Exit code 0 = every governed approval names a valid route (or is a frozen exemption), 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC_RELATIVE = '.agents/spec-docs';
const GOVERNED_TREE = `${SPEC_RELATIVE}/done`;
const BACKLOG_RULE = path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md');
const BASELINE_FILE = path.join(import.meta.dirname, 'standing-delegation-baseline.json');

const REGISTRY_HEADING = '### Delegated Approval Classes';

/**
 * The section of the rule that owns the form and the registry. Returns undefined when the rule does
 * not state it — the caller treats that as a failure, never as "no criteria apply".
 */
export function parseRegistrySection(ruleText) {
  const start = ruleText.indexOf(REGISTRY_HEADING);
  if (start === -1) return undefined;
  const rest = ruleText.slice(start + REGISTRY_HEADING.length);
  // The section's own evidence-form examples are fenced blocks containing `### [GATE-APPROVAL] …`.
  // Searching for the next heading without tracking fences ends the section at its own example, and
  // the form it documents then reads as absent — a parse that would fail this scan closed for the
  // one reason it must not: the criteria being present and unread.
  const lines = rest.split('\n');
  let fenced = false;
  const body = [];
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{1,3} /.test(line)) break;
    body.push(line);
  }
  return body.join('\n');
}

/**
 * The field labels the evidence form requires, read from the form's own fenced examples rather than
 * restated here. Anchoring on the rule's text is what keeps this scan from confirming its own
 * assumption back to itself.
 *
 * Returns `{ route, instruction, classField }` — the exact bolded labels — or undefined if the form
 * names none.
 */
export function parseEvidenceForm(sectionText) {
  const labels = new Set(
    [...sectionText.matchAll(/^\*\*([^*:]+):\*\*/gm)].map((match) => match[1].trim()),
  );
  const route = [...labels].find((label) => /approval route/i.test(label));
  const instruction = [...labels].find((label) => /instruction/i.test(label));
  const classField = [...labels].find((label) => /^class$/i.test(label));
  if (!route || !instruction || !classField) return undefined;
  return { route, instruction, classField };
}

/**
 * The registered classes, as `Map<classId, { registered: 'YYYY-MM-DD' }>`.
 *
 * An empty registry is a valid state and NOT a parse failure: the registry ships empty by design, and
 * every document then takes the DIRECT route, which is the behaviour before this rule. The failure
 * this distinguishes it from is a missing TABLE, which means the criteria are unreadable.
 */
export function parseRegistry(sectionText) {
  const rows = [...sectionText.matchAll(/^\|(.+)\|\s*$/gm)].map((match) =>
    match[1].split('|').map((cell) => cell.trim()),
  );
  if (rows.length === 0) return undefined;
  const registry = new Map();
  for (const cells of rows) {
    const id = (cells[0] ?? '').replace(/^`|`$/g, '').trim();
    const registered = (cells[4] ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registered)) continue;
    registry.set(id, { registered });
  }
  return registry;
}

/** Every `### [GATE-APPROVAL] …` entry in a document, each running to the next `### ` heading. */
export function approvalEntries(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (/^###\s/.test(line)) {
      if (current) entries.push(current.join('\n'));
      current = /\[GATE-APPROVAL\]/.test(line) ? [line] : null;
      continue;
    }
    if (current) current.push(line);
  }
  if (current) entries.push(current.join('\n'));
  return entries;
}

/**
 * The verdict the document actually rests on: the last `✅ PASS`, unless a LATER entry withdraws it.
 *
 * A withdrawal is not written on the entry it retires. The corpus records it as a separate
 * `🔴 NON-COMPLIANCE` entry that names the PASS above it, and the author then writes a fresh PASS on a
 * different basis. Testing the entry's own text for "withdraw" therefore reads the wrong thing twice
 * over, and both misreads were measured on the live tree before this was rewritten:
 *
 *   HARNESS-900 — its standing PASS explains that an earlier one stays withdrawn, so the word appears
 *                 in the entry that is VALID and an earlier verdict was taken instead;
 *   SEC-015     — the word appears in prose about the document's own earlier claim, nothing to do with
 *                 any approval, and EVERY pass was dropped. The document then vanished from the
 *                 population entirely: not judged, not reported, silently unexamined.
 *
 * The second is the worse failure and the reason this is not a filter. A guard that drops a document
 * it cannot parse has not found nothing; it has stopped looking, and its count says otherwise.
 */
/**
 * A verdict's KIND is stated on its heading line and nowhere else. Testing the whole entry finds the
 * `✅ PASS` that a NON-COMPLIANCE entry QUOTES while recording which pass it withdraws — so the
 * withdrawal reads as the pass. Measured: the first implementation here did exactly that.
 */
function isPassEntry(entry) {
  return /✅\s*PASS/.test(entry.split('\n', 1)[0]);
}

export function standingVerdict(text) {
  const entries = approvalEntries(text);
  const lastPass = entries.map(isPassEntry).lastIndexOf(true);
  if (lastPass === -1) return undefined;
  const retiredAfter = entries
    .slice(lastPass + 1)
    .some((entry) => /withdraw/i.test(entry) && !isPassEntry(entry));
  return retiredAfter ? undefined : entries[lastPass];
}

function entryDate(entry) {
  const match = entry.match(/\|\s*(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : undefined;
}

function labelValue(entry, label) {
  const pattern = new RegExp(
    `^\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*\\s*(.+?)\\s*$`,
    'm',
  );
  const match = entry.match(pattern);
  return match ? match[1].trim() : undefined;
}

export function listApprovedSpecs(root = WORKSPACE_ROOT) {
  const specs = [];
  const base = path.join(root, SPEC_RELATIVE);
  if (!existsSync(base)) return specs;
  for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory()) continue;
    const folder = entry.name;
    const dir = path.join(base, folder);
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.md') || file === 'README.md') continue;
      const full = path.join(dir, file);
      const text = readFileSync(full, 'utf8');
      const verdict = standingVerdict(text);
      if (verdict) specs.push({ key: `${folder}/${file}`, verdict });
    }
  }
  return specs;
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return { exempt: [] };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

/**
 * Classify ONE standing verdict against the form and the registry.
 *
 * Pure and exported so both fixture directions can be exercised without a tree: RULE-012 specifies
 * PASS and FAIL fixtures, and a FAIL case that can only be built by writing a document into the real
 * corpus is a case nobody writes.
 *
 * Returns `{ route }` when the entry is valid, or `{ problem }` naming the criterion it failed.
 */
export function classifyApproval(verdict, { form, registry }) {
  const route = labelValue(verdict, form.route)?.replace(/`/g, '').toUpperCase();
  if (route !== 'DIRECT' && route !== 'CLASS') {
    return {
      problem:
        `GATE-APPROVAL names no approval route. gate-catalogue.md requires \`**${form.route}:**\` ` +
        'to be `DIRECT` or `CLASS`; an entry that names neither is FAIL, not DIRECT by default. ' +
        'Add the route; do not add the document to the baseline, which is frozen for approvals ' +
        'that predate this floor.',
    };
  }
  const instruction = labelValue(verdict, form.instruction);
  if (!instruction || instruction.replace(/[`"'\s]/g, '').length === 0) {
    return {
      problem: `route ${route} records no verbatim instruction under \`**${form.instruction}:**\`. An authorization that is paraphrased cannot be checked against what the user actually said.`,
    };
  }
  if (route === 'DIRECT') return { route };

  const classId = labelValue(verdict, form.classField)?.replace(/`/g, '').trim();
  if (!classId) {
    return {
      problem: `route CLASS names no class under \`**${form.classField}:**\`. The class route authorizes nothing without a registry entry to point at.`,
    };
  }
  const registered = registry.get(classId);
  if (!registered) {
    return {
      problem: `route CLASS cites \`${classId}\`, which is not in the delegated-class registry in backlog-execution.md. Authority attaches to a class declared before the item, never to a resemblance argued after it.`,
    };
  }
  const approvedOn = entryDate(verdict);
  if (!approvedOn) {
    return {
      problem:
        'route CLASS carries no approval date, so it cannot be shown to postdate its class registration.',
    };
  }
  if (approvedOn < registered.registered) {
    return {
      problem: `route CLASS cites \`${classId}\`, registered ${registered.registered}, but the approval is dated ${approvedOn}. A class may not be registered retroactively.`,
    };
  }
  return { route };
}

export function findEvidenceFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [GOVERNED_TREE], {
    scan: 'standing-delegation-evidence',
    why: 'The spec-document tree carries the approvals this scan measures.',
  });
  const section = parseRegistrySection(readFileSync(BACKLOG_RULE, 'utf8'));
  if (!section) {
    throw new Error(
      `standing-delegation-evidence: backlog-execution.md states no \`${REGISTRY_HEADING}\` ` +
        'section. The criteria this scan enforces are unreadable, so it has verified nothing.',
    );
  }
  const form = parseEvidenceForm(section);
  if (!form) {
    throw new Error(
      'standing-delegation-evidence: the evidence form in backlog-execution.md names no route, ' +
        'instruction, or class field. The shape this scan parses is unreadable, so a document ' +
        'that omitted every field would pass — which is the opposite of what this scan is for.',
    );
  }
  const registry = parseRegistry(section);
  if (!registry) {
    throw new Error(
      'standing-delegation-evidence: backlog-execution.md carries no delegated-class registry ' +
        'table. An empty registry is valid; a missing one means the class route cannot be checked.',
    );
  }

  const exempt = new Set(loadBaseline().exempt);
  const findings = [];
  const counts = { direct: 0, class: 0, exempt: 0, unrouted: 0 };
  const specs = listApprovedSpecs(root);

  for (const { key, verdict } of specs) {
    if (exempt.has(key)) {
      counts.exempt += 1;
      if (!labelValue(verdict, form.route)) counts.unrouted += 1;
      continue;
    }
    const verdictResult = classifyApproval(verdict, { form, registry });
    if (verdictResult.problem) {
      findings.push({ spec: key, problem: verdictResult.problem });
      continue;
    }
    counts[verdictResult.route === 'DIRECT' ? 'direct' : 'class'] += 1;
  }

  return { findings, examined: specs.length, counts, registrySize: registry.size };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedApprovalCount(root = WORKSPACE_ROOT) {
  return findEvidenceFindings(root).examined;
}

export function scanStandingDelegationEvidence() {
  const { findings, examined, counts, registrySize } = findEvidenceFindings();
  return {
    name: 'standing-delegation-evidence',
    findings: findings.map((f) => `${f.spec}: ${f.problem}`),
    examined:
      `${examined} approved spec document(s); ${counts.direct} DIRECT, ${counts.class} CLASS, ` +
      `${counts.exempt} frozen (${counts.unrouted} of them with no route at all); ` +
      `${registrySize} registered class(es)`,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = scanStandingDelegationEvidence();
  for (const finding of result.findings) console.error(`✗ ${finding}`);
  console.log(`::examined:: ${result.examined}`);
  process.exit(result.findings.length > 0 ? 1 : 0);
}
