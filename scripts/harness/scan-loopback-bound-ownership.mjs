#!/usr/bin/env node

/**
 * HARNESS-072 (#1617), tractable subset — a quantified loop bound has ONE owner.
 *
 * PR #1615 produced five contradictions in one change and review found every one of them; a machine
 * found none. Four of the five were the same shape: a pipeline's loop-back bound written in a
 * second place — the orchestration map, a draft spec, a rule — and then changed in one place and
 * not the other. The structural cause is measurable: the map stated a bound for every pipeline in
 * its own words and each owning skill stated it again — seven pipelines, two independent statements
 * each, fourteen places a contradiction could open.
 *
 * General semantic contradiction detection is not attempted here. What IS decidable:
 *
 *   1. The orchestration map's Loop-back cells may not carry a QUANTIFIED bound. The owning skill
 *      states the number; the map says "bounded" and whose bound it is. A number in the map is a
 *      restatement, and a restatement is a contradiction that has not happened yet.
 *   2. A rule or spec-doc line that NAMES a skill and states a quantified iteration bound is the
 *      same restatement one tree over — the shape rounds 9, 10 and 12 of #1615 kept re-finding in
 *      one draft spec.
 *
 * The preference is REMOVAL, not synchronisation: all five instances existed because a fact was
 * written twice, and a checker that keeps two copies equal still leaves two copies.
 *
 * Suppression: `allow-restated-bound: <reason>` on the same line, reason required. Designed before
 * the check, per the issue: without it, the first false positive gets the check suppressed instead
 * of obeyed.
 *
 * fail-direction: refuse — an unreadable map, an empty pipeline table, or an empty skills tree
 * throws rather than reporting a pass over nothing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const MAP_PATH = '.agents/specs/orchestration-map.md';

/**
 * A QUANTIFIED loop bound: a count attached to an iteration noun, or `max N` where what follows
 * is an iteration noun, punctuation or the end — never a plain word. The noun list is
 * deliberately about looping (rounds, retries, revisions…) — "2 files", "3 packages" and
 * "max 72 chars" are not bounds and must not fire this; "max 3", "max-3 + progress detection"
 * and "max 3 iterations" are.
 */
export const QUANTIFIED_BOUND =
  /\b(max(?:imum)?[\s-]+\d+(?=\s*(?:$|[^a-z\s])|\s+(?:re-?(?:run|runs|cut|cuts|specification|specifications)|rounds?|iterations?|revisions?|redesigns?|attempts?|retries|triages?|requests?)\b)|\d+\s+(?:[a-z][a-z-]*\s+)?(?:re-?(?:run|runs|cut|cuts|specification|specifications|verify\s+rounds?|review\s+rounds?)|rounds?|iterations?|revisions?|redesigns?|attempts?|retries|triages?|requests?))\b/i;

const ALLOW = /allow-restated-bound:\s*\S/;

/** The pipeline table: rows between the `| Pipeline` header and the next non-table line. */
export function mapLoopbackCells(mapSource) {
  const lines = mapSource.split('\n');
  const headerAt = lines.findIndex((line) => /^\|\s*Pipeline\s*\|/.test(line));
  if (headerAt === -1) return [];
  const cells = [];
  const header = lines[headerAt].split('|').map((cell) => cell.trim());
  const loopbackCol = header.findIndex((cell) => /^Loop-back$/i.test(cell));
  if (loopbackCol === -1) return [];
  for (let i = headerAt + 2; i < lines.length; i++) {
    if (!lines[i].startsWith('|')) break;
    const cols = lines[i].split('|').map((cell) => cell.trim());
    if (cols.length <= loopbackCol) continue;
    cells.push({ line: i + 1, pipeline: cols[1] ?? '', cell: cols[loopbackCol] ?? '' });
  }
  return cells;
}

