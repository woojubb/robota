import type {
  IAutomaticMemoryConfig,
  IMemoryCandidate,
  IMemoryDecision,
} from './automatic-memory-types.js';

const AUTO_SAVE_CONFIDENCE_THRESHOLD = 0.85;
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /\b(api[_-]?key|secret|token|password|private key)\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,
  /주민등록|비밀번호|시크릿|토큰/u,
];

export class MemoryPolicyEvaluator {
  evaluate(candidate: IMemoryCandidate, config: IAutomaticMemoryConfig): IMemoryDecision {
    if (config.policy === 'disabled') {
      return { action: 'skip', reason: 'memory-policy-disabled' };
    }

    if (this.containsSensitiveContent(candidate.text)) {
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

  private containsSensitiveContent(text: string): boolean {
    return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
  }
}
