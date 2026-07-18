#!/usr/bin/env node

/**
 * HARNESS-029 — mechanical memory-neutrality floor for the SELFHOST-008 memory subsystem.
 *
 * Library-neutrality invariant (SELFHOST-008): no memory CONTENT and no app-voice curation PROMPT/policy
 * in `packages/` — durable memory content lives in the consumer workspace (`<cwd>/.robota/memory/`), and
 * the capture prompt/policy is supplied by the SURFACE (agent-cli / apps). Until now this was enforced
 * only by manual review (P1/P2 TC-06). This scan is the always-on guardian, mirroring
 * `scan-orchestration-neutrality.mjs` (its closest analog) + the `scan-no-fallback.mjs` suppression/anti-rot
 * convention.
 *
 * It reports over `packages/<pkg>/src` (the LIBRARY only — never `apps/`/`agent-cli`, where prompts +
 * content legitimately live):
 *
 *  1. `seeded-memory-content` — a durable memory corpus file checked into the library: a `MEMORY.md`, or a
 *     file under a `memory/topics/` path. (Anchored to the real corpus artifact names from
 *     `project-memory-store.ts`: `INDEX_FILENAME = 'MEMORY.md'`, `TOPICS_DIRNAME = 'topics'`. If a future
 *     backend changes the corpus layout — e.g. a `.json` seed or a `memory/facts/` dir — update this scan
 *     in lockstep.) Exact file-path check; zero false positives.
 *
 *  2. `library-capture-prompt` — a model-facing curation PROMPT smuggled into the memory CURATION subsystem:
 *     within a source file under a `/memory/` DIRECTORY segment (the durable-memory subsystem convention —
 *     deliberately NOT "any path containing `memory`", which would also match unrelated `in-memory-*` /
 *     memory-cache infra), a declaration whose identifier matches /(prompt|persona|instruction)/i assigned
 *     a STRING LITERAL of >= 40 chars (a capture prompt is a sentence, not a short token — the
 *     identifier-AND-length conjunction keeps false positives near zero). This is an evadable FLOOR (a
 *     non-matching identifier slips through) that BACKS the manual TC-06 review; it does not replace it.
 *     Suppress a sanctioned occurrence with an adjacent `// allow-memory-content: <reason>`.
 *
 *  Anti-rot (v1 = reason-less-only, mypy `ignore-without-code` analogue, mirroring HARNESS-028): a
 *  reason-less `allow-memory-content` in a comment fails. Stale-detection is DEFERRED (narrow flagged set).
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** A capture-prompt intent identifier assigned a string literal of >= 40 chars (a sentence, not a token). */
const CAPTURE_PROMPT_DECL =
  /\b\w*(?:prompt|persona|instruction)\w*\s*[:=]\s*(['"`])((?:\\.|(?!\1).){40,})\1/i;

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION_WITH_REASON = /allow-memory-content:\s*\S/;

/** Whether `allow-memory-content` on this line sits in a COMMENT (line/JSDoc/block), not a string. */
function annotationInComment(line) {
  const trimmed = line.trim();
  return (
    /\/\/[^\n]*allow-memory-content/.test(line) ||
    /\/\*[^\n]*allow-memory-content/.test(line) ||
    (/^\*/.test(trimmed) && /allow-memory-content/.test(trimmed))
  );
}

/**
 * Class 2 (pure content check): a `library-capture-prompt` finding per source line declaring a
 * prompt/persona/instruction identifier assigned a >= 40-char string literal, unless suppressed by an
 * adjacent `allow-memory-content: <reason>`. Exposed so the harness test can assert directly without disk.
 */
export function findMemoryNeutralityFindingsInSource(source, file = 'fixture.ts') {
  const findings = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Class 2 — a library capture-prompt declaration, unless a reasoned annotation (this/prev line) suppresses it.
    if (CAPTURE_PROMPT_DECL.test(line)) {
      const windowText = `${lines[i - 1] ?? ''}\n${line}`;
      if (!ANNOTATION_WITH_REASON.test(windowText)) {
        findings.push({
          file,
          line: i + 1,
          kind: 'library-capture-prompt',
          text: line.trim().slice(0, 120),
        });
      }
    }
    // Anti-rot (v1 = reason-less-only): a comment-scoped `allow-memory-content` MUST carry a `: <reason>`.
    if (annotationInComment(line) && !ANNOTATION_WITH_REASON.test(line)) {
      findings.push({
        file,
        line: i + 1,
        kind: 'reasonless-annotation',
        text: line.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

/** Is this workspace-relative path inside a package's `src/` tree? */
function isPackageSrc(rel) {
  return rel.startsWith(`packages${path.sep}`) && rel.includes(`${path.sep}src${path.sep}`);
}

/** Is this path inside a `/memory/` DIRECTORY segment (the durable-memory curation subsystem)? */
function inMemorySubsystem(rel) {
  return rel.includes(`${path.sep}memory${path.sep}`);
}

/**
 * Class 1 (pure predicate, exposed for tests): a seeded durable-memory corpus file checked into the library
 * — a `MEMORY.md`, or a `.md` file under a `memory/topics/` path. Separator-normalized so it is portable
 * (POSIX + Windows) and unit-testable with `/`-separated paths.
 */
export function isSeededMemoryContent(rel) {
  const norm = rel.replace(/\\/g, '/');
  if (norm.split('/').pop() === 'MEMORY.md') return true;
  return norm.includes('/memory/topics/') && norm.endsWith('.md');
}

export function findMemoryNeutralityFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return findings;
  for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const srcRel = path.join('packages', pkg.name, 'src');
    if (!existsSync(path.join(root, srcRel)) || !statSync(path.join(root, srcRel)).isDirectory()) {
      continue;
    }
    // include .md (corpus) + .ts/.tsx (prompt) files under src
    for (const rel of walkSourceAllFiles(srcRel)) {
      // Class 1 — seeded content file (any src location under the package)
      if (isSeededMemoryContent(rel)) {
        findings.push({
          file: rel,
          line: 1,
          kind: 'seeded-memory-content',
          text: path.basename(rel),
        });
        continue;
      }
      // Class 2 — capture prompt, only within the memory curation subsystem source
      if (/\.tsx?$/.test(rel) && inMemorySubsystem(rel)) {
        findings.push(
          ...findMemoryNeutralityFindingsInSource(readFileSync(path.join(root, rel), 'utf8'), rel),
        );
      }
    }
  }
  return findings;
}

/** Collect ALL non-test files (any extension) under a src tree, workspace-relative. */
function walkSourceAllFiles(target) {
  const full = path.join(WORKSPACE_ROOT, target);
  if (!existsSync(full)) return [];
  const out = [];
  for (const entry of readdirSync(full, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walkSourceAllFiles(child));
    else if (entry.isFile()) out.push(child);
  }
  return out;
}

function main() {
  const findings = findMemoryNeutralityFindings();
  if (findings.length === 0) {
    console.log('memory-neutrality scan passed.');
    process.exit(0);
  }
  console.error(
    'memory-neutrality scan FAILED — memory content/prompt in the library (packages/):',
  );
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nSELFHOST-008 neutrality: memory CONTENT lives in the consumer workspace (`<cwd>/.robota/memory/`),\n' +
      '  and the capture PROMPT/policy is supplied by the surface (agent-cli/apps) — not `packages/`.\n' +
      '  - seeded-memory-content: remove the corpus file; content belongs in the consumer workspace.\n' +
      '  - library-capture-prompt: move the prompt to the surface, OR (if genuinely neutral) annotate with\n' +
      '    `// allow-memory-content: <reason>`.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