/** Every skill name under `.agents/skills/` — the identities restatements are detected against. */
export function skillNames(root = WORKSPACE_ROOT) {
  const dir = path.join(root, '.agents/skills');
  if (!existsSync(dir)) {
    throw new Error(
      '[loopback-bound-ownership] .agents/skills is missing, so restatements cannot be judged ' +
        'against anything. Refusing rather than reporting a pass over nothing.',
    );
  }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  // An EMPTY tree is the same nothing as a missing one — the docstring promises a refusal, and a
  // directory with zero skills would let the restatement sweep pass over nothing to compare with.
  if (names.length === 0) {
    throw new Error(
      '[loopback-bound-ownership] .agents/skills contains no skill directories, so restatements ' +
        'cannot be judged against anything. Refusing rather than reporting a pass over nothing.',
    );
  }
  return names;
}

export function collectFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  // 1. The map's Loop-back cells.
  const mapFull = path.join(root, MAP_PATH);
  if (!existsSync(mapFull)) {
    throw new Error(
      `[loopback-bound-ownership] ${MAP_PATH} is missing. The map is the document this check ` +
        'exists to keep honest; its absence is a broken checkout, not a pass.',
    );
  }
  const mapSource = readFileSync(mapFull, 'utf8');
  const cells = mapLoopbackCells(mapSource);
  if (cells.length === 0) {
    throw new Error(
      '[loopback-bound-ownership] the map carries no pipeline table — the layout moved, or the ' +
        'parse is wrong. Nothing was examined; this is not a pass.',
    );
  }
  for (const { line, pipeline, cell } of cells) {
    if (ALLOW.test(cell)) continue;
    const match = QUANTIFIED_BOUND.exec(cell);
    if (match) {
      findings.push({
        file: MAP_PATH,
        line,
        detail:
          `the Loop-back cell for ${pipeline} states a quantified bound ("${match[0]}"). The ` +
          'owning skill states the number; the map says "bounded" and points. A number here is a ' +
          'second statement of one fact, and #1615 measured what that becomes.',
      });
    }
  }

  // 2. Rules and spec-docs naming a skill beside a quantified bound.
  const names = skillNames(root);
  const trees = ['.agents/rules', '.agents/spec-docs'];
  let sweptFiles = 0;
  for (const tree of trees) {
    const treeFull = path.join(root, tree);
    if (!existsSync(treeFull)) continue;
    const stack = [treeFull];
    while (stack.length > 0) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.name.endsWith('.md')) continue;
        sweptFiles += 1;
        const relative = path.relative(root, full).split(path.sep).join('/');
        const lines = readFileSync(full, 'utf8').split('\n');
        lines.forEach((text, index) => {
          if (ALLOW.test(text)) return;
          const bound = QUANTIFIED_BOUND.exec(text);
          if (!bound) return;
          const named = names.find((name) => text.includes(`\`${name}\``));
          if (!named) return;
          // The owning skill's OWN documents state their own bounds — that is the one place a
          // number belongs, so the skill named being the file's subject is not a restatement.
          if (relative.includes(`/${named}/`)) return;
          findings.push({
            file: relative,
            line: index + 1,
            detail:
              `states a quantified bound ("${bound[0]}") beside \`${named}\`, which owns its own ` +
              'loop bounds. Link to the skill instead of restating its number — the restatement ' +
              'is where #1615 rounds 9, 10 and 12 came from.',
          });
        });
      }
    }
  }

  return { findings, examined: { cells: cells.length, sweptFiles } };
}

function main() {
  const { findings, examined } = collectFindings();
  console.log(
    `::examined:: ${examined.cells} loop-back cell(s), ${examined.sweptFiles} rules/spec-doc file(s)`,
  );
  if (findings.length === 0) {
    console.log('loopback-bound-ownership scan passed.');
    return;
  }
  console.error(`loopback-bound-ownership scan failed — ${findings.length} restated bound(s):`);
  for (const finding of findings) {
    console.error(`  - ${finding.file}:${finding.line} ${finding.detail}`);
  }
  console.error(
    '\nHARNESS-072: a fact written twice is a contradiction that has not happened yet. Move the ' +
      'number into the owning skill (or delete the copy), or suppress a deliberate restatement ' +
      'with `allow-restated-bound: <reason>` on the line.',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
