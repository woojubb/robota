#!/usr/bin/env node

/**
 * Claude review coverage guard (INFRA-098).
 *
 * Scope: workflow files under `.github/workflows` that invoke
 * `anthropics/claude-code-action`. This guard owns PR event coverage, the exact verdict identity
 * markers, and the prompt output-language contract. Token supply and permission breadth remain
 * owned by their existing scans.
 *
 * Exit 0 = at least one governed workflow was examined and all pass; 1 = finding or unreadable tree.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOW_DIR = path.join('.github', 'workflows');
const ACTION_STEP = /^\s*(?:-\s*)?uses:\s*anthropics\/claude-code-action(?:@\S+)?\s*$/;
const REQUIRED_EVENTS = ['opened', 'synchronize', 'reopened', 'edited'];
const FORBIDDEN_FILTER = /^\s*(branches|branches-ignore|paths|paths-ignore):/;
const REQUIRED_JOB_IF =
  "${{ github.event.pull_request.head.repo.full_name == github.repository && (github.event.action != 'edited' || github.event.changes.base != null) }}";
const REQUIRED_ENGLISH_OUTPUT = 'Write the PR summary and every inline review comment in English.';
const HANGUL_PATTERN = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u;
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function pullRequestBlock(source) {
  const lines = source.split('\n');
  const onIndex = lines.findIndex((line) => /^on:\s*$/.test(line));
  if (onIndex < 0) return [];
  const pullIndex = lines.findIndex(
    (line, index) => index > onIndex && /^\s+pull_request:\s*$/.test(line),
  );
  if (pullIndex < 0) return [];
  const pullIndent = indentation(lines[pullIndex]);
  const block = [lines[pullIndex]];
  for (const line of lines.slice(pullIndex + 1)) {
    if (line.trim() !== '' && indentation(line) <= pullIndent) break;
    block.push(line);
  }
  return block;
}

function actionStepIndices(lines) {
  return lines.flatMap((line, index) => (ACTION_STEP.test(line) ? [index] : []));
}

function stepBlock(lines, usesIndex) {
  const usesIndent = indentation(lines[usesIndex]);
  let end = lines.length;
  for (let index = usesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '') continue;
    const indent = indentation(line);
    if (indent < usesIndent || (indent <= usesIndent && line.trimStart().startsWith('- '))) {
      end = index;
      break;
    }
  }
  return lines.slice(usesIndex, end);
}

function promptBlock(lines, usesIndex) {
  const step = stepBlock(lines, usesIndex);
  const promptIndex = step.findIndex((line) => /^\s*prompt:\s*\|[-+]?\s*$/.test(line));
  if (promptIndex < 0) return [];
  const promptIndent = indentation(step[promptIndex]);
  const prompt = [];
  for (const line of step.slice(promptIndex + 1)) {
    if (line.trim() !== '' && indentation(line) <= promptIndent) break;
    prompt.push(line);
  }
  return prompt;
}

function owningJobBlock(lines, actionIndex) {
  const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  if (jobsIndex < 0 || actionIndex <= jobsIndex) return [];
  const firstJobIndex = lines.findIndex(
    (line, index) =>
      index > jobsIndex && line.trim() !== '' && /^\s+[A-Za-z0-9_-]+:\s*$/.test(line),
  );
  if (firstJobIndex < 0) return [];
  const jobIndent = indentation(lines[firstJobIndex]);
  let start = -1;
  for (let index = firstJobIndex; index <= actionIndex; index += 1) {
    if (indentation(lines[index]) === jobIndent && /^\s+[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      start = index;
    }
  }
  if (start < 0) return [];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (
      lines[index].trim() !== '' &&
      indentation(lines[index]) === jobIndent &&
      /^\s+[A-Za-z0-9_-]+:\s*$/.test(lines[index])
    ) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end);
}

function jobLevelScalar(job, key) {
  if (job.length === 0) return undefined;
  const jobIndent = indentation(job[0]);
  const childIndents = job
    .slice(1)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
    .map(indentation)
    .filter((indent) => indent > jobIndent);
  if (childIndents.length === 0) return undefined;
  const childIndent = Math.min(...childIndents);
  const prefix = `${key}:`;
  const field = job.find(
    (line) => indentation(line) === childIndent && line.trimStart().startsWith(prefix),
  );
  return field?.trimStart().slice(prefix.length).trim();
}

function normalizeExpression(value) {
  return value.replace(/\s+/g, '');
}

export function findWorkflowCoverageFindings(source) {
  const findings = [];
  const lines = source.split('\n');
  const actions = actionStepIndices(lines);
  if (actions.length === 0) {
    findings.push({ detail: 'governed workflow has no actual Claude review action step' });
  }
  const block = pullRequestBlock(source);
  if (block.length === 0) {
    findings.push({ detail: 'governed workflow has no block-form `pull_request` trigger' });
    return findings;
  }

  for (const line of block) {
    const match = FORBIDDEN_FILTER.exec(line);
    if (match) {
      findings.push({
        detail: `pull_request ${match[1]} filters exclude valid target/base branches; review must cover every base branch`,
      });
    }
  }

  const typesLine = block.find((line) => /^\s*types:\s*\[.*\]\s*$/.test(line));
  const declaredEvents = new Set(
    typesLine
      ? (typesLine.match(/\[(.*)\]/)?.[1] ?? '')
          .split(',')
          .map((event) => event.trim())
          .filter(Boolean)
      : [],
  );
  for (const event of REQUIRED_EVENTS) {
    if (!declaredEvents.has(event)) {
      findings.push({ detail: `pull_request lifecycle is missing required event \`${event}\`` });
    }
  }

  const markers = [
    ['REVIEWED BASE', '${{ github.event.pull_request.base.sha }}'],
    ['REVIEWED HEAD', '${{ github.event.pull_request.head.sha }}'],
    ['ACTIONABLE FINDINGS', '<n>'],
  ];
  for (const actionIndex of actions) {
    const prompt = promptBlock(lines, actionIndex);
    if (!prompt.some((line) => line.trim() === REQUIRED_ENGLISH_OUTPUT)) {
      findings.push({
        detail: `review prompt is missing the explicit English-output contract: ${REQUIRED_ENGLISH_OUTPUT}`,
      });
    }
    if (prompt.some((line) => HANGUL_PATTERN.test(line))) {
      findings.push({
        detail: 'review prompt contains Hangul; its instructions must be English-only',
      });
    }
    for (const [label, value] of markers) {
      const exactMarker = `${label}: ${value}`;
      if (!prompt.some((line) => line.trim().replaceAll('`', '') === exactMarker)) {
        findings.push({
          detail: `review prompt is missing exact \`${label}: ${value}\` verdict marker`,
        });
      }
    }
    const job = owningJobBlock(lines, actionIndex);
    const jobIf = jobLevelScalar(job, 'if');
    if (jobIf === undefined) {
      findings.push({ detail: 'review job is missing a job-level `if` condition' });
      continue;
    }
    if (normalizeExpression(jobIf) !== normalizeExpression(REQUIRED_JOB_IF)) {
      findings.push({
        detail:
          'review job must use the exact guarded condition for same-repository access and edited base retargets',
      });
    }
  }
  if (!/^\s*cancel-in-progress:\s*true\s*$/m.test(source)) {
    findings.push({ detail: 'review workflow must keep `cancel-in-progress: true`' });
  }
  return findings;
}

export function findClaudeReviewCoverageFindings(root = REPO_ROOT) {
  examinedCount = 0;
  const dir = path.join(root, WORKFLOW_DIR);
  if (!existsSync(dir)) {
    throw new Error(`${WORKFLOW_DIR} does not exist under ${root}; review coverage is unreadable`);
  }
  const workflows = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => path.join(WORKFLOW_DIR, name))
    .filter((relative) =>
      readFileSync(path.join(root, relative), 'utf8')
        .split('\n')
        .some((line) => ACTION_STEP.test(line)),
    );
  examinedCount = workflows.length;
  if (workflows.length === 0) {
    return {
      checked: [],
      findings: [
        {
          workflow: `(${WORKFLOW_DIR})`,
          detail: 'no workflow invokes the governed Claude review action',
        },
      ],
    };
  }
  const findings = workflows.flatMap((workflow) =>
    findWorkflowCoverageFindings(readFileSync(path.join(root, workflow), 'utf8')).map(
      (finding) => ({
        workflow,
        ...finding,
      }),
    ),
  );
  return { checked: workflows, findings };
}

function main() {
  let result;
  try {
    result = findClaudeReviewCoverageFindings();
  } catch (error) {
    console.error(
      `claude-review-coverage: FAIL — ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  console.log(`::examined:: ${readExamined()} governed workflow(s)`);
  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.error(`${finding.workflow}: ${finding.detail}`);
    }
    process.exit(1);
  }
  console.log('claude-review-coverage: PASS');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
