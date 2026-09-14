#!/usr/bin/env node

/**
 * Require every newly recorded gate evidence entry to disclose its judging mechanism.
 *
 * Issue #2269 measured 1578 gate entries with no attribution. Historical evidence is immutable, so
 * the migration baseline reports that debt and only rejects entries dated after the baseline.
 * Generated entries are kept honest by gate.mjs, which writes the same canonical field.
 * Manual entries may instead disclose `Independent guardian: <name>.` at the start of a visible
 * paragraph in that same entry. The single-token name must be explicit and unambiguous; examples,
 * duplicate manual declarations and conflicts with canonical attribution are not evidence.
 * Original text is returned, never rewritten. Recognition is disclosure, not identity authentication.
 * Existing canonical entries can contain several judging mechanisms and keep their prior handling.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { visibleMarkdown } from './markdown-visibility.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const DONE = path.join(ROOT, '.agents/spec-docs/done');
let examinedEntries = 0;

function entryAttribution(lines, rawLines, previousRawLines) {
  const canonical = [];
  const guardians = [];
  let manualSection = true;
  for (const [index, line] of lines.entries()) {
    if (index > 0 && /^###\s/.test(line)) manualSection = false;
    if (line.startsWith('**Judged by:**')) canonical.push({ line, raw: rawLines[index] });
    if (manualSection && line.startsWith('Independent guardian:')) {
      const name = /^Independent guardian: ([\p{L}][\p{L}\p{N}_-]*)\.(?:\s|$)/u.exec(line)?.[1];
      if (
        !name ||
        /^(?:unknown|none|null|undefined|tbd|todo)$/i.test(name) ||
        previousRawLines[index]?.trim() !== ''
      )
        return null;
      guardians.push({ name, raw: rawLines[index] });
    }
  }
  if (guardians.length > 1) return null;
  if (canonical.length > 0) {
    const value = canonical[0].line.slice('**Judged by:**'.length).trim();
    if (
      !value ||
      (guardians.length === 1 &&
        canonical.some(
          ({ line }) =>
            line.slice('**Judged by:**'.length).trim().replaceAll('`', '') !== guardians[0].name,
        ))
    )
      return null;
    return canonical[0].raw;
  }
  return guardians[0]?.raw ?? null;
}

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files.sort();
}

export function evidenceEntries(text, file = '') {
  const { lines, rawIndices, sourceLines } = visibleMarkdown(text, true);
  const start = lines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const sectionEnd = end < 0 ? lines.length : end;
  const starts = [];
  for (let index = start + 1; index < sectionEnd; index += 1)
    if (/^###\s+\[GATE-[^\]]+\]/.test(lines[index])) starts.push(index);
  return starts.map((entryStart, index) => {
    const entryEnd = starts[index + 1] ?? sectionEnd;
    const linesInEntry = lines.slice(entryStart, entryEnd);
    const heading = linesInEntry[0];
    const date = /\|\s*(\d{4}-\d{2}-\d{2})/.exec(heading)?.[1] ?? null;
    const judgedBy = entryAttribution(
      linesInEntry,
      linesInEntry.map((_, offset) => sourceLines[rawIndices[entryStart + offset]]),
      linesInEntry.map((_, offset) => sourceLines[rawIndices[entryStart + offset] - 1]),
    );
    return {
      file,
      heading,
      date,
      judgedBy,
      text: sourceLines
        .slice(rawIndices[entryStart], rawIndices[entryEnd] ?? sourceLines.length)
        .join('\n'),
    };
  });
}

export function collectEntries(root = ROOT) {
  requireGovernedTree(root, ['.agents/spec-docs/done'], {
    scan: 'gate-verdict-attribution',
    why: 'the done spec tree is the evidence population; without it no attribution can be judged',
  });
  const done = path.join(root, '.agents/spec-docs/done');
  const entries = markdownFiles(done).flatMap((file) =>
    evidenceEntries(
      readFileSync(file, 'utf8'),
      path.relative(root, file).split(path.sep).join('/'),
    ),
  );
  examinedEntries = entries.length;
  return entries;
}

export function examinedGateEvidenceCount() {
  return examinedEntries;
}

export function entryFingerprint(entry) {
  return createHash('sha256').update(entry.text).digest('hex');
}

export function evaluateEntries(entries, cutoffDate, legacyEntryFingerprints = []) {
  const legacy = new Set(legacyEntryFingerprints);
  const missing = entries.filter((entry) => !entry.judgedBy);
  const postBaseline = missing.filter(
    (entry) =>
      entry.date && entry.date > cutoffDate && !legacy.has(entryFingerprint(entry)),
  );
  return {
    total: entries.length,
    attributed: entries.length - missing.length,
    missing: missing.length,
    baselineMissing: missing.length - postBaseline.length,
    violations: postBaseline,
  };
}

export function main(root = ROOT) {
  const baseline = JSON.parse(
    readFileSync(path.join(root, 'scripts/harness/gate-verdict-attribution-baseline.json'), 'utf8'),
  );
  const legacyEntries = JSON.parse(
    readFileSync(path.join(root, 'scripts/harness/immutable-attribution-legacy.json'), 'utf8'),
  );
  const result = evaluateEntries(
    collectEntries(root),
    baseline.cutoffDate,
    legacyEntries.entries.map((entry) => entry.sha256),
  );
  console.log(`::examined:: ${result.total} GATE evidence entries`);
  console.log(
    `gate verdict attribution: ${result.attributed} attributed, ${result.missing} missing, ${result.baselineMissing} historical baseline`,
  );
  if (result.violations.length > 0) {
    for (const violation of result.violations.slice(0, 20)) {
      console.error(
        `gate-verdict-attribution: ${violation.file}: ${violation.heading} has missing or invalid attribution; expected visible **Judged by:** or an unambiguous same-entry Independent guardian: <name>. declaration`,
      );
    }
    if (result.violations.length > 20)
      console.error(`... and ${result.violations.length - 20} more`);
    return 1;
  }
  console.log('gate-verdict-attribution scan passed.');
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
