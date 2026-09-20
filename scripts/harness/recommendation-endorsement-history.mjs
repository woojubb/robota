import { decisionProjectionDigest } from './recommendation-review-record.mjs';
import {
  isCommittedRecommendationCheckpoint,
  isStagedRecommendationCheckpoint,
  validLatestRecommendationAttestation,
} from './recommendation-endorsement-checkpoint.mjs';
import {
  recommendationCommitExists,
  recommendationGit,
  recommendationIsAncestor,
  resolveRecommendationBaseRef,
} from './recommendation-endorsement-git.mjs';
import {
  GOVERNED_STATES,
  LEDGER,
  SPEC_ROOT,
  addedRecommendationObservations,
  bytesAt,
  changedRecommendationPaths,
  collectRecommendationStagedSubjects,
  collectRecommendationTopicSubjects,
  disappearedRecommendationSubjectFinding,
  historicallyGovernedSubjects,
  indexSpec,
  indexText,
  isRecommendationPlanningPath,
  ledgerAt,
  parseLedgerText,
  recommendationFinding,
  recommendationObservationKey,
  recommendationObservations,
  recommendationTopicCommits,
  specAt,
  stagedRecommendationPaths,
  subjectWasPostApproval,
} from './recommendation-endorsement-internals.mjs';
import {
  initializeRecommendationReplayState,
  readRecommendationBaseline,
} from './recommendation-endorsement-persisted.mjs';
function missingCommitSpec(state, paths, findingPath, subject, commit) {
  if (!state.governedSeen) return { state, findings: [] };
  const next = { ...state, unendorsed: true, bootstrapPending: false };
  const implementation = paths.filter(
    (pathname) => !isRecommendationPlanningPath(pathname, subject),
  );
  const findings =
    implementation.length === 0
      ? []
      : [
          recommendationFinding(
            findingPath,
            `${commit.slice(0, 9)}: implementation precedes a current recommendation endorsement checkpoint (${implementation.join(', ')})`,
          ),
        ];
  return { state: next, findings };
}
function projectCommitSpec(state, atCommit, commit) {
  const governedSeen = state.governedSeen || GOVERNED_STATES.includes(atCommit.state);
  const matchesBytes = state.endorsedBytes !== null && atCommit.text === state.endorsedBytes;
  let digest = matchesBytes ? state.endorsedDigest : null;
  if (!matchesBytes) {
    try {
      digest = decisionProjectionDigest(atCommit.text);
    } catch (error) {
      if (state.bootstrapPending) return { skip: true, state: { ...state, governedSeen } };
      return {
        skip: true,
        state: { ...state, governedSeen },
        finding: recommendationFinding(
          atCommit.relative,
          `${commit.slice(0, 9)}: ${error.message}`,
        ),
      };
    }
  }
  if (state.bootstrapPending && digest !== state.bootstrapDigest) {
    return { skip: true, state: { ...state, governedSeen } };
  }
  const bootstrapAccepted = state.bootstrapPending;
  return {
    skip: false,
    digest,
    state: {
      ...state,
      governedSeen,
      endorsedDigest: bootstrapAccepted ? digest : state.endorsedDigest,
      unendorsed: bootstrapAccepted
        ? false
        : (!matchesBytes && digest !== state.endorsedDigest) || state.unendorsed,
      bootstrapPending: false,
    },
  };
}

