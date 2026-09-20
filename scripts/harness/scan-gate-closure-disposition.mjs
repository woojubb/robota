#!/usr/bin/env node

/** Validate the machine-readable exceptions used to close irrecoverable gate history honestly. */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { evidenceEntries } from './gate-document.mjs';
import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const EXAMINED = ['::', 'examined::'].join('');
const SPEC_ROOT = path.join(ROOT, '.agents/spec-docs');
export const CLOSED_UNDER =
  /^\*\*Closed under:\*\* (?:`tool-defect` — [^;]+; gate `[^`]+`; defect record `[^`]+`; evidence `[^`]+`|`orchestration-skip` — [A-Z][A-Z0-9-]*-\d+; gate `(?:GATE-[A-Z]+|DONE-GATE-STAGE-\d+)`; non-compliance `\d{4}-\d{2}-\d{2}`; retrospective judgement `\.agents\/spec-docs\/(?:draft|backlog|todo|active|done|rejected)\/[^`]+\.md`; authority `https:\/\/github\.com\/woojubb\/robota\/issues\/\d+#issuecomment-\d+`)$/;
const TOOL_DEFECT =
  /^\*\*Closed under:\*\* `tool-defect` — ([^;]+); gate `([^`]+)`; defect record `([^`]+)`; evidence `([^`]+)`$/;
const ORCHESTRATION_SKIP =
  /^\*\*Closed under:\*\* `orchestration-skip` — ([A-Z][A-Z0-9-]*-\d+); gate `((?:GATE-[A-Z]+|DONE-GATE-STAGE-\d+))`; non-compliance `(\d{4}-\d{2}-\d{2})`; retrospective judgement `(\.agents\/spec-docs\/(?:draft|backlog|todo|active|done|rejected)\/[^`]+\.md)`; authority `(https:\/\/github\.com\/woojubb\/robota\/issues\/\d+#issuecomment-\d+)`$/;

function documents(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return documents(full);
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

function durableJudgementPath(root, relative) {
  const specRoot = path.resolve(root, '.agents/spec-docs');
  const absolute = path.resolve(root, relative);
  try {
    const lexicalRelative = path.relative(specRoot, absolute);
    if (
      lexicalRelative === '..' ||
      lexicalRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(lexicalRelative)
    )
      return false;
    if (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) return false;
    const canonicalRoot = realpathSync(specRoot);
    const canonicalPath = realpathSync(absolute);
    return canonicalPath.startsWith(`${canonicalRoot}${path.sep}`);
  } catch {
    return false;
  }
}

function dispositionLines(text) {
  const found = [];
  let fenced = false;
  let inEvidenceLog = false;
  for (const line of String(text).split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^##\s+/.test(line)) inEvidenceLog = /^##\s+Evidence Log\s*$/i.test(line);
    if (line.startsWith('**Closed under:**')) found.push({ line, inEvidenceLog });
  }
  return found;
}

export function dispositionFindings(root = ROOT) {
  const specs = documents(path.join(root, '.agents/spec-docs'));
  const findings = [];
  for (const file of specs) {
    const text = readFileSync(file, 'utf8');
    const dispositions = dispositionLines(text);
    for (const disposition of dispositions.filter((item) => !item.inEvidenceLog))
      findings.push({
        file: path.relative(root, file),
        detail: `Closed under disposition is outside the Evidence Log: ${disposition.line}`,
      });
    const matches = dispositions.filter((item) => item.inEvidenceLog).map((item) => item.line);
    if (matches.length > 1)
      findings.push({
        file: path.relative(root, file),
        detail: 'more than one Closed under disposition',
      });
    for (const line of matches) {
      const toolDefect = TOOL_DEFECT.exec(line);
      const orchestrationSkip = ORCHESTRATION_SKIP.exec(line);
      if (!toolDefect && !orchestrationSkip) {
        findings.push({
          file: path.relative(root, file),
          detail: `malformed Closed under disposition: ${line}`,
        });
        continue;
      }
      if (toolDefect) continue;

      const [, , gate, date, judgementPath] = orchestrationSkip;
      const entries = evidenceEntries(text) ?? [];
      const relativeFile = path.relative(root, file).split(path.sep).join('/');
      const status = asScalar(frontmatterObject(text).status);
      if (!relativeFile.startsWith('.agents/spec-docs/done/') || status !== 'done')
        findings.push({
          file: path.relative(root, file),
          detail: `orchestration-skip requires a terminal done spec, observed ${relativeFile} with status ${status || '(absent)'}`,
        });
      const matchingNonCompliance = entries.filter(
        (entry) =>
          entry.gate === gate && entry.date === date && entry.verdict === '🔴 NON-COMPLIANCE',
      );
      if (matchingNonCompliance.length !== 1)
        findings.push({
          file: path.relative(root, file),
          detail: `orchestration-skip needs exactly one matching NON-COMPLIANCE for ${gate} on ${date}`,
        });
      if (entries.some((entry) => entry.gate === gate && entry.verdict === '✅ PASS'))
        findings.push({
          file: path.relative(root, file),
          detail: `orchestration-skip gate ${gate} already has a PASS`,
        });
      if (entries.some((entry) => entry.gate === gate && entry.verdict === '❌ FAIL'))
        findings.push({
          file: path.relative(root, file),
          detail: `orchestration-skip gate ${gate} also has an ordinary FAIL`,
        });
      if (!durableJudgementPath(root, judgementPath))
        findings.push({
          file: path.relative(root, file),
          detail: `retrospective judgement path does not resolve: ${judgementPath}`,
        });
    }
  }
  return findings;
}

export function main() {
  const findings = dispositionFindings();
  process.stdout.write(`${EXAMINED} ${documents(SPEC_ROOT).length} gate spec document(s)\n`);
  if (findings.length === 0) {
    process.stdout.write('gate-closure-disposition scan passed.\n');
    return 0;
  }
  process.stdout.write('gate-closure-disposition scan failed:\n');
  for (const finding of findings)
    process.stdout.write(`- [gate-closure-disposition] ${finding.file}: ${finding.detail}\n`);
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
