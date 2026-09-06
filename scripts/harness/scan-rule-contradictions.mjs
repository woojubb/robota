#!/usr/bin/env node

/**
 * HARNESS-2485 — detect incompatible normative claims across rule documents.
 *
 * This is deliberately a structural detector, not an attempted natural-language theorem prover.
 * Only a line containing an explicit modal (MUST, SHOULD, MAY, or its NOT form) is comparable. Two
 * claims conflict when their normalized subject and predicate match but their modal strength or
 * polarity differs. The inline suppression is intentionally visible and requires a reason.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const RULES_DIR = '.agents/rules';
const MODAL = /\b(MUST NOT|SHOULD NOT|MAY NOT|MUST|SHOULD|MAY)\b/i;
const SUPPRESSION = /allow-rule-contradiction:\s*\S/i;
const MODAL_RANK = { MAY: 1, SHOULD: 2, MUST: 3 };
let lastExaminedClaimCount = 0;

export function examinedClaimCount() {
  return lastExaminedClaimCount;
}

function normalize(value) {
  return String(value)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+|[\s:.;,!?-]+$/g, '')
    .trim()
    .toLowerCase();
}

function modalInfo(value) {
  const modal = value.toUpperCase();
  const negative = modal.endsWith(' NOT');
  return { modal, negative, rank: MODAL_RANK[modal.replace(/ NOT$/, '')] };
}

/** Extract only explicit, line-local normative claims; prose without a modal is not guessed. */
export function extractClaims(source, file = '(fixture)') {
  const claims = [];
  let inFence = false;
  for (const [index, line] of String(source).split('\n').entries()) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*>/.test(line)) continue;
    const match = MODAL.exec(line);
    if (!match) continue;
    const subject = normalize(
      line.slice(0, match.index).replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ''),
    );
    const predicate = normalize(
      line
        .slice(match.index + match[0].length)
        .replace(/\s+allow-rule-contradiction:\s*\S.*$/i, ''),
    );
    if (!subject || !predicate) continue;
    const info = modalInfo(match[0]);
    claims.push({
      file,
      line: index + 1,
      subject,
      predicate,
      ...info,
      suppressed: SUPPRESSION.test(line),
      text: line.trim(),
    });
  }
  return claims;
}

function conflict(left, right) {
  return (
    left.subject === right.subject &&
    left.predicate === right.predicate &&
    (left.negative !== right.negative || left.rank !== right.rank)
  );
}

export function findContradictions(claims) {
  const findings = [];
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    const left = claims[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const right = claims[rightIndex];
      if (left.file === right.file || !conflict(left, right)) continue;
      const suppressed = left.suppressed || right.suppressed;
      findings.push({
        left,
        right,
        suppressed,
        detail: `${left.file}:${left.line} says ${left.modal}; ${right.file}:${right.line} says ${right.modal} for the same subject/predicate`,
      });
    }
  }
  return findings;
}

function ruleFiles(root) {
  const directory = path.join(root, RULES_DIR);
  if (!existsSync(directory)) throw new Error(`rule-contradictions: ${RULES_DIR} is missing.`);
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0)
    throw new Error(`rule-contradictions: ${RULES_DIR} has no rule documents.`);
  return files;
}

export function scanRules(root = WORKSPACE_ROOT) {
  const files = ruleFiles(root);
  const claims = files.flatMap((file) =>
    extractClaims(readFileSync(path.join(root, RULES_DIR, file), 'utf8'), `${RULES_DIR}/${file}`),
  );
  lastExaminedClaimCount = claims.length;
  if (claims.length === 0) {
    throw new Error('rule-contradictions: no explicit normative claims were examined.');
  }
  const all = findContradictions(claims);
  return {
    files: files.length,
    claims: claims.length,
    findings: all.filter((finding) => !finding.suppressed),
    suppressed: all.filter((finding) => finding.suppressed),
  };
}

function main() {
  const result = scanRules();
  console.log(`::examined:: ${result.files} rule document(s), ${result.claims} normative claim(s)`);
  for (const finding of result.suppressed) console.log(`::suppressed:: ${finding.detail}`);
  if (result.findings.length > 0) {
    for (const finding of result.findings) console.error(`- ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `rule-contradictions scan passed (${result.claims} claims; ${result.suppressed.length} suppressed pair(s)).`,
  );
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
