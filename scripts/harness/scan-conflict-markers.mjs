#!/usr/bin/env node

/**
 * Mechanizes the manual "Conflict Scan Commands" block in AGENTS.md (HARNESS-018).
 *
 * Scans the harness prose (AGENTS.md + .agents/skills + .agents/rules) for phrases
 * that, when used as *guidance*, contradict the repo's rules — e.g. advocating a
 * fallback/temporary workaround, or hierarchy-implying agent naming.
 *
 * Legitimate occurrences (the rules that PROHIBIT these terms, and the AGENTS.md
 * command block that defines this very scan) are skipped via an explicit, documented
 * allowlist. A new flagged line must either be reworded or added to ALLOW_SUBSTRINGS
 * with a reason.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const PATTERNS = [
  /any\/unknown may|fallback to|temporary workaround/i,
  /main agent|sub-agent|parent-agent|child-agent/i,
];

// Lines containing any of these substrings are legitimate definitional/prohibitional
// uses, not advocacy. Keep this list small and documented.
const ALLOW_SUBSTRINGS = [
  'rg -n "', // the AGENTS.md "Conflict Scan Commands" definitions themselves
  'Prohibited:', // naming-style.md prohibition list of hierarchy terms
  'PATTERNS = [', // this scanner's own pattern definition (if ever scanned)
  'ALLOW_SUBSTRINGS', // this scanner's allowlist
];

const SCAN_TARGETS = ['AGENTS.md', '.agents/skills', '.agents/rules'];

function walkMarkdown(root, target) {
  const full = path.join(root, target);
  if (!existsSync(full)) return [];
  if (statSync(full).isFile()) return full.endsWith('.md') ? [full] : [];
  const files = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(root, path.join(target, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(path.join(full, entry.name));
    }
  }
  return files;
}

export function findConflictMarkerFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const target of SCAN_TARGETS) {
    for (const file of walkMarkdown(root, target)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ALLOW_SUBSTRINGS.some((allow) => line.includes(allow))) continue;
        for (const pattern of PATTERNS) {
          if (pattern.test(line)) {
            findings.push({
              file: path.relative(root, file),
              line: i + 1,
              text: line.trim().slice(0, 120),
            });
            break;
          }
        }
      }
    }
  }
  return findings;
}

export function main() {
  const findings = findConflictMarkerFindings();
  if (findings.length === 0) {
    process.stdout.write('conflict marker scan passed.\n');
  } else {
    process.stdout.write('conflict marker scan failed:\n');
    for (const f of findings) {
      process.stdout.write(`  ${f.file}:${f.line}  ${f.text}\n`);
    }
    process.stdout.write(
      '\nReword the guidance, or (if a legitimate definition/prohibition) add a substring to ALLOW_SUBSTRINGS.\n',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
