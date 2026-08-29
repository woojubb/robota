#!/usr/bin/env node

/**
 * RULE-018 static label-contract guard.
 *
 * Declared scope: `.github/labels.json`, the repository's three configured Issue Forms, the
 * code-owned protected-consumer baseline below, and additive consumer relations declared by registry
 * entries. It does not claim to discover every label-shaped string in the repository.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const REQUIRED_CORE = Object.freeze({
  workKinds: Object.freeze(['bug', 'enhancement', 'documentation']),
  intake: 'status:needs-triage',
  priorities: Object.freeze(['priority:P0', 'priority:P1', 'priority:P2']),
});

export const ISSUE_FORMS = Object.freeze([
  Object.freeze({ path: '.github/ISSUE_TEMPLATE/bug_report.yml', kind: 'bug' }),
  Object.freeze({ path: '.github/ISSUE_TEMPLATE/feature_request.yml', kind: 'enhancement' }),
  Object.freeze({ path: '.github/ISSUE_TEMPLATE/documentation.yml', kind: 'documentation' }),
]);

export const PROTECTED_CONSUMER_BASELINE = Object.freeze({
  'disposition-containment': Object.freeze([
    '.github/workflows/review-gate.yml',
    '.claude/hooks/merge-gate.sh',
    'scripts/harness/record-local-review.mjs',
  ]),
  'disposition-re-plan': Object.freeze([
    '.github/workflows/review-gate.yml',
    '.claude/hooks/merge-gate.sh',
    'scripts/harness/record-local-review.mjs',
  ]),
  'review-findings-acknowledged': Object.freeze(['scripts/harness/check-review-gate.mjs']),
});

const CORE_NAMES = new Set([
  ...REQUIRED_CORE.workKinds,
  REQUIRED_CORE.intake,
  ...REQUIRED_CORE.priorities,
]);

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function validateRegistry(registry) {
  const findings = [];
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) {
    return ['registry root must be an object'];
  }
  if (registry.version !== 1) findings.push('registry version must be `1`');
  if (!sameArray(registry.core?.workKinds, REQUIRED_CORE.workKinds)) {
    findings.push('core workKinds must be exactly `bug`, `enhancement`, `documentation`');
  }
  if (registry.core?.intake !== REQUIRED_CORE.intake) {
    findings.push('core intake must be exactly `status:needs-triage`');
  }
  if (!sameArray(registry.core?.priorities, REQUIRED_CORE.priorities)) {
    findings.push('core priorities must be exactly `priority:P0`, `priority:P1`, `priority:P2`');
  }
  if (!Array.isArray(registry.labels)) return [...findings, 'registry labels must be an array'];

  const seen = new Set();
  const declaredCore = new Set();
  for (const entry of registry.labels) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      findings.push('every label entry must be an object');
      continue;
    }
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (name === '') findings.push('label name must be a non-empty string');
    else if (seen.has(name)) findings.push(`duplicate label name \`${name}\``);
    else seen.add(name);

    if (!/^[0-9a-fA-F]{6}$/.test(entry.color ?? '')) {
      findings.push(`label \`${name || '(unnamed)'}\` color must be six hexadecimal digits`);
    }
    for (const field of ['description', 'category', 'lifecycle']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '') {
        findings.push(`label \`${name || '(unnamed)'}\` ${field} must be non-empty`);
      }
    }
    for (const field of ['appliesTo', 'producers', 'consumers']) {
      if (!Array.isArray(entry[field]) || entry[field].length === 0) {
        findings.push(`label \`${name || '(unnamed)'}\` ${field} must be a non-empty array`);
      }
    }
    if (entry.lifecycle === 'core') declaredCore.add(name);
    if (name === 'priority:P3') findings.push('priority:P3 is outside the core model');
  }

  for (const name of CORE_NAMES) {
    if (!seen.has(name)) findings.push(`required core label \`${name}\` is missing`);
    if (!declaredCore.has(name))
      findings.push(`required core label \`${name}\` must be lifecycle core`);
  }
  for (const name of declaredCore) {
    if (!CORE_NAMES.has(name)) findings.push(`unexpected lifecycle core label \`${name}\``);
  }
  for (const name of Object.keys(PROTECTED_CONSUMER_BASELINE)) {
    const entry = registry.labels.find((candidate) => candidate?.name === name);
    if (entry === undefined) findings.push(`protected system label \`${name}\` is missing`);
    else {
      if (entry.lifecycle !== 'system') {
        findings.push(`protected label \`${name}\` must be lifecycle system`);
      }
      if (entry.protected !== true)
        findings.push(`protected label \`${name}\` must set protected true`);
    }
  }
  return findings;
}

export function parseIssueFormLabels(text, formPath) {
  const match = /^labels:\s*(\[[^\n]*\])\s*$/m.exec(text);
  if (match === null)
    throw new Error(`Issue Form \`${formPath}\` must declare one inline labels array`);
  const inner = match[1].slice(1, -1);
  const labels = [];
  const item = /\s*(['"])([^'"]*)\1\s*(?:,|$)/gy;
  let cursor = 0;
  while (cursor < inner.length) {
    item.lastIndex = cursor;
    const parsed = item.exec(inner);
    if (parsed === null || parsed.index !== cursor || parsed[2] === '') {
      throw new Error(
        `Issue Form \`${formPath}\` labels must be an inline YAML array of quoted strings`,
      );
    }
    labels.push(parsed[2]);
    cursor = item.lastIndex;
  }
  return labels;
}

function readRequiredInputCount(text) {
  return [...text.matchAll(/^\s+required:\s*true\s*$/gm)].length;
}

function hasTopLevelKey(text, key, requireValue) {
  const prefix = `${key}:`;
  return text.split('\n').some((line) => {
    if (!line.startsWith(prefix)) return false;
    return !requireValue || line.slice(prefix.length).trim() !== '';
  });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function relationFinding(root, label, consumer) {
  const absolute = path.join(root, consumer);
  if (!existsSync(absolute) || !readFileSync(absolute, 'utf8').includes(label)) {
    return `protected label \`${label}\` is absent from \`${consumer}\``;
  }
  return null;
}

export function scanGithubLabelRegistry(root) {
  const findings = [];
  let examined = 0;
  const registryPath = path.join(root, '.github/labels.json');
  let registry;
  try {
    registry = readJson(registryPath);
  } catch (error) {
    return {
      findings: [`cannot read .github/labels.json (${error.message})`],
      examined,
    };
  }

  findings.push(...validateRegistry(registry));
  examined += Array.isArray(registry.labels) ? registry.labels.length : 0;
  const names = new Set(
    Array.isArray(registry.labels) ? registry.labels.map((entry) => entry?.name) : [],
  );

  for (const form of ISSUE_FORMS) {
    const absolute = path.join(root, form.path);
    if (!existsSync(absolute)) {
      findings.push(`required Issue Form \`${form.path}\` is missing`);
      continue;
    }
    examined += 1;
    const text = readFileSync(absolute, 'utf8');
    let labels;
    try {
      labels = parseIssueFormLabels(text, form.path);
    } catch (error) {
      findings.push(error.message);
      continue;
    }
    for (const label of labels) {
      if (!names.has(label)) {
        findings.push(`Issue Form \`${form.path}\` references undeclared label \`${label}\``);
      }
    }
    const kinds = labels.filter((label) => REQUIRED_CORE.workKinds.includes(label));
    if (
      labels.length !== 2 ||
      kinds.length !== 1 ||
      kinds[0] !== form.kind ||
      !labels.includes(REQUIRED_CORE.intake)
    ) {
      findings.push(
        `Issue Form \`${form.path}\` must apply exactly \`${form.kind}\` and \`${REQUIRED_CORE.intake}\``,
      );
    }
    if (
      !hasTopLevelKey(text, 'name', true) ||
      !hasTopLevelKey(text, 'description', true) ||
      !hasTopLevelKey(text, 'body', false)
    ) {
      findings.push(`Issue Form \`${form.path}\` must declare name, description, and body`);
    }
    if (readRequiredInputCount(text) < 3) {
      findings.push(`Issue Form \`${form.path}\` must contain at least three required inputs`);
    }
  }

  for (const [label, baseline] of Object.entries(PROTECTED_CONSUMER_BASELINE)) {
    const entry = registry.labels?.find((candidate) => candidate?.name === label);
    const additive = Array.isArray(entry?.consumers) ? entry.consumers : [];
    for (const consumer of new Set([...baseline, ...additive])) {
      examined += 1;
      const finding = relationFinding(root, label, consumer);
      if (finding !== null) findings.push(finding);
    }
  }
  return { findings, examined };
}

export function readExaminedGithubLabelRegistryCount(root) {
  return scanGithubLabelRegistry(root).examined;
}

function isMain() {
  return (
    process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
  );
}

if (isMain()) {
  const root = path.resolve(import.meta.dirname, '../..');
  const result = scanGithubLabelRegistry(root);
  for (const finding of result.findings) console.error(`✗ github-label-registry: ${finding}`);
  console.log(`::examined:: ${result.examined} registry/form/consumer relation(s)`);
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}
