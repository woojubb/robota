#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { decisionProjectionDigest } from './recommendation-projection.mjs';

export {
  decisionProjection,
  decisionProjectionDigest,
  recommendationCheckpointEvidence,
} from './recommendation-projection.mjs';
export {
  normalizeRecommendationReviewMetadata,
  recommendationEndorsementKey,
  recommendationReviewExtensionErrors,
  recordRecommendationExpectation,
  recordRecommendationObservation,
  RECOMMENDATION_ENDORSEMENT_DOMAIN,
  RECOMMENDATION_REVIEW_AGENT,
  RECOMMENDATION_REVIEW_EXTENSION,
  RECOMMENDATION_REVIEW_OWNER,
  RECOMMENDATION_VERDICTS,
} from './recommendation-review-validation.mjs';

export function main(args = process.argv.slice(2), out = console.log) {
  if (args[0] !== 'digest' || typeof args[1] !== 'string' || args.length !== 2) {
    throw new Error(
      'usage: node scripts/harness/recommendation-review-record.mjs digest <spec.md>',
    );
  }
  out(decisionProjectionDigest(readFileSync(args[1], 'utf8')));
  return 0;
}

const isDirectExecution = process.argv[1]?.endsWith('recommendation-review-record.mjs') === true;
if (isDirectExecution) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