function applyCommitCheckpoint(root, state, subject, digest, parent, commit, paths) {
  const added = addedRecommendationObservations(
    ledgerAt(root, parent),
    ledgerAt(root, commit),
    subject,
  );
  if (added.length === 0) return { state, findings: [] };
  const parents = recommendationGit(root, ['show', '--no-patch', '--format=%P', commit])
    .split(/\s+/)
    .filter(Boolean);
  if (parents.length > 1) {
    const inherited = new Set(
      parents
        .slice(1)
        .flatMap((revision) =>
          recommendationObservations(ledgerAt(root, revision), subject).map(
            recommendationObservationKey,
          ),
        ),
    );
    if (added.every((record) => inherited.has(recommendationObservationKey(record)))) {
      return { state, findings: [] };
    }
  }
  if (!isCommittedRecommendationCheckpoint(root, parent, commit, paths)) {
    return {
      state,
      findings: [
        recommendationFinding(
          LEDGER,
          `${commit.slice(0, 9)}: recommendation observation is not an exact planning-only, reachable-revision endorsement checkpoint for ${subject}`,
        ),
      ],
    };
  }
  return {
    state: { ...state, endorsedDigest: digest, endorsedBytes: null, unendorsed: false },
    findings: [],
  };
}

function replayCommit(root, state, subject, findingPath, commit) {
  const parent = recommendationGit(root, ['rev-parse', `${commit}^`]).trim();
  const paths = changedRecommendationPaths(root, parent, commit);
  const atCommit = specAt(root, commit, subject);
  if (atCommit === null) return missingCommitSpec(state, paths, findingPath, subject, commit);
  if (atCommit.state === 'rejected' && !subjectWasPostApproval(root, subject, commit)) {
    return { state, findings: [] };
  }
  const governedSeen =
    state.governedSeen ||
    GOVERNED_STATES.includes(atCommit.state) ||
    subjectWasPostApproval(root, subject, commit);
  const projected = projectCommitSpec({ ...state, governedSeen }, atCommit, commit);
  if (projected.skip) {
    return { state: projected.state, findings: projected.finding ? [projected.finding] : [] };
  }
  const checkpoint = applyCommitCheckpoint(
    root,
    projected.state,
    subject,
    projected.digest,
    parent,
    commit,
    paths,
  );
  const implementation = paths.filter(
    (pathname) => !isRecommendationPlanningPath(pathname, subject),
  );
  const finding =
    checkpoint.state.unendorsed && implementation.length > 0
      ? recommendationFinding(
          findingPath,
          `${commit.slice(0, 9)}: implementation precedes a current recommendation endorsement checkpoint (${implementation.join(', ')})`,
        )
      : null;
  return {
    state: checkpoint.state,
    findings: [...checkpoint.findings, ...(finding ? [finding] : [])],
  };
}

function replaySubject(root, base, commits, subject, baseline, governedHistory, ledgerSubjects) {
  const headSpec = specAt(root, 'HEAD', subject);
  const findings = [];
  if (headSpec === null) {
    if (governedHistory.has(subject)) {
      findings.push(disappearedRecommendationSubjectFinding(subject, 'HEAD'));
    } else if (ledgerSubjects.has(subject)) {
      findings.push(
        recommendationFinding(
          LEDGER,
          `recommendation observation subject ${subject} has no current recommendation spec and cannot form a checkpoint`,
        ),
      );
      return findings;
    } else return findings;
  }
  if (headSpec?.state === 'rejected' && !subjectWasPostApproval(root, subject, 'HEAD'))
    return findings;
  const findingPath = headSpec?.relative ?? `${SPEC_ROOT}/{todo,active,done,rejected}/${subject}`;
  const bootstrapDigest =
    baseline.bootstrap?.subject === subject ? baseline.bootstrap.projectionDigest : null;
  let state = initializeRecommendationReplayState(root, base, subject, baseline, bootstrapDigest);
  state = { ...state, bootstrapDigest };
  for (const commit of commits) {
    const result = replayCommit(root, state, subject, findingPath, commit);
    state = result.state;
    findings.push(...result.findings);
  }
  return findings;
}

