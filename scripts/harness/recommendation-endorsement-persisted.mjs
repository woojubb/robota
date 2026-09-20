import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import {
  decisionProjectionDigest,
  recommendationEndorsementKey,
} from './recommendation-review-record.mjs';
import {
  recommendationAttestationIndex,
  validLatestRecommendationAttestation,
} from './recommendation-endorsement-checkpoint.mjs';
import {
  recommendationCommitExists,
  recommendationGit,
  recommendationIsAncestor,
} from './recommendation-endorsement-git.mjs';
import {
  BASELINE,
  GOVERNED_STATES,
  LEDGER,
  SPEC_ROOT,
  bytesAt,
  disappearedRecommendationSubjectFinding,
  exactRecommendationKeys,
  historicallyGovernedSubjects,
  indexSpec,
  indexText,
  ledgerAt,
  readRecommendationLedger,
  recommendationFinding,
  recommendationObservationSubjects,
  specAt,
  subjectWasPostApproval,
} from './recommendation-endorsement-internals.mjs';
let examined = 0;

export function examinedRecommendationEndorsementCount() {
  return examined;
}
function parseBaselineSource(root, sourceRevision) {
  try {
    const source =
      sourceRevision === ':index'
        ? indexText(root, BASELINE)
        : readFileSync(path.join(root, BASELINE), 'utf8');
    if (source === null) throw new Error('baseline is absent from the proposed index');
    return { source, parsed: JSON.parse(source) };
  } catch (error) {
    throw new Error(`recommendation-endorsement: cannot parse ${BASELINE}: ${error.message}`);
  }
}
function assertBaselineShape(parsed, root) {
  if (!exactRecommendationKeys(parsed, ['adoptionRevision', 'bootstrap'])) {
    throw new Error(
      `recommendation-endorsement: ${BASELINE} must contain exactly adoptionRevision and bootstrap.`,
    );
  }
  if (
    typeof parsed.adoptionRevision !== 'string' ||
    !/^[0-9a-f]{40}$/.test(parsed.adoptionRevision)
  ) {
    throw new Error(
      'recommendation-endorsement: adoptionRevision must be one full lowercase commit id.',
    );
  }
  if (!recommendationCommitExists(root, parsed.adoptionRevision)) {
    throw new Error(
      `recommendation-endorsement: adoption revision ${parsed.adoptionRevision} is not a commit in this repository.`,
    );
  }
}
function baselineIntroduction(root, source, sourceRevision) {
  const introductions = recommendationGit(root, [
    'log',
    '--diff-filter=A',
    '--format=%H',
    '--',
    BASELINE,
  ])
    .split('\n')
    .filter(Boolean);
  const staged =
    introductions.length === 0 &&
    bytesAt(root, 'HEAD', BASELINE) === null &&
    indexText(root, BASELINE) === source;
  if (introductions.length !== 1 && !staged) {
    throw new Error(
      `recommendation-endorsement: ${BASELINE} must have exactly one immutable introduction commit.`,
    );
  }
  const revision = staged ? ':index' : introductions[0];
  const introducedBytes = staged ? indexText(root, BASELINE) : bytesAt(root, revision, BASELINE);
  if (introducedBytes !== source) {
    throw new Error(
      `recommendation-endorsement: ${BASELINE} differs from its immutable introduction bytes at ${revision}.`,
    );
  }
  return { revision, staged };
}
function assertBootstrapShape(bootstrap) {
  const keys = ['subject', 'reviewedRevision', 'projectionDigest', 'endorsementKey'];
  if (!exactRecommendationKeys(bootstrap, keys)) {
    throw new Error(
      'recommendation-endorsement: bootstrap must be null or one exact subject/reviewedRevision/projectionDigest/endorsementKey tuple.',
    );
  }
  if (
    typeof bootstrap.subject !== 'string' ||
    !/^[A-Z][A-Z0-9]*-\d+[A-Za-z0-9._-]*\.md$/.test(bootstrap.subject) ||
    !/^[0-9a-f]{40}$/.test(bootstrap.reviewedRevision) ||
    !/^[0-9a-f]{64}$/.test(bootstrap.projectionDigest) ||
    !/^[0-9a-f]{64}$/.test(bootstrap.endorsementKey)
  ) {
    throw new Error(
      'recommendation-endorsement: bootstrap tuple contains a malformed or wildcard value.',
    );
  }
}

function validateBootstrap(root, bootstrap, introduction) {
  assertBootstrapShape(bootstrap);
  const reviewed = introduction.staged
    ? indexSpec(root, bootstrap.subject)
    : specAt(root, introduction.revision, bootstrap.subject);
  let reviewedDigest = null;
  try {
    reviewedDigest = reviewed === null ? null : decisionProjectionDigest(reviewed.text);
  } catch {
    reviewedDigest = null;
  }
  if (
    reviewedDigest !== bootstrap.projectionDigest ||
    bootstrap.endorsementKey !==
      recommendationEndorsementKey(bootstrap.subject, bootstrap.projectionDigest)
  ) {
    throw new Error(
      'recommendation-endorsement: bootstrap introduction does not contain the exact subject projection digest and endorsement key.',
    );
  }
}

