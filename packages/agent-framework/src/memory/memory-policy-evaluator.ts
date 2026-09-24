import type {
  IAutomaticMemoryConfig,
  IMemoryCandidate,
  IMemoryDecision,
} from './automatic-memory-types.js';

const AUTO_SAVE_CONFIDENCE_THRESHOLD = 0.85;
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // Letter boundaries rather than \b, so `aws_secret_access_key=` and `API_KEY=` still match.
  /(?<![a-z])(api[_-]?key|secret|token|password|private key)(?![a-z])/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,
  /주민등록|비밀번호|시크릿|토큰/u,
  // Secret-shaped values that carry no keyword: well-known credential prefixes, key blocks and JWTs.
  /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9]{36}|[rs]k_live_[A-Za-z0-9]{16,})/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
];

/**
 * Long runs that mix upper case, lower case and several digits look like generated secrets, not words.
 * Runs split at path, dot and hyphen separators so file paths, model names and kebab-case identifiers
 * are judged segment by segment.
 */
const HIGH_ENTROPY_MIN_LENGTH = 24;
const HIGH_ENTROPY_MIN_DIGITS = 3;
const TOKEN_RUN = /[A-Za-z0-9+_=]+/g;

function containsHighEntropyRun(text: string): boolean {
  for (const [run] of text.matchAll(TOKEN_RUN)) {
    if (
      run.length >= HIGH_ENTROPY_MIN_LENGTH &&
      /[a-z]/.test(run) &&
      /[A-Z]/.test(run) &&
      (run.match(/[0-9]/g)?.length ?? 0) >= HIGH_ENTROPY_MIN_DIGITS
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Heuristic, not a guarantee: keyword, format and secret-shape checks. A secret that looks like
 * ordinary prose can still pass, so memory must never be treated as a safe place for credentials.
 */
export function containsSensitiveMemoryContent(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text)) || containsHighEntropyRun(text);
}

export class MemoryPolicyEvaluator {
  evaluate(candidate: IMemoryCandidate, config: IAutomaticMemoryConfig): IMemoryDecision {
    if (config.policy === 'disabled') {
      return { action: 'skip', reason: 'memory-policy-disabled' };
    }

    if (containsSensitiveMemoryContent(candidate.text)) {
      return { action: 'skip', reason: 'sensitive-content' };
    }

    if (config.policy === 'approval_required') {
      return { action: 'queue', reason: 'approval-required' };
    }

    if (candidate.confidence >= AUTO_SAVE_CONFIDENCE_THRESHOLD) {
      return { action: 'save', reason: 'high-confidence-auto-save' };
    }

    return { action: 'queue', reason: 'low-confidence-auto-save-review' };
  }
}
