#!/usr/bin/env node

import path from 'node:path';

import {
  isCommittedRecommendationCheckpoint,
  isStagedRecommendationCheckpoint,
} from './recommendation-endorsement-checkpoint.mjs';
import { resolveRecommendationBaseRef } from './recommendation-endorsement-git.mjs';
import {
  findRecommendationStagedFindings as findStagedFindings,
  findRecommendationTopicFindings as findTopicFindings,
} from './recommendation-endorsement-history.mjs';
import {
  currentRecommendationEndorsement,
  examinedRecommendationEndorsementCount,
  findRecommendationEndorsementFindings as findPersistedFindings,
} from './recommendation-endorsement-persisted.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export {
  currentRecommendationEndorsement,
  examinedRecommendationEndorsementCount,
  isCommittedRecommendationCheckpoint,
  isStagedRecommendationCheckpoint,
  resolveRecommendationBaseRef,
};

export function findRecommendationTopicFindings(root = WORKSPACE_ROOT, requestedBase) {
  return findTopicFindings(root, requestedBase);
}

export function findRecommendationStagedFindings(root = WORKSPACE_ROOT, requestedBase) {
  return findStagedFindings(root, requestedBase);
}

export function findRecommendationEndorsementFindings(root = WORKSPACE_ROOT) {
  return findPersistedFindings(root);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function main(root = WORKSPACE_ROOT, args = process.argv.slice(2)) {
  try {
    const requestedBase = argumentValue(args, '--base');
    const staged = args.includes('--staged');
    const findings = staged
      ? findRecommendationStagedFindings(root, requestedBase)
      : findRecommendationEndorsementFindings(root);
    const topicBase = resolveRecommendationBaseRef(root, requestedBase);
    if (!staged && topicBase) findings.push(...findRecommendationTopicFindings(root, topicBase));
    process.stdout.write(
      `::examined:: ${examinedRecommendationEndorsementCount()} post-approval recommendation document(s)\n`,
    );
    if (findings.length > 0) {
      for (const item of findings) process.stderr.write(`✗ ${item.path}: ${item.detail}\n`);
      return 1;
    }
    process.stdout.write(
      `recommendation-endorsement scan passed (${examinedRecommendationEndorsementCount()} document(s) examined).\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`✗ ${error.message}\n`);
    return 1;
  }
}

const isDirectExecution = process.argv[1]?.endsWith('scan-recommendation-endorsement.mjs') === true;
if (isDirectExecution) process.exitCode = main();
