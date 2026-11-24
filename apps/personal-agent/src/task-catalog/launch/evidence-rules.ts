/**
 * What counts as proof that a launched task did its work, one host-implemented rule for each
 * definition revision. A definition describes its success check in words for the person; the words
 * decide nothing. A rule is code the host reviewed with the revision, and it can only be satisfied by
 * receipts the host recorded from its own browser during this launch's run: a model's report, text
 * on a page, and anything a person typed are never read as evidence. A revision with no rule here
 * cannot be called verified, however well its run went.
 */
import { EMPTY_REPORT } from '../../run-report.js';
import { pageKey, sameOrigin } from './receipts.js';

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
 * A read counts for the page that was named when the page was at that address, or when the run asked
 * for that address and the browser reported a page of the same site (a redirect inside the site). A
 * page on another site does not count, whatever the address asked for.
 */
const readsPage = (receipt: IEvidenceReceipt, wanted: string): boolean =>
  receipt.address === wanted ||
  (receipt.requested === wanted && sameOrigin(receipt.address, wanted));

/** The page-check task: the page the person named was read, it had text, and the run reported. */
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
    const matching = receipts.filter(
      (receipt) => receipt.kind === 'page-read' && readsPage(receipt, wanted),
    );
    if (matching.length === 0)
      return unverified('The run finished, but nothing it read matches the page you named.');
    const readable = matching.filter((receipt) => receipt.chars > 0);
    if (readable.length === 0)
      return unverified(
        'The page you named opened, but it had no text to check the report against.',
      );
    return {
      satisfied: true,
      reason: 'Your agent’s own browser read the page you named during this run.',
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
