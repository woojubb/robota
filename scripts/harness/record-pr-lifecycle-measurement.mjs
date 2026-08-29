#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function value(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

export function readPullRequest(number, repo = process.env.GITHUB_REPOSITORY ?? 'woojubb/robota') {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(number),
      '--repo',
      repo,
      '--json',
      'number,title,state,createdAt,mergedAt,mergeCommit,labels',
    ],
    { encoding: 'utf8' },
  );
  const source = JSON.parse(raw);
  if (source.state !== 'MERGED' || !source.mergedAt || !source.mergeCommit?.oid) {
    throw new Error(`PR #${number} is not a verified merged PR with merge identity`);
  }
  return {
    number: source.number,
    title: source.title,
    state: source.state,
    openedAt: source.createdAt,
    mergedAt: source.mergedAt,
    mergeCommit: source.mergeCommit.oid,
    labels: (source.labels ?? []).map((label) => label.name).sort(),
  };
}

export function measurePullRequests(numbers, repo) {
  const sourcePrs = numbers.map((number) => readPullRequest(number, repo));
  const conversionPrs = sourcePrs.filter(
    (pr) => pr.title === 'docs(security-002): convert issue 2082 to decoder task',
  );
  const conversionPrOpenWaitSeconds = conversionPrs.reduce(
    (total, pr) => total + (Date.parse(pr.mergedAt) - Date.parse(pr.openedAt)) / 1000,
    0,
  );
  return {
    schema: 1,
    capturedAt: new Date().toISOString(),
    repository: repo,
    sourcePrs,
    prLifecycleCount: sourcePrs.length,
    conversionPrCount: conversionPrs.length,
    conversionPrOpenWaitSeconds,
  };
}

export function main(argv = process.argv.slice(2)) {
  const source = value(argv, '--source-prs');
  const output = value(argv, '--output');
  if (!source || !output) throw new Error('usage: --source-prs N[,N...] --output PATH');
  const numbers = source.split(',').map((number) => Number(number.trim()));
  if (numbers.some((number) => !Number.isInteger(number) || number < 1)) {
    throw new Error('--source-prs must contain positive PR numbers');
  }
  const repo = process.env.GITHUB_REPOSITORY ?? 'woojubb/robota';
  const measurement = measurePullRequests(numbers, repo);
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(measurement, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    console.error(`record-pr-lifecycle-measurement: ${error.message}`);
    process.exitCode = 1;
  }
}
