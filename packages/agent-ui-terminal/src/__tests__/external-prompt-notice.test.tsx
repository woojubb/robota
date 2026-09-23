/**
 * FLOW-2006 TC-05 — the provenance notice and the consumed-once prefill.
 *
 * The notice is what keeps a prompt the user never typed from reading like one they did, and the
 * consumed-once rule is why a handoff remount cannot re-seed a prompt they already cleared.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';
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
 * The consumed-once contract and the provenance lifetime, driven through the REAL composer.
 *
 * A hand-copied stand-in would keep passing if `InputArea`'s own seeding changed — which is the one
 * thing these assertions exist to catch — so every case below mounts the shipped component.
 */
describe('the prefill is consumed once, and the label belongs to that text', () => {
  it('seeds the composer, tells the controller, and drops the label once the text changes', async () => {
    const consume = vi.fn();
    const { lastFrame, stdin } = render(
      <InputArea
        onSubmit={vi.fn()}
        isDisabled={false}
        initialValue="from a link"
        consumeInitialValue={consume}
        externalPromptOrigin
      />,
    );
    await delay();
    expect(lastFrame()).toContain('from a link');
    expect(lastFrame()).toContain(EXTERNAL_PROMPT_NOTICE);
    expect(consume).toHaveBeenCalledTimes(1);

    // The user edits: what is in the composer is no longer what the link supplied, so the
    // provenance line goes with it. A label that outlived the text would mark the user's own words.
    stdin.write('!');
    await delay();
    expect(lastFrame()).toContain('from a link!');
    expect(lastFrame() ?? '').not.toContain(EXTERNAL_PROMPT_NOTICE);
  });

  it('does not re-seed on the handoff remount, after the controller dropped the value', async () => {
    const consume = vi.fn();
    const remounted = render(
      <InputArea
        onSubmit={vi.fn()}
        isDisabled={false}
        initialValue={undefined}
        consumeInitialValue={consume}
        externalPromptOrigin
      />,
    );
    await delay();
    expect(remounted.lastFrame() ?? '').not.toContain(EXTERNAL_PROMPT_NOTICE);
    expect(consume).not.toHaveBeenCalled();
  });

  it('never labels a prompt the user typed themselves', async () => {
    const { lastFrame, stdin } = render(<InputArea onSubmit={vi.fn()} isDisabled={false} />);
    await delay();
    stdin.write('my own prompt');
    await delay();
    expect(lastFrame()).toContain('my own prompt');
    expect(lastFrame() ?? '').not.toContain(EXTERNAL_PROMPT_NOTICE);
  });
});
