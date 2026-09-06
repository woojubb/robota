#!/usr/bin/env node

/**
 * Require every newly recorded gate evidence entry to disclose its judging mechanism.
 *
 * Issue #2269 measured 1578 gate entries with no attribution. Historical evidence is immutable, so
 * the migration baseline reports that debt and only rejects entries dated after the baseline.
 * Generated entries are kept honest by gate.mjs, which writes the same canonical field.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const DONE = path.join(ROOT, '.agents/spec-docs/done');
const BASELINE = path.join(import.meta.dirname, 'gate-verdict-attribution-baseline.json');
let examinedEntries = 0;

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
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((line) => /^##\s+Evidence Log\s*$/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  const section = lines.slice(start + 1, end < 0 ? lines.length : end);
  const entries = [];
  let current = null;
  for (const line of section) {
    if (/^###\s+\[GATE-[^\]]+\]/.test(line)) {
      if (current) entries.push(current);
      current = [line];
    } else if (current) current.push(line);
  }
  if (current) entries.push(current);
  return entries.map((linesInEntry) => {
    const heading = linesInEntry[0];
    const date = /\|\s*(\d{4}-\d{2}-\d{2})/.exec(heading)?.[1] ?? null;
    const judgedBy = linesInEntry.find((line) => /^\*\*Judged by:\*\*\s*\S/.test(line)) ?? null;
    return { file, heading, date, judgedBy, text: linesInEntry.join('\n') };
  });
}

export function collectEntries(root = ROOT) {
  const done = path.join(root, '.agents/spec-docs/done');
  if (!existsSync(done)) throw new Error(`${done} missing — cannot judge gate attribution`);
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

export function evaluateEntries(entries, cutoffDate) {
  const missing = entries.filter((entry) => !entry.judgedBy);
  const postBaseline = missing.filter((entry) => entry.date && entry.date > cutoffDate);
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
  const result = evaluateEntries(collectEntries(root), baseline.cutoffDate);
  console.log(`::examined:: ${result.total} GATE evidence entries`);
  console.log(
    `gate verdict attribution: ${result.attributed} attributed, ${result.missing} missing, ${result.baselineMissing} historical baseline`,
  );
  if (result.violations.length > 0) {
    for (const violation of result.violations.slice(0, 20)) {
      console.error(
        `gate-verdict-attribution: ${violation.file}: ${violation.heading} has no **Judged by:** line`,
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