export function readRecommendationBaseline(root, sourceRevision = 'worktree') {
  const { source, parsed } = parseBaselineSource(root, sourceRevision);
  assertBaselineShape(parsed, root);
  const introduction = baselineIntroduction(root, source, sourceRevision);
  const ancestryTarget = introduction.staged ? 'HEAD' : introduction.revision;
  if (!recommendationIsAncestor(root, parsed.adoptionRevision, ancestryTarget)) {
    throw new Error(
      'recommendation-endorsement: adoptionRevision must be an ancestor of the immutable baseline introduction.',
    );
  }
  if (parsed.bootstrap !== null) validateBootstrap(root, parsed.bootstrap, introduction);
  return parsed;
}

export function initializeRecommendationReplayState(
  root,
  base,
  subject,
  baseline,
  bootstrapDigest,
) {
  const baseSpec = specAt(root, base, subject);
  const state = {
    endorsedDigest: null,
    endorsedBytes: null,
    bootstrapPending: baseSpec === null && bootstrapDigest !== null,
    unendorsed: false,
    governedSeen:
      baseSpec !== null &&
      (GOVERNED_STATES.includes(baseSpec.state) ||
        (baseSpec.state === 'rejected' && subjectWasPostApproval(root, subject, base))),
  };
  if (
    baseSpec === null ||
    (baseSpec.state === 'rejected' && !subjectWasPostApproval(root, subject, base))
  )
    return state;
  const adopted = bytesAt(root, baseline.adoptionRevision, baseSpec.relative);
  if (adopted === baseSpec.text) {
    state.endorsedBytes = baseSpec.text;
    try {
      state.endorsedDigest = decisionProjectionDigest(baseSpec.text);
    } catch {}
  } else {
    try {
      const digest = decisionProjectionDigest(baseSpec.text);
      const { index, errors } = recommendationAttestationIndex(ledgerAt(root, base));
      const persisted =
        errors.length === 0 &&
        validLatestRecommendationAttestation(index.get(subject), subject, digest).ok;
      if (digest === bootstrapDigest || persisted) state.endorsedDigest = digest;
    } catch {}
  }
  state.unendorsed = state.endorsedBytes === null && state.endorsedDigest === null;
  return state;
}

function governedSpecs(root) {
  const files = [];
  for (const state of [...GOVERNED_STATES, 'rejected']) {
    const dir = path.join(root, SPEC_ROOT, state);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (
        name.endsWith('.md') &&
        (state !== 'rejected' || subjectWasPostApproval(root, name, 'HEAD'))
      ) {
        files.push({ state, name, relative: `${SPEC_ROOT}/${state}/${name}` });
      }
    }
  }
  return files;
}

export function currentRecommendationEndorsement(root, subject, markdown) {
  let digest;
  try {
    digest = decisionProjectionDigest(markdown);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  const { index, errors } = recommendationAttestationIndex(readRecommendationLedger(root));
  if (errors.length > 0) return { ok: false, reason: errors[0].detail };
  return validLatestRecommendationAttestation(index.get(subject), subject, digest);
}

function persistedSpecFinding(root, spec, baseline, index) {
  const current = readFileSync(path.join(root, spec.relative), 'utf8');
  const adopted = bytesAt(root, baseline.adoptionRevision, spec.relative);
  if (adopted !== null && adopted === current) return null;
  let digest;
  try {
    digest = decisionProjectionDigest(current);
  } catch (error) {
    return recommendationFinding(spec.relative, error.message);
  }
  if (
    baseline.bootstrap !== null &&
    baseline.bootstrap.subject === spec.name &&
    baseline.bootstrap.projectionDigest === digest
  )
    return null;
  const verdict = validLatestRecommendationAttestation(index.get(spec.name), spec.name, digest);
  if (verdict.ok) return null;
  const historical = adopted !== null ? 'historical adoption bytes changed; ' : '';
  return recommendationFinding(
    spec.relative,
    `${historical}${verdict.reason}. Record a current independent recommendation review checkpoint.`,
  );
}

export function findRecommendationEndorsementFindings(root) {
  requireGovernedTree(root, [SPEC_ROOT, BASELINE, LEDGER], {
    scan: 'recommendation-endorsement',
    why: 'the post-approval spec tree, immutable adoption anchor, and canonical loop ledger are the complete endorsement population',
  });
  const baseline = readRecommendationBaseline(root);
  const specs = governedSpecs(root);
  const currentSubjects = new Set(specs.map((spec) => spec.name));
  const historical = historicallyGovernedSubjects(root, 'HEAD', baseline.adoptionRevision);
  const missing = [...historical].filter((subject) => !currentSubjects.has(subject));
  examined = specs.length + missing.length;
  const ledgerEntries = readRecommendationLedger(root);
  const { index, errors } = recommendationAttestationIndex(ledgerEntries);
  const ghosts = [...recommendationObservationSubjects(ledgerEntries)].filter(
    (subject) => specAt(root, 'HEAD', subject) === null,
  );
  const findings = [
    ...errors,
    ...missing.map((subject) =>
      disappearedRecommendationSubjectFinding(subject, 'the working tree'),
    ),
    ...ghosts.map((subject) =>
      recommendationFinding(
        LEDGER,
        `recommendation observation subject ${subject} is a ghost with no current recommendation spec in any lifecycle state`,
      ),
    ),
  ];
  for (const spec of specs) {
    const found = persistedSpecFinding(root, spec, baseline, index);
    if (found) findings.push(found);
  }
  return findings;
}
