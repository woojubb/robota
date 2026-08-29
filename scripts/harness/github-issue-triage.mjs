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
import { decodeHTML } from 'entities';
import { marked } from 'marked';

import { asList, frontmatterObject } from './frontmatter.mjs';

const WORK_KINDS = new Set(['bug', 'enhancement', 'documentation']);
const PRIORITIES = new Set(['priority:P0', 'priority:P1', 'priority:P2']);
const INTAKE = 'status:needs-triage';
let examinedLiveLabels = 0;
let examinedOpenIssues = 0;
let examinedOpenChildIssues = 0;

const INDEPENDENT_LIFECYCLE_HEADING = '## Independent external lifecycle';
const SEMANTIC_REVIEW_RECEIPT =
  /^Semantic review:\s+@([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s+on\s+(\d{4})-(\d{2})-(\d{2})\s+—\s+RETAIN\s*$/;

function beginsIndentedMarkdownCode(line) {
  let column = 0;
  for (const character of line) {
    if (character === ' ') column += 1;
    else if (character === '\t') column += 4 - (column % 4);
    else break;
    if (column >= 4) return true;
  }
  return false;
}

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

export function classifyOpenIssues(issues, openTaskLinks, taskLinkProblems = new Map()) {
  const result = { intake: [], candidates: [], converted: [], malformed: [], examined: 0 };
  for (const issue of issues) {
    result.examined += 1;
    const labels = labelNames(issue);
    const kinds = labels.filter((label) => WORK_KINDS.has(label));
    const priorities = labels.filter((label) => PRIORITIES.has(label));
    const needsTriage = labels.includes(INTAKE);
    const taskPath = openTaskLinks.get(issue.number);
    const taskLinkProblem = taskLinkProblems.get(issue.number);
    let category;
    let reason;
    if (taskLinkProblem !== undefined) {
      category = 'malformed';
      reason = taskLinkProblem;
    } else if (
      taskPath !== undefined &&
      kinds.length === 1 &&
      priorities.length === 0 &&
      !needsTriage
    ) {
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

export function scanOpenIssues(issues, openTaskLinks, taskLinkProblems = new Map()) {
  const result = classifyOpenIssues(issues, openTaskLinks, taskLinkProblems);
  examinedOpenIssues = result.examined;
  return result;
}

export function readExaminedOpenIssueCount() {
  return examinedOpenIssues;
}

function markdownLinesOutsideCode(body) {
  const withoutHtmlCode = String(body ?? '').replace(
    /<(pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    '',
  );
  const uncommented = withoutHtmlCode.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
  const visible = [];
  let fence = null;
  for (const line of uncommented.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (fence !== null) {
      const trimmed = line.trim();
      if (
        trimmed.length >= fence.length &&
        [...trimmed].every((character) => character === fence.character)
      ) {
        fence = null;
      }
      visible.push('');
      continue;
    }
    if (marker !== null) {
      fence = { character: marker[0], length: marker.length };
      visible.push('');
      continue;
    }
    visible.push(beginsIndentedMarkdownCode(line) ? '' : line);
  }
  return visible;
}

function validSemanticReviewReceipt(line) {
  const match = SEMANTIC_REVIEW_RECEIPT.exec(line.trim());
  if (match === null) return null;
  const [, reviewer, yearText, monthText, dayText] = match;
  if (reviewer.length > 39) return null;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (year === 0) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return line.trim();
}

const HTML_TEXT_BOUNDARY_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'legend',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

function stripHtmlTags(html) {
  let text = '';
  let inTag = false;
  let quote = null;
  let tag = '';
  for (const character of html) {
    if (!inTag) {
      if (character === '<') {
        inTag = true;
        tag = '';
      } else text += character;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      tag += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      tag += character;
    } else if (character === '>') {
      const tagName = /^\s*\/?\s*([A-Za-z][\w:-]*)/.exec(tag)?.[1]?.toLowerCase() ?? null;
      if (tagName !== null && HTML_TEXT_BOUNDARY_TAGS.has(tagName)) text += ' ';
      inTag = false;
    } else {
      tag += character;
    }
  }
  return text;
}

function renderedMarkdownText(markdown) {
  const html = marked
    .parse(markdown)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(pre|code|script|style|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '');
  return decodeHTML(stripHtmlTags(html))
    .replace(/\p{Default_Ignorable_Code_Point}+/gu, '')
    .replace(/\p{White_Space}+/gu, ' ')
    .replace(/\p{Cc}+/gu, '')
    .trim();
}

function independentLifecycleEvidence(body) {
  const lines = markdownLinesOutsideCode(body);
  const headings = lines.flatMap((line, index) =>
    line.trim() === INDEPENDENT_LIFECYCLE_HEADING ? [index] : [],
  );
  if (headings.length !== 1) return { reason: null, semanticReview: null };
  const [heading] = headings;
  const section = [];
  for (let index = heading + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{1,2}\s+/.test(line.trim())) break;
    if (line.trim() !== '' && /^(?:=+|-+)\s*$/.test((lines[index + 1] ?? '').trim())) {
      break;
    }
    section.push(line);
  }
  const receipts = section.flatMap((line, index) => {
    const receipt = validSemanticReviewReceipt(line);
    return receipt === null ? [] : [{ index, receipt }];
  });
  const receiptIndexes = new Set(receipts.map(({ index }) => index));
  const evidenceMarkdown = section.filter((_, index) => !receiptIndexes.has(index)).join('\n');
  const reason = renderedMarkdownText(evidenceMarkdown);
  const hasReceiptVariant = /\bSemantic review\b/i.test(reason);
  return {
    reason: reason === '' ? null : reason,
    semanticReview: receipts.length === 1 && !hasReceiptVariant ? receipts[0].receipt : null,
  };
}

export function classifyOpenIssueHierarchy(nodes) {
  const result = { retained: [], missing: [], examined: 0 };
  for (const issue of nodes) {
    if (issue.parent === null) continue;
    result.examined += 1;
    const parentNumber = issue.parent.number;
    const parentUrl = issue.parent.url;
    const evidence = independentLifecycleEvidence(issue.body);
    const reason = evidence.reason;
    if (reason === null) {
      result.missing.push({
        issue,
        parentNumber,
        parentUrl,
        reason: 'missing or blank section',
      });
    } else if (evidence.semanticReview === null) {
      result.missing.push({
        issue,
        parentNumber,
        parentUrl,
        reason: 'missing semantic RETAIN review receipt',
      });
    } else {
      result.retained.push({
        issue,
        parentNumber,
        parentUrl,
        reason,
        semanticReview: evidence.semanticReview,
      });
    }
  }
  return result;
}

export function scanOpenIssueHierarchy(nodes) {
  const result = classifyOpenIssueHierarchy(nodes);
  examinedOpenChildIssues = result.examined;
  return result;
}

export function readExaminedOpenChildIssueCount() {
  return examinedOpenChildIssues;
}

export async function fetchOpenIssueHierarchy({ owner, name, runPage }) {
  const nodes = [];
  const cursors = new Set();
  let after = null;
  while (true) {
    const page = await runPage({ owner, name, after });
    if (!Array.isArray(page?.nodes) || typeof page?.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('native hierarchy page is incomplete');
    }
    for (const node of page.nodes) {
      if (!Object.hasOwn(node, 'parent')) {
        throw new Error(`native hierarchy node #${node?.number ?? '?'} has no parent field`);
      }
      if (
        node.parent !== null &&
        (!Number.isInteger(node.parent?.number) ||
          node.parent.number < 1 ||
          typeof node.parent?.url !== 'string' ||
          node.parent.url === '')
      ) {
        throw new Error(
          `native hierarchy node #${node?.number ?? '?'} has an invalid parent field`,
        );
      }
    }
    nodes.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) return nodes;
    if (typeof page.pageInfo.endCursor !== 'string' || page.pageInfo.endCursor === '') {
      throw new Error('native hierarchy pagination has no end cursor');
    }
    if (cursors.has(page.pageInfo.endCursor)) {
      throw new Error(`native hierarchy pagination repeated cursor ${page.pageInfo.endCursor}`);
    }
    cursors.add(page.pageInfo.endCursor);
    after = page.pageInfo.endCursor;
  }
}

export function assertOpenIssueHierarchyPopulation(restIssues, graphqlNodes) {
  const restNumbers = restIssues.map(({ number }) => number);
  const graphqlNumbers = graphqlNodes.map(({ number }) => number);
  if (new Set(restNumbers).size !== restNumbers.length) {
    throw new Error('REST open-Issue population contains duplicate numbers');
  }
  if (new Set(graphqlNumbers).size !== graphqlNumbers.length) {
    throw new Error('GraphQL open-Issue population contains duplicate numbers');
  }
  const rest = new Set(restNumbers);
  const graphql = new Set(graphqlNumbers);
  const restOnly = [...rest].filter((number) => !graphql.has(number)).sort((a, b) => a - b);
  const graphqlOnly = [...graphql].filter((number) => !rest.has(number)).sort((a, b) => a - b);
  if (restOnly.length !== 0 || graphqlOnly.length !== 0) {
    const format = (numbers) =>
      numbers.length === 0 ? '(none)' : numbers.map((n) => `#${n}`).join(',');
    throw new Error(
      `native hierarchy visibility mismatch: REST-only=${format(restOnly)} GraphQL-only=${format(graphqlOnly)}`,
    );
  }
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

function taskChildren(taskText) {
  return asList(frontmatterObject(taskText).children);
}

export function resolveOpenTaskLinks(issues, taskCandidates) {
  const links = new Map();
  const problems = new Map();
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  for (const [issueNumber, candidates] of taskCandidates) {
    if (candidates.length === 1) {
      links.set(issueNumber, candidates[0].taskPath);
      continue;
    }
    const issue = issueByNumber.get(issueNumber);
    const markedCandidates = candidates.filter(({ taskPath }) => {
      const id = taskIdentity(taskPath);
      return hasExactMarker(issue ?? {}, taskMarker({ id, taskPath }));
    });
    if (markedCandidates.length !== 1) {
      problems.set(issueNumber, 'multiple Task citations require one AGREEMENT parent marker');
      continue;
    }
    const parent = markedCandidates[0];
    const parentId = taskIdentity(parent.taskPath);
    const declaredChildren = taskChildren(parent.taskText).sort();
    const candidateChildren = candidates
      .filter((candidate) => candidate !== parent)
      .map(({ taskPath }) => taskIdentity(taskPath))
      .sort();
    const hasNestedAgreement = candidates
      .filter((candidate) => candidate !== parent)
      .some(({ taskText }) => taskChildren(taskText).length > 0);
    if (
      parentId.startsWith('AGREEMENT-') &&
      declaredChildren.length > 0 &&
      JSON.stringify(declaredChildren) === JSON.stringify(candidateChildren) &&
      !hasNestedAgreement
    ) {
      links.set(issueNumber, parent.taskPath);
    } else {
      problems.set(issueNumber, 'AGREEMENT parent children do not match Task candidates');
    }
  }
  return { links, problems };
}

export function auditOpenIssues(issues, taskCandidates) {
  const resolved = resolveOpenTaskLinks(issues, taskCandidates);
  return classifyOpenIssues(issues, resolved.links, resolved.problems);
}

export function auditOpenIssueState({ issues, taskCandidates, hierarchyNodes }) {
  assertOpenIssueHierarchyPopulation(issues, hierarchyNodes);
  const resolved = resolveOpenTaskLinks(issues, taskCandidates);
  return {
    issues: scanOpenIssues(issues, resolved.links, resolved.problems),
    hierarchy: scanOpenIssueHierarchy(hierarchyNodes),
  };
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

const OPEN_ISSUE_HIERARCHY_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    issues(first: 100, states: OPEN, after: $after) {
      nodes {
        number
        title
        url
        body
        parent { number url }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

async function runLiveHierarchyPage({ owner, name, after }) {
  const args = [
    'api',
    'graphql',
    '-f',
    `query=${OPEN_ISSUE_HIERARCHY_QUERY}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `name=${name}`,
  ];
  if (after !== null) args.push('-F', `after=${after}`);
  const response = runGhJson(args);
  if (Array.isArray(response.errors) && response.errors.length !== 0) {
    throw new Error(`native hierarchy GraphQL error: ${JSON.stringify(response.errors)}`);
  }
  const connection = response.data?.repository?.issues;
  if (connection === null || connection === undefined) {
    throw new Error('native hierarchy GraphQL response has no open-Issue connection');
  }
  return connection;
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

export function collectOpenTaskCandidates(root) {
  const directory = path.join(root, '.agents/tasks');
  const candidates = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') continue;
    const taskPath = `.agents/tasks/${entry.name}`;
    const text = readFileSync(path.join(root, taskPath), 'utf8');
    const issueNumber = /^issue:\s*https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\s*$/m.exec(
      text,
    )?.[1];
    if (issueNumber === undefined) continue;
    const numericIssue = Number(issueNumber);
    const issueCandidates = candidates.get(numericIssue) ?? [];
    issueCandidates.push({ taskPath, taskText: text });
    candidates.set(numericIssue, issueCandidates);
  }
  return candidates;
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

export async function auditCommand({
  args,
  repo,
  root,
  listIssues = async () =>
    runGhJson([
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--limit',
      '10000',
      '--json',
      'number,title,url,labels,comments',
    ]),
  taskCandidates,
  runHierarchyPage = runLiveHierarchyPage,
  write = (line) => console.log(line),
  markFailure = () => {
    process.exitCode = 1;
  },
}) {
  const parts = repo.split('/');
  if (parts.length !== 2 || parts.some((part) => part === '')) {
    throw new Error('--repo must use OWNER/REPO');
  }
  const [owner, name] = parts;
  const issues = await listIssues();
  const hierarchyNodes = await fetchOpenIssueHierarchy({
    owner,
    name,
    runPage: runHierarchyPage,
  });
  const result = auditOpenIssueState({
    issues,
    taskCandidates: taskCandidates ?? collectOpenTaskCandidates(root),
    hierarchyNodes,
  });
  for (const category of ['intake', 'candidates', 'converted', 'malformed']) {
    write(`${category}: ${result.issues[category].length}`);
    for (const item of result.issues[category]) {
      write(`  #${item.issue.number} ${item.issue.title} — ${item.reason}`);
    }
  }
  write(`::examined:: ${result.issues.examined} open issue(s)`);
  for (const category of ['retained', 'missing']) {
    write(`native-child-${category}: ${result.hierarchy[category].length}`);
    for (const item of result.hierarchy[category]) {
      const detail =
        item.semanticReview === undefined ? item.reason : `${item.reason} | ${item.semanticReview}`;
      write(
        `  #${item.issue.number} parent=${item.parentUrl} ${item.issue.title} — ${detail.replace(/\s+/g, ' ')}`,
      );
    }
  }
  write(`::examined:: ${result.hierarchy.examined} open child issue(s)`);
  if (
    args.includes('--check') &&
    (result.issues.malformed.length !== 0 || result.hierarchy.missing.length !== 0)
  ) {
    markFailure();
  }
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
  else if (command === 'audit') await auditCommand({ args, repo, root });
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
