#!/usr/bin/env node

import path from 'node:path';

import { exactWorkRunReceiptTrailers } from './work-run-commit-trailers.mjs';
import { git, pullRequestHistory, repoContext, repositoryNameFromGit } from './work-run-git.mjs';
import { exactReceiptClosure } from './work-run-git-adapter.mjs';
import { createOpeningHeadComment } from './work-run-opening-head-evidence.mjs';

export function attestCurrentOpeningHead(
  root = process.cwd(),
  { run, wait, resolvePr = pullRequestHistory } = {},
) {
  const context = repoContext(root);
  if (!context.branch) throw new Error('opening-head attestation needs a topic branch');
  const pr = resolvePr(context.root, context.branch);
  if (pr.status !== 'none') {
    throw new Error(
      pr.status === 'exists'
        ? 'opening-head attestation must be created before any pull request has existed'
        : `opening-head attestation cannot prove PR absence: ${pr.reason ?? 'unknown'}`,
    );
  }
  const headOid = git(context.root, ['rev-parse', 'HEAD^{commit}']);
  const closure = exactReceiptClosure(context.root, headOid);
  if (!closure) throw new Error('opening-head attestation requires a receipt-only closure commit');
  const message = git(context.root, ['show', '-s', '--format=%B', headOid]);
  const { runId, receiptId } = exactWorkRunReceiptTrailers(message);
  if (receiptId !== 'g0-r0') {
    throw new Error('opening-head attestation requires the g0-r0 closure commit');
  }
  if (closure.receiptPath !== `.agents/evals/work-runs/${runId}/g0-r0.json`) {
    throw new Error('opening-head attestation receipt path does not match its trailers');
  }
  return createOpeningHeadComment(
    context.root,
    repositoryNameFromGit(context.root),
    { runId, headOid },
    { run, wait },
  );
}

export function main() {
  process.stdout.write(`${JSON.stringify(attestCurrentOpeningHead())}\n`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
