/**
 * Compatibility exports for code that consumes the gate programmatically.
 * Keep this list explicit: adding an implementation helper must not silently become public API.
 */
export {
  APPROVE_FIRST,
  BUILD_COMMAND_SHAPE,
  EXIT_FAIL,
  EXIT_PASS,
  EXIT_PENDING,
  JUDGED_AT_LABEL,
  L1_NOT_REQUIRED,
  PROBLEM_MIN_CHARS,
  PROBLEM_MIN_SENTENCES,
  REVIEW_FINGERPRINT_LABEL,
  TEST_COMMAND_SHAPE,
  changedSetSince,
  judgedAtLine,
  localDate,
  parseArgs,
  parseJudgedAt,
  prepareAdvance,
  runAdvance,
  runApprove,
  runJudge,
  runRecord,
} from './gate-operations.mjs';

export {
  appendToEvidenceLog,
  blobIdOf,
  checkboxItems,
  evidenceEntries,
  sectionBody,
  statusUpgradeOf,
  stripHtmlComments,
  taskPathFromSpec,
} from './gate-document.mjs';

export { parseCatalogue, parsePriorGateMap } from './gate-catalogue.mjs';

export {
  JUDGEMENTS,
  judgeCriteria,
  PLAN_IMPLEMENT_JUDGEMENTS,
  resolveLane,
} from './gate-operations.mjs';

export {
  boundClassMeasurement,
  measureLaneDeclaration,
  registryConditions,
  resolveBaseRef,
  reviewFingerprint,
} from './gate-operations.mjs';
