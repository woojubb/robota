import { useCallback, useMemo, useState } from 'react';

import { createThemeRegistry, formatUnknownThemeNotice } from '../theme/theme-registry.js';

import type { ITuiTheme } from '../theme/theme-contracts.js';
import type { IThemeRegistry } from '../theme/theme-registry.js';
import type {
  IAppearanceSettings,
  TReducedMotionOverride,
} from '@robota-sdk/agent-interface-command';

export interface IThemeToggles {
  readonly syntaxHighlighting: boolean;
  readonly reducedMotion: boolean;
}

export interface IAppThemePickerViewModel {
  readonly visible: boolean;
  readonly themes: readonly ITuiTheme[];
  /** The id that is PERSISTED — the row the picker returns to when it is cancelled. */
  readonly activeThemeId: string;
  /** The PERSISTED toggles the picker seeds itself from and submits alongside the theme. */
  readonly syntaxHighlighting: boolean;
  readonly reducedMotion: boolean;
  /** Set when a tier above the settings pinned motion for this run; the picker admits it. */
  readonly reducedMotionOverride?: TReducedMotionOverride | undefined;
  /** Move the highlight: the live region re-renders in that theme, nothing is written. */
  readonly preview: (id: string) => void;
  /**
   * Commit: submits `/theme <id> syntax <on|off> motion <on|off>` — ONE patch through the command
   * path, because the HOST owns writing the settings document. Three separate submissions would be
   * three chances to half-apply what the user saw as one decision.
   */
  readonly select: (id: string, toggles: IThemeToggles) => void;
  /** Leave: the preview is dropped and the persisted theme is what remains. */
  readonly cancel: () => void;
}

export interface IAppThemeViewModel {
  /** The theme every component renders with right now — the preview when one is open. */
  readonly resolved: ITuiTheme;
  /** Whether motion is suppressed for this run, after the flag/env/settings chain. */
  readonly reducedMotion: boolean;
  /** Whether fenced code blocks are highlighted. Every markdown render site reads this. */
  readonly syntaxHighlighting: boolean;
  /** Present once, when the persisted id names a theme this build does not have. */
  readonly unknownThemeNotice?: string;
  readonly picker: IAppThemePickerViewModel;
}

interface IOptions {
  readonly appearance: IAppearanceSettings;
  readonly registry?: IThemeRegistry | undefined;
  readonly reducedMotion?: boolean | undefined;
  /** Which tier decided it, when that was not the settings. */
  readonly reducedMotionOverride?: TReducedMotionOverride | undefined;
  readonly visible: boolean;
  readonly setVisible: (visible: boolean) => void;
  readonly submit: (input: string) => void;
}

/**
 * SCREEN-2002 — which theme the live region renders with, and the picker over it.
 *
 * Two inputs, one answer. The PERSISTED appearance is the baseline; a preview is a local overlay
 * that exists only while the picker is open. Selecting does not write — it submits `/theme <id>`,
 * so the host applies the patch and the refresh-on-result path re-reads it. That keeps ONE writer
 * for the settings document and means the picker cannot persist something `/theme` would refuse.
 *
 * `reducedMotion` arrives already resolved from the CLI (settings ← env ← flag). It is not
 * recomputed here, because a second place deciding the same question is how the two start
 * disagreeing — and it is still not the final say: `useMotion()` gates on the colour gate and
 * screen-reader mode above it.
 */
export function useAppThemeState(options: IOptions): IAppThemeViewModel {
  const registry = useMemo(() => options.registry ?? createThemeRegistry(), [options.registry]);
  const [previewId, setPreviewId] = useState<string | undefined>(undefined);
  const resolution = useMemo(
    () => registry.resolve(previewId ?? options.appearance.theme),
    [registry, previewId, options.appearance.theme],
  );

  const { setVisible, submit } = options;
  const cancel = useCallback((): void => {
    setPreviewId(undefined);
    setVisible(false);
  }, [setVisible]);
  const { syntaxHighlighting, reducedMotion } = options.appearance;
  const select = useCallback(
    (id: string, toggles: IThemeToggles): void => {
      setPreviewId(undefined);
      setVisible(false);
      const parts = [`/theme ${id}`];
      // Only what the user actually CHANGED. Sending all three would make choosing a theme report
      // "syntax highlighting on, motion on" as applied to someone who touched neither — and on a
      // run with a reduced-motion flag it would also drag out the pinned-for-this-run notice for a
      // setting they never asked about.
      if (toggles.syntaxHighlighting !== syntaxHighlighting) {
        parts.push(`syntax ${toggles.syntaxHighlighting ? 'on' : 'off'}`);
      }
      if (toggles.reducedMotion !== reducedMotion) {
        // `motion on` means ANIMATE, which is `reducedMotion: false` — the inversion lives in the
        // command's parser, and this is the one place that has to speak its vocabulary.
        parts.push(`motion ${toggles.reducedMotion ? 'off' : 'on'}`);
      }
      submit(parts.join(' '));
    },
    [reducedMotion, setVisible, submit, syntaxHighlighting],
  );

  // A preview of an unknown id is impossible (the rows come from the registry), so the notice can
  // only be about what is PERSISTED — and it is suppressed while previewing so it does not read as
  // a complaint about the row the user is looking at.
  const unknownId = previewId === undefined ? resolution.unknownId : undefined;
  return {
    resolved: resolution.theme,
    reducedMotion: options.reducedMotion ?? options.appearance.reducedMotion,
    syntaxHighlighting: options.appearance.syntaxHighlighting,
    ...(unknownId === undefined ? {} : { unknownThemeNotice: formatUnknownThemeNotice(unknownId) }),
    picker: {
      visible: options.visible,
      themes: registry.list(),
      activeThemeId: options.appearance.theme,
      syntaxHighlighting: options.appearance.syntaxHighlighting,
      reducedMotion: options.appearance.reducedMotion,
      ...(options.reducedMotionOverride === undefined
        ? {}
        : { reducedMotionOverride: options.reducedMotionOverride }),
      preview: setPreviewId,
      select,
      cancel,
    },
  };
}
