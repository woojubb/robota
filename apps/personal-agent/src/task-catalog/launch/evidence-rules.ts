/**
 * What counts as proof that a launched task did its work, one host-implemented rule for each
 * definition revision. A definition describes its success check in words for the person; the words
 * decide nothing. A rule is code the host reviewed with the revision, and it can only be satisfied by
 * receipts the host recorded from its own browser during this launch's run: a model's report, text
 * on a page, and anything a person typed are never read as evidence. A revision with no rule here
 * cannot be called verified, however well its run went.
 */
import { EMPTY_REPORT } from '../../run-report.js';
import { pageKey } from './receipts.js';

import type { IEvidenceReceipt, TLaunchInputs } from './types.js';

export interface IRuleInput {
  /** The values the launch was made from, checked when it was kept. */
  readonly inputs: TLaunchInputs;
  /** The deciding run's report as recorded: the model's own account. */
  readonly report: string;
  /** What the host's browser returned during the deciding run, and nothing from another run. */
  readonly receipts: readonly IEvidenceReceipt[];
}

export type TRuleVerdict =
  | {
      readonly satisfied: true;
      readonly reason: string;
      /** The receipts that satisfied the rule. */
      readonly evidence: readonly IEvidenceReceipt[];
    }
  | { readonly satisfied: false; readonly reason: string };

export interface IEvidenceRule {
  readonly definitionId: string;
  /** The definition revision this check was reviewed for. */
  readonly revision: number;
  check(input: IRuleInput): TRuleVerdict;
}

const unverified = (reason: string): TRuleVerdict => ({ satisfied: false, reason });

/**
 * The page-check task. The agent has one browser page that stays wherever an earlier run or chat left
 * it, so reading "the current page" proves nothing about this run: the run itself must have opened the
 * page that was named, and the browser must have landed on exactly that address (a redirect, even
 * inside the site, may have led to a login or an error page). Reads after that open, of that address,
 * are further evidence; reads before it never are. The page needs text, and the run needs a report.
 */
const PAGE_CHECK: IEvidenceRule = {
  definitionId: 'check-fact-on-page',
  revision: 1,
  check: ({ inputs, report, receipts }) => {
    const named = inputs['page'];
    const wanted = typeof named === 'string' ? pageKey(named) : undefined;
    if (wanted === undefined)
      return unverified(
        'The page address of this request could not be read, so nothing was checked.',
      );
    if (report.trim() === '' || report === EMPTY_REPORT)
      return unverified('The run finished, but it gave no report.');
    const opened = receipts.findIndex(
      (receipt) =>
        receipt.kind === 'page-read' &&
        receipt.tool === 'open' &&
        receipt.requested === wanted &&
        receipt.address === wanted,
    );
    if (opened < 0)
      return unverified(
        receipts.some((receipt) => receipt.address === wanted)
          ? 'The run finished, but it only looked at a page that was already open and never opened the page you named.'
          : 'The run finished, but nothing it read matches the page you named.',
      );
    const readable = receipts
      .slice(opened)
      .filter(
        (receipt) =>
          receipt.kind === 'page-read' && receipt.address === wanted && receipt.chars > 0,
      );
    if (readable.length === 0)
      return unverified(
        'The page you named opened, but it had no text to check the report against.',
      );
    return {
      satisfied: true,
      reason: 'Your agent’s own browser opened and read the page you named during this run.',
      evidence: readable,
    };
  },
};

/** The rules the host has reviewed. A revision not listed here has none. */
export const EVIDENCE_RULES: readonly IEvidenceRule[] = [PAGE_CHECK];

export function ruleFor(
  rules: readonly IEvidenceRule[],
  definition: { readonly id: string; readonly revision: number },
): IEvidenceRule | undefined {
  return rules.find(
    (rule) => rule.definitionId === definition.id && rule.revision === definition.revision,
  );
}
