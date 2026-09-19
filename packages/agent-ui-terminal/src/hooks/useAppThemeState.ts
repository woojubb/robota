import { useCallback, useMemo, useState } from 'react';

import { createThemeRegistry, formatUnknownThemeNotice } from '../theme/theme-registry.js';

import type { ITuiTheme } from '../theme/theme-contracts.js';
import type { IThemeRegistry } from '../theme/theme-registry.js';
import type { IAppearanceSettings } from '@robota-sdk/agent-interface-command';

export interface IAppThemePickerViewModel {
  readonly visible: boolean;
  readonly themes: readonly ITuiTheme[];
  /** The id that is PERSISTED — the row the picker returns to when it is cancelled. */
  readonly activeThemeId: string;
  /** Move the highlight: the live region re-renders in that theme, nothing is written. */
  readonly preview: (id: string) => void;
  /** Commit: submits `/theme <id>`, because the HOST owns writing the settings document. */
  readonly select: (id: string) => void;
  /** Leave: the preview is dropped and the persisted theme is what remains. */
  readonly cancel: () => void;
}

export interface IAppThemeViewModel {
  /** The theme every component renders with right now — the preview when one is open. */
  readonly resolved: ITuiTheme;
  /** Whether motion is suppressed for this run, after the flag/env/settings chain. */
  readonly reducedMotion: boolean;
  /** Present once, when the persisted id names a theme this build does not have. */
  readonly unknownThemeNotice?: string;
  readonly picker: IAppThemePickerViewModel;
}

interface IOptions {
  readonly appearance: IAppearanceSettings;
  readonly registry?: IThemeRegistry | undefined;
  readonly reducedMotion?: boolean | undefined;
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
  const select = useCallback(
    (id: string): void => {
      setPreviewId(undefined);
      setVisible(false);
      submit(`/theme ${id}`);
    },
    [setVisible, submit],
  );

  // A preview of an unknown id is impossible (the rows come from the registry), so the notice can
  // only be about what is PERSISTED — and it is suppressed while previewing so it does not read as
  // a complaint about the row the user is looking at.
  const unknownId = previewId === undefined ? resolution.unknownId : undefined;
  return {
    resolved: resolution.theme,
    reducedMotion: options.reducedMotion ?? options.appearance.reducedMotion,
    ...(unknownId === undefined ? {} : { unknownThemeNotice: formatUnknownThemeNotice(unknownId) }),
    picker: {
      visible: options.visible,
      themes: registry.list(),
      activeThemeId: options.appearance.theme,
      preview: setPreviewId,
      select,
      cancel,
    },
  };
}