export function findRecommendationTopicFindings(root, requestedBase) {
  const baseline = readRecommendationBaseline(root);
  const resolvedBase = resolveRecommendationBaseRef(root, requestedBase);
  if (!resolvedBase) throw new Error('recommendation-endorsement: cannot resolve the topic base.');
  const base =
    recommendationCommitExists(root, resolvedBase) &&
    recommendationIsAncestor(root, resolvedBase, baseline.adoptionRevision)
    ? baseline.adoptionRevision
    : resolvedBase;
  const commits = recommendationTopicCommits(root, base);
  const findings = [];
  const governed = historicallyGovernedSubjects(root, 'HEAD', baseline.adoptionRevision);
  const { subjects, ledgerSubjects } = collectRecommendationTopicSubjects(root, commits);
  for (const subject of subjects) {
    findings.push(
      ...replaySubject(root, base, commits, subject, baseline, governed, ledgerSubjects),
    );
  }
  return findings;
}

function missingStagedSpecFindings(subject, beforeLedger, afterLedger, governed) {
  const added = addedRecommendationObservations(beforeLedger, afterLedger, subject);
  const findings = [];
  if (added.length > 0) {
    findings.push(
      recommendationFinding(
        LEDGER,
        `staged recommendation observation subject ${subject} has no current recommendation spec and cannot form a checkpoint`,
      ),
    );
  }
  if (governed.has(subject)) {
    findings.push(disappearedRecommendationSubjectFinding(subject, 'the proposed index'));
  }
  return findings;
}

function stagedSubjectFindings(root, subject, context) {
  const spec = indexSpec(root, subject);
  if (spec === null) {
    return missingStagedSpecFindings(
      subject,
      context.beforeLedger,
      context.afterLedger,
      context.governed,
    );
  }
  if (spec.state === 'rejected' && !subjectWasPostApproval(root, subject, 'HEAD')) return [];
  let digest;
  try {
    digest = decisionProjectionDigest(spec.text);
  } catch (error) {
    return [recommendationFinding(spec.relative, error.message)];
  }
  const adopted = bytesAt(root, context.baseline.adoptionRevision, spec.relative);
  if (adopted === spec.text) return [];
  let endorsed =
    context.baseline.bootstrap !== null &&
    context.baseline.bootstrap.subject === subject &&
    context.baseline.bootstrap.projectionDigest === digest;
  const previousRecords = recommendationObservations(context.beforeLedger, subject);
  if (validLatestRecommendationAttestation(previousRecords, subject, digest).ok) endorsed = true;
  const added = addedRecommendationObservations(context.beforeLedger, context.afterLedger, subject);
  const findings = [];
  if (added.length > 0) {
    if (!isStagedRecommendationCheckpoint(root, context.paths)) {
      findings.push(
        recommendationFinding(
          LEDGER,
          `staged recommendation observation is not an exact planning-only, reachable-revision endorsement checkpoint for ${subject}`,
        ),
      );
    } else endorsed = true;
  }
  const implementation = context.paths.filter(
    (pathname) => !isRecommendationPlanningPath(pathname, subject),
  );
  if (!endorsed && implementation.length > 0) {
    findings.push(
      recommendationFinding(
        spec.relative,
        `staged implementation precedes a current recommendation endorsement checkpoint (${implementation.join(', ')})`,
      ),
    );
  }
  return findings;
}

export function findRecommendationStagedFindings(root, requestedBase) {
  const baseline = readRecommendationBaseline(root, ':index');
  const base = resolveRecommendationBaseRef(root, requestedBase);
  if (!base) throw new Error('recommendation-endorsement: cannot resolve the staged topic base.');
  const findings = [...findRecommendationTopicFindings(root, base)];
  const paths = stagedRecommendationPaths(root);
  if (paths.length === 0) return findings;
  const governed = historicallyGovernedSubjects(root, 'HEAD', baseline.adoptionRevision);
  const beforeLedger = ledgerAt(root, 'HEAD');
  const afterLedger = parseLedgerText(indexText(root, LEDGER));
  const subjects = collectRecommendationStagedSubjects(
    root,
    base,
    paths,
    governed,
    beforeLedger,
    afterLedger,
  );
  const context = { baseline, paths, governed, beforeLedger, afterLedger };
  for (const subject of subjects) {
    findings.push(...stagedSubjectFindings(root, subject, context));
  }
  return findings;
}
