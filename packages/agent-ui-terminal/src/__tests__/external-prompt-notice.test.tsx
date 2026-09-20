/**
 * FLOW-2006 TC-05 — the provenance notice and the consumed-once prefill.
 *
 * The notice is what keeps a prompt the user never typed from reading like one they did, and the
 * consumed-once rule is why a handoff remount cannot re-seed a prompt they already cleared.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ExternalPromptNotice, {
  externalPromptNotice,
  EXTERNAL_PROMPT_NOTICE,
  EXTERNAL_PROMPT_REVIEW_THRESHOLD,
} from '../external-prompt-notice.js';

const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('externalPromptNotice', () => {
  it('labels a prompt, escalates a long one, and says nothing about an empty composer', () => {
    expect(externalPromptNotice('hi')).toBe(EXTERNAL_PROMPT_NOTICE);
    expect(externalPromptNotice('')).toBeUndefined();
    const long = 'x'.repeat(EXTERNAL_PROMPT_REVIEW_THRESHOLD + 1);
    const escalated = externalPromptNotice(long) ?? '';
    expect(escalated).toContain(EXTERNAL_PROMPT_NOTICE);
    expect(escalated).toContain(String(long.length));
    expect(escalated).toContain('review');
    // Exactly at the threshold is still the plain label.
    expect(externalPromptNotice('x'.repeat(EXTERNAL_PROMPT_REVIEW_THRESHOLD))).toBe(
      EXTERNAL_PROMPT_NOTICE,
    );
  });
});

describe('ExternalPromptNotice', () => {
  it('renders the line while the prompt is there and nothing once it is gone', () => {
    const withPrompt = render(<ExternalPromptNotice value="from a link" />);
    expect(withPrompt.lastFrame()).toContain(EXTERNAL_PROMPT_NOTICE);
    const cleared = render(<ExternalPromptNotice value="" />);
    expect(cleared.lastFrame() ?? '').not.toContain(EXTERNAL_PROMPT_NOTICE);
  });
});

/**
 * The consumed-once contract, exercised on the shape the controller and the composer agree on: the
 * composer seeds from `initialValue` and reports back, and the controller then stops offering it.
 */
describe('the prefill is consumed once', () => {
  function Composer({
    initialValue,
    consumeInitialValue,
  }: {
    initialValue?: string | undefined;
    consumeInitialValue?: (() => void) | undefined;
  }): React.ReactElement {
    const [value] = React.useState(initialValue ?? '');
    React.useEffect(() => {
      if (initialValue === undefined || initialValue.length === 0) return;
      consumeInitialValue?.();
    }, [initialValue, consumeInitialValue]);
    return <ExternalPromptNotice value={value} />;
  }

  it('seeds the composer and tells the controller, which does not offer it again', async () => {
    const consume = vi.fn();
    const first = render(<Composer initialValue="from a link" consumeInitialValue={consume} />);
    await delay();
    expect(first.lastFrame()).toContain(EXTERNAL_PROMPT_NOTICE);
    expect(consume).toHaveBeenCalledTimes(1);

    // The handoff remount: the controller has dropped the value, so nothing is re-seeded.
    const remounted = render(<Composer initialValue={undefined} consumeInitialValue={consume} />);
    await delay();
    expect(remounted.lastFrame() ?? '').not.toContain(EXTERNAL_PROMPT_NOTICE);
    expect(consume).toHaveBeenCalledTimes(1);
  });
});
