/**
 * SCREEN-2002 TC-10 — what the picker submits.
 *
 * The picker does not write. It submits a `/theme` line, so the HOST stays the only writer of the
 * settings document. What it submits therefore matters: sending all three keys every time would
 * report "syntax highlighting on, motion on" as APPLIED to a user who touched neither, and on a run
 * with a reduced-motion flag it would drag out the pinned-for-this-run notice for a setting they
 * never asked about.
 */
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useAppThemeState } from '../useAppThemeState.js';

import type { IThemeToggles } from '../useAppThemeState.js';
import type { IAppearanceSettings } from '@robota-sdk/agent-interface-command';

const PERSISTED: IAppearanceSettings = {
  theme: 'dark',
  syntaxHighlighting: true,
  reducedMotion: false,
};

/** Drive the hook and capture what `select` submits. */
function submissionOf(toggles: IThemeToggles, appearance: IAppearanceSettings = PERSISTED): string {
  const submit = vi.fn();
  function Harness(): React.ReactElement {
    const theme = useAppThemeState({
      appearance,
      visible: true,
      setVisible: vi.fn(),
      submit,
    });
    // One shot: a ref rather than an empty dependency array, so the intent is in the code instead
    // of in a lint suppression for a rule this repo does not configure.
    const fired = React.useRef(false);
    React.useEffect(() => {
      if (fired.current) return;
      fired.current = true;
      theme.picker.select('light', toggles);
    });
    return <></>;
  }
  render(<Harness />);
  expect(submit).toHaveBeenCalledTimes(1);
  return submit.mock.calls[0]?.[0] as string;
}

describe('what the picker submits (SCREEN-2002 TC-10)', () => {
  it('sends the theme ALONE when neither toggle was touched', () => {
    expect(submissionOf({ syntaxHighlighting: true, reducedMotion: false })).toBe('/theme light');
  });

  it('adds only the toggle that changed', () => {
    expect(submissionOf({ syntaxHighlighting: false, reducedMotion: false })).toBe(
      '/theme light syntax off',
    );
    expect(submissionOf({ syntaxHighlighting: true, reducedMotion: true })).toBe(
      '/theme light motion off',
    );
  });

  it('sends both when both changed, as ONE line — one patch, not three', () => {
    expect(submissionOf({ syntaxHighlighting: false, reducedMotion: true })).toBe(
      '/theme light syntax off motion off',
    );
  });

  it('speaks the command s vocabulary: `motion on` means reducedMotion FALSE', () => {
    const stillByDefault = { ...PERSISTED, reducedMotion: true };

    expect(submissionOf({ syntaxHighlighting: true, reducedMotion: false }, stillByDefault)).toBe(
      '/theme light motion on',
    );
  });
});
