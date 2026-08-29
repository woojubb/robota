#!/usr/bin/env node

/**
 * RULE-018 live GitHub administration shell.
 *
 * Default operations are read-only. Label apply is create/update-only, Issue audit never mutates, and
 * conversion finalization writes an idempotent Task marker before removing Issue priority labels.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WORK_KINDS = new Set(['bug', 'enhancement', 'documentation']);
const PRIORITIES = new Set(['priority:P0', 'priority:P1', 'priority:P2']);
const INTAKE = 'status:needs-triage';
let examinedLiveLabels = 0;
let examinedOpenIssues = 0;

function comparableLabel(label) {
  return {
    name: label.name,
    color: String(label.color ?? '').toLowerCase(),
    description: label.description ?? '',
  };
}

export function planLabelReconciliation(declaredLabels, liveLabels) {
  const liveByName = new Map();
  let examined = 0;
  for (const label of liveLabels) {
    examined += 1;
    liveByName.set(label.name, label);
  }
  const declaredNames = new Set(declaredLabels.map((label) => label.name));
  const create = [];
  const update = [];
  for (const declared of declaredLabels) {
    const live = liveByName.get(declared.name);
    if (live === undefined) create.push(declared);
    else if (JSON.stringify(comparableLabel(declared)) !== JSON.stringify(comparableLabel(live))) {
      update.push({ declared, live });
    }
  }
  return {
    create,
    update,
    unexpected: liveLabels.filter((label) => !declaredNames.has(label.name)),
    delete: [],
    examined,
  };
}

export function scanLiveLabelReconciliation(declaredLabels, liveLabels) {
  const plan = planLabelReconciliation(declaredLabels, liveLabels);
  examinedLiveLabels = plan.examined;
  return plan;
}

export function readExaminedLiveLabelCount() {
  return examinedLiveLabels;
}

export async function applyLabelPlan(plan, { repo, runGh }) {
  const declared = [...plan.create, ...plan.update.map((difference) => difference.declared)];
  for (const label of declared) {
    await runGh([
      'label',
      'create',
      label.name,
      '--repo',
      repo,
      '--color',
      label.color,
      '--description',
      label.description,
      '--force',
    ]);
  }
}

function labelNames(issue) {
  return (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name));
}

export function classifyOpenIssues(issues, openTaskLinks) {
  const result = { intake: [], candidates: [], converted: [], malformed: [], examined: 0 };
  for (const issue of issues) {
    result.examined += 1;
    const labels = labelNames(issue);
    const kinds = labels.filter((label) => WORK_KINDS.has(label));
    const priorities = labels.filter((label) => PRIORITIES.has(label));
    const needsTriage = labels.includes(INTAKE);
    const taskPath = openTaskLinks.get(issue.number);
    let category;
    let reason;
    if (taskPath !== undefined && kinds.length === 1 && priorities.length === 0 && !needsTriage) {
      category = 'converted';
      reason = `linked to ${taskPath}`;
    } else if (
      taskPath === undefined &&
      kinds.length === 1 &&
      priorities.length === 0 &&
      needsTriage
    ) {
      category = 'intake';
      reason = 'one work kind plus intake marker';
    } else if (
      taskPath === undefined &&
      kinds.length === 1 &&
      priorities.length === 1 &&
      !needsTriage
    ) {
      category = 'candidates';
      reason = `unconverted ${priorities[0]} candidate`;
    } else {
      category = 'malformed';
      reason = `kinds=${kinds.length}, priorities=${priorities.length}, needs-triage=${needsTriage}, task-linked=${taskPath !== undefined}`;
    }
    result[category].push({ issue, reason, taskPath });
  }
  return result;
}

export function scanOpenIssues(issues, openTaskLinks) {
  const result = classifyOpenIssues(issues, openTaskLinks);
  examinedOpenIssues = result.examined;
  return result;
}

export function readExaminedOpenIssueCount() {
  return examinedOpenIssues;
}

function taskIdentity(taskPath) {
  if (!taskPath.startsWith('.agents/tasks/') || taskPath.includes('/../')) {
    throw new Error(`Task path must be under .agents/tasks/: ${taskPath}`);
  }
  const match = /^([A-Z][A-Z0-9]*-\d+)(?:-|\.md)/.exec(path.basename(taskPath));
  if (match === null) throw new Error(`cannot derive Task ID from ${taskPath}`);
  return match[1];
}

export function taskMarker({ id, taskPath }) {
  return `<!-- robota-task: ${id} -->\nConverted to Task \`${id}\`: \`${taskPath}\`.\n\nPriority authority moved to Task \`priority\`/\`urgency\`; Issue priority labels are removed only after this marker is read back.`;
}

function taskField(taskText, field) {
  return new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm').exec(taskText)?.[1];
}

function validateConversionState({ repo, issueNumber, taskPath, taskText, issue }) {
  const id = taskIdentity(taskPath);
  const issueUrl = taskField(taskText, 'issue');
  const expectedIssueUrl = `https://github.com/${repo}/issues/${issueNumber}`;
  if (issueUrl !== expectedIssueUrl) {
    throw new Error(`Task source issue does not match #${issueNumber}`);
  }
  const labels = labelNames(issue);
  const kinds = labels.filter((label) => WORK_KINDS.has(label));
  const priorities = labels.filter((label) => PRIORITIES.has(label));
  if (kinds.length !== 1 || labels.includes(INTAKE) || priorities.length !== 1) {
    throw new Error('Issue is not one fully triaged, unconverted priority candidate');
  }
  const priority = priorities[0];
  if (priority === 'priority:P2') {
    throw new Error('priority:P2 must be promoted to priority:P1 before conversion');
  }
  const expectedUrgency = priority === 'priority:P0' ? 'now' : 'soon';
  if (taskField(taskText, 'urgency') !== expectedUrgency) {
    throw new Error(`${priority} requires Task urgency: ${expectedUrgency}`);
  }
  return { id, marker: taskMarker({ id, taskPath }), priorities };
}

function hasExactMarker(issue, marker) {
  return (issue.comments ?? []).some((comment) => comment.body === marker);
}

export async function finalizeIssueConversion({
  repo,
  issueNumber,
  taskPath,
  taskText,
  getIssue,
  postComment,
  removeLabels,
}) {
  let issue = await getIssue(issueNumber);
  const conversion = validateConversionState({ repo, issueNumber, taskPath, taskText, issue });
  if (!hasExactMarker(issue, conversion.marker)) {
    await postComment(conversion.marker);
    issue = await getIssue(issueNumber);
    if (!hasExactMarker(issue, conversion.marker)) {
      throw new Error(`Task marker for ${conversion.id} was not readable after write-back`);
    }
  }
  await removeLabels(conversion.priorities);
  const finalIssue = await getIssue(issueNumber);
  const remaining = labelNames(finalIssue).filter((label) => PRIORITIES.has(label));
  if (remaining.length !== 0) {
    throw new Error(`conversion incomplete: Issue still carries ${remaining.join(', ')}`);
  }
  return { id: conversion.id, taskPath, issueNumber };
}

function runGh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `gh ${args.slice(0, 2).join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return result.stdout;
}

function runGhJson(args) {
  return JSON.parse(runGh(args));
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function requireOption(args, name) {
  const value = option(args, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function readRegistry(root) {
  return JSON.parse(readFileSync(path.join(root, '.github/labels.json'), 'utf8'));
}

function openTaskLinks(root) {
  const directory = path.join(root, '.agents/tasks');
  const links = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
    const taskPath = `.agents/tasks/${entry.name}`;
    const text = readFileSync(path.join(root, taskPath), 'utf8');
    const issueNumber = /^issue:\s*https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\s*$/m.exec(
      text,
    )?.[1];
    if (issueNumber !== undefined) links.set(Number(issueNumber), taskPath);
  }
  return links;
}

function printLabelPlan(plan) {
  console.log(
    `label-reconciliation: create=${plan.create.length} update=${plan.update.length} unexpected=${plan.unexpected.length} delete=0`,
  );
  for (const label of plan.create) console.log(`CREATE ${label.name}`);
  for (const difference of plan.update) console.log(`UPDATE ${difference.declared.name}`);
  for (const label of plan.unexpected) console.log(`PRESERVE ${label.name}`);
  console.log(`::examined:: ${plan.examined} live label(s)`);
}

async function labelsCommand({ args, repo, root }) {
  const registry = readRegistry(root);
  const live = runGhJson([
    'label',
    'list',
    '--repo',
    repo,
    '--limit',
    '1000',
    '--json',
    'name,color,description',
  ]);
  let plan = scanLiveLabelReconciliation(registry.labels, live);
  printLabelPlan(plan);
  if (args.includes('--apply')) {
    await applyLabelPlan(plan, { repo, runGh: async (command) => runGh(command) });
    const after = runGhJson([
      'label',
      'list',
      '--repo',
      repo,
      '--limit',
      '1000',
      '--json',
      'name,color,description',
    ]);
    plan = scanLiveLabelReconciliation(registry.labels, after);
    console.log('after apply:');
    printLabelPlan(plan);
  }
  if (
    (args.includes('--check') || args.includes('--apply')) &&
    (plan.create.length || plan.update.length)
  ) {
    process.exitCode = 1;
  }
}

function auditCommand({ args, repo, root }) {
  const issues = runGhJson([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--limit',
    '10000',
    '--json',
    'number,title,url,labels',
  ]);
  const result = scanOpenIssues(issues, openTaskLinks(root));
  for (const category of ['intake', 'candidates', 'converted', 'malformed']) {
    console.log(`${category}: ${result[category].length}`);
    for (const item of result[category]) {
      console.log(`  #${item.issue.number} ${item.issue.title} — ${item.reason}`);
    }
  }
  console.log(`::examined:: ${result.examined} open issue(s)`);
  if (args.includes('--check') && result.malformed.length !== 0) process.exitCode = 1;
}

async function convertCommand({ args, repo, root }) {
  const issueNumber = Number(requireOption(args, '--issue'));
  if (!Number.isInteger(issueNumber) || issueNumber < 1)
    throw new Error('--issue must be a positive integer');
  const suppliedTask = requireOption(args, '--task');
  const absoluteTask = path.resolve(root, suppliedTask);
  const taskPath = path.relative(root, absoluteTask);
  if (taskPath.startsWith('..') || path.isAbsolute(taskPath))
    throw new Error('--task must stay inside the repository');
  const taskText = readFileSync(absoluteTask, 'utf8');
  const getIssue = async () =>
    runGhJson(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'labels,comments']);

  if (!args.includes('--apply')) {
    const issue = await getIssue();
    const plan = validateConversionState({ repo, issueNumber, taskPath, taskText, issue });
    console.log(`conversion dry-run: ${plan.id} from #${issueNumber}`);
    console.log(`write marker, read it back, then remove: ${plan.priorities.join(', ')}`);
    return;
  }

  const result = await finalizeIssueConversion({
    repo,
    issueNumber,
    taskPath,
    taskText,
    getIssue,
    postComment: async (body) => {
      runGh(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body]);
    },
    removeLabels: async (labels) => {
      const removeArgs = labels.flatMap((label) => ['--remove-label', label]);
      runGh(['issue', 'edit', String(issueNumber), '--repo', repo, ...removeArgs]);
    },
  });
  console.log(`conversion finalized: #${result.issueNumber} → ${result.id} (${result.taskPath})`);
}

function usage() {
  return [
    'Usage:',
    '  node scripts/harness/github-issue-triage.mjs labels --repo OWNER/REPO [--check|--apply]',
    '  node scripts/harness/github-issue-triage.mjs audit --repo OWNER/REPO [--check]',
    '  node scripts/harness/github-issue-triage.mjs convert --repo OWNER/REPO --issue N --task PATH [--apply]',
  ].join('\n');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!['labels', 'audit', 'convert'].includes(command)) throw new Error(usage());
  const repo = requireOption(args, '--repo');
  const root = path.resolve(import.meta.dirname, '../..');
  if (command === 'labels') await labelsCommand({ args, repo, root });
  else if (command === 'audit') auditCommand({ args, repo, root });
  else await convertCommand({ args, repo, root });
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
) {
  main().catch((error) => {
    console.error(`github-issue-triage: ${error.message}`);
    process.exitCode = 1;
  });
}
