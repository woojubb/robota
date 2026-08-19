#!/usr/bin/env node
/**
 * INFRA-112 (issue #1904) — every declared escape hatch names the form its hook actually accepts.
 *
 * `AGENTS.md` said "Each has a documented **inline** override". Measured before this scan existed,
 * that was false for three variables that accept only an exported one, and understated three more
 * that accept both. Nothing compared any declaration to the code, so both drift directions were live
 * at once: a hatch advertised and not accepted, and a hatch accepted and not advertised.
 *
 * The accepted forms are DERIVED from the hook source by `hook-overrides.mjs`. This scan holds no
 * list of its own — a list here would be the copy that drifts next.
 *
 * ## What a finding means
 *
 * - `undeclared` — a hook accepts a hatch no document mentions. The reader who needs it cannot find
 *   it, and the reader auditing the guard does not know it is there. The second is the dangerous one.
 * - `wrong-form` — a document names a form the code does not accept. A reader following it types
 *   something that silently does not work, and concludes the guard is broken rather than the doc.
 * - `phantom` — a document declares a hatch no hook reads. It reads as a supported bypass and is not.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { enumerateFiles } from './enumerate-files.mjs';
import { collectAcceptedForms, examinedHookCount } from './hook-overrides.mjs';

/**
 * The size this scan reports, re-exported so the declaration and the reader are one symbol.
 *
 * `measurement-provenance` asks that a scan announcing a size expose the reader behind it AND the
 * finder that moves it, so the number can be asserted rather than believed — and asserted again after
 * a second run, which is what tells an accumulating counter from a growing subject. Both are
 * re-exported from the module that does the counting rather than reimplemented, so a second counter
 * cannot exist to disagree with this one.
 */
export { collectAcceptedForms, examinedHookCount };

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// INFRA-121 — through the shared owner, so a hook or rule written and not yet staged is judged.
const trackedFiles = () => enumerateFiles();

/** Where a hatch may be declared. Hook sources are included: a refusal message is a declaration. */
const DECLARATION_GLOBS = [
  /^AGENTS\.md$/,
  /^\.agents\/rules\/.*\.md$/,
  /^\.claude\/hooks\/.*\.sh$/,
];

/**
 * A hatch that is deliberately not advertised outside its own hook.
 *
 * `TASK_TRACKING_SKIP_ISSUES` suppresses an informational listing rather than a refusal — there is no
 * gate to bypass, so a rule section for it would document a preference as an override.
 */
const NOT_ADVERTISED = new Set(['TASK_TRACKING_SKIP_ISSUES']);

/**
 * Does this text declare the INLINE form for `name`?
 *
 * Only an EXPLICIT claim counts — the word "inline" on the same line, or the variable shown prefixing
 * a real command. Most declarations name the variable and no form at all, and reading those as a form
 * claim is how the first cut of this scan reported `HOOK_EDIT_ACK` wrongly: its refusal reads
 * `HOOK_EDIT_ACK=1 (git-branch.md)`, which is a citation, not a command line. The hook says "in the
 * environment" two lines above, correctly.
 *
 * Narrow on purpose. A scan that guesses at a form claim produces findings whose fix is to reword
 * prose the reader never misread.
 */
const COMMAND_VERBS = String.raw`(?:git|gh|pnpm|npm|node|bash|sh|sleep|cat|sed|rm|mv)\b`;

function declaresInline(text, name) {
  const namedInline = new RegExp(String.raw`^.*\b${name}\b.*\binline\b.*$`, 'im');
  const prefixesCommand = new RegExp(String.raw`${name}=1\s+${COMMAND_VERBS}`);
  return namedInline.test(text) || prefixesCommand.test(text);
}

/**
 * Does this text declare the EXPORTED form for `name`? Only `export NAME=` counts.
 *
 * The first cut also accepted the variable and the word "environment" on one source line, and a
 * wrapped paragraph naming several hatches put `MERGE_GATE_ACK` on the same line as a sentence about
 * the environment form — a false positive produced entirely by where the prose happened to wrap.
 * Proximity in prose is not a claim; the imperative spelling is.
 */
function declaresExported(text, name) {
  return new RegExp(String.raw`export\s+${name}=`).test(text);
}

export function findDeclarationFindings(accepted, documents) {
  const findings = [];
  const seen = new Map();

  for (const [file, text] of documents) {
    for (const name of accepted.keys()) {
      if (!text.includes(name)) continue;
      const forms = seen.get(name) ?? { inline: false, exported: false, files: [] };
      forms.inline = forms.inline || declaresInline(text, name);
      forms.exported = forms.exported || declaresExported(text, name);
      forms.files.push(file);
      seen.set(name, forms);
    }
  }

  for (const [name, form] of accepted) {
    if (form.hooks.length === 0) continue;
    const declared = seen.get(name);
    const outside = (declared?.files ?? []).filter((file) => !file.startsWith('.claude/hooks/'));

    if (declared === undefined || (outside.length === 0 && !NOT_ADVERTISED.has(name))) {
      findings.push({
        kind: 'undeclared',
        name,
        detail:
          `accepted by ${form.hooks.map((hook) => path.basename(hook)).join(', ')} and declared in no ` +
          'rule or AGENTS.md. A bypass nobody documented is one the auditor does not know to look for.',
      });
      continue;
    }
    if (declared.inline && !form.inline) {
      findings.push({
        kind: 'wrong-form',
        name,
        detail:
          'declared as an INLINE override, which this hook does not accept — it reads the variable ' +
          'from its own environment, and a PreToolUse hook never sees an inline assignment.',
      });
    }
    if (form.inline && !form.environment && declared.exported) {
      findings.push({
        kind: 'wrong-form',
        name,
        detail:
          'declared as an EXPORTED override, which this hook does not accept — it matches the ' +
          'assignment against the command string, so only the statement it prefixes is excused.',
      });
    }
  }
  return findings;
}

function main() {
  const tracked = trackedFiles();
  const hooks = tracked.filter((file) => /^\.claude\/hooks\/[^/]+\.sh$/.test(file));
  const accepted = collectAcceptedForms(hooks, (file) =>
    readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8'),
  );

  const documents = tracked
    .filter((file) => DECLARATION_GLOBS.some((pattern) => pattern.test(file)))
    .map((file) => [file, readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8')]);

  const findings = findDeclarationFindings(accepted, documents);
  console.log(`::examined:: ${examinedHookCount()} hook file(s)`);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`- [${finding.kind}] ${finding.name}: ${finding.detail}`);
    }
    process.exitCode = 1;
    return;
  }
  const live = [...accepted.values()].filter((form) => form.hooks.length > 0).length;
  console.log(
    `hook-override-declarations scan passed (${live} accepted override variable(s) across ` +
      `${examinedHookCount()} hook(s)). The accepted forms are DERIVED from the hook source, so this ` +
      'cannot pass by agreeing with a list that drifted alongside them.',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
