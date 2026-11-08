/**
 * SCREEN-2002 — the theme picker.
 *
 * Preview-on-move: the highlighted row IS the live region's theme while the picker is open, because
 * a colour scheme cannot be judged from a swatch beside the thing it does not apply to. Escape
 * restores what was persisted; selecting submits `/theme <id>` so the HOST writes the settings
 * document and the picker never becomes a second writer.
 *
 * The transcript above the picker keeps the theme it was written in — Ink's `<Static>` emits an
 * entry once — so a preview moves the input frame, the status bar and this overlay. That is the
 * region a reader is looking at while choosing, and it is the property that makes a preview honest
 * rather than partial.
 */
import { Box } from 'ink';
import React from 'react';

import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import { KeyHintFooter, SELECTION_INDICATOR, SELECTION_INDICATOR_NONE } from './key-hint-footer.js';
import { useKeybindingActions, useKeybindingHints } from './keybindings/keybindings-context.js';
import { formatNumberedSelectionPrompt, numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { isInteractiveColorTerminal } from './terminal-capabilities.js';
import { usePalette } from './theme/index.js';

import type { IAppThemePickerViewModel, IThemeToggles } from './hooks/useAppThemeState.js';
import type { ITuiTheme } from './theme/index.js';
import type { IThemeSkip } from './theme/theme-registry.js';

function describeTheme(theme: ITuiTheme, isActive: boolean): string {
  const active = isActive ? ' (current)' : '';
  return `${theme.name} — ${theme.appearance}, ${theme.source}${active}`;
}

function ThemeRow({
  theme,
  isFocused,
  isActive,
  rowNumber,
}: {
  theme: ITuiTheme;
  isFocused: boolean;
  isActive: boolean;
  rowNumber?: number | undefined;
}): React.ReactElement {
  const palette = usePalette();
  const marker =
    rowNumber !== undefined
      ? numberedRowPrefix(rowNumber)
      : isFocused
        ? SELECTION_INDICATOR
        : SELECTION_INDICATOR_NONE;
  return (
    <Text
      {...(isFocused && rowNumber === undefined ? { color: palette.text.accent, bold: true } : {})}
    >
      {marker}
      {describeTheme(theme, isActive)}
    </Text>
  );
}

/** The typed-selection prompt, re-printed verbatim after an out-of-range answer. */
function ScreenReaderThemePrompt({
  itemCount,
  buffer,
  invalid,
}: {
  itemCount: number;
  buffer: string;
  invalid: boolean;
}): React.ReactElement {
  const prompt = formatNumberedSelectionPrompt(itemCount, true);
  return (
    <Box flexDirection="column">
      <Text>
        {prompt}
        {buffer.length > 0 ? ` ${buffer}` : ''}
      </Text>
      {invalid && <Text>{prompt}</Text>}
    </Box>
  );
}

function focusedIndexOf(themes: readonly ITuiTheme[], activeThemeId: string): number {
  const index = themes.findIndex((theme) => theme.id === activeThemeId);
  return index < 0 ? 0 : index;
}

/**
 * Navigation PREVIEWS and only `select` applies, so the highlight and the live region move together
 * without anything being written until the user says so.
 */
/**
 * Pending, not applied: the toggles travel with the selection and are submitted WITH it, so escape
 * abandons them exactly as it abandons the previewed theme. Applying them live would make escape
 * mean two different things for two controls in the same overlay.
 */
function usePendingToggles(picker: IAppThemePickerViewModel): {
  toggles: IThemeToggles;
  setToggles: React.Dispatch<React.SetStateAction<IThemeToggles>>;
} {
  const [toggles, setToggles] = React.useState<IThemeToggles>(() => ({
    syntaxHighlighting: picker.syntaxHighlighting,
    reducedMotion: picker.reducedMotion,
  }));
  return { toggles, setToggles };
}

/**
 * The highlight, and the preview that follows it. Moving WRAPS at both ends rather than stopping —
 * four themes is a short list, and a dead end at the bottom reads as a broken key.
 */
function useFocusedRow(picker: IAppThemePickerViewModel): {
  focusedIndex: number;
  move: (delta: number) => void;
} {
  const { themes, activeThemeId, preview } = picker;
  const [focusedIndex, setFocusedIndex] = React.useState(() =>
    focusedIndexOf(themes, activeThemeId),
  );
  const move = React.useCallback(
    (delta: number): void => {
      if (themes.length === 0) return;
      setFocusedIndex((current) => {
        const next = (current + delta + themes.length) % themes.length;
        const theme = themes[next];
        if (theme) preview(theme.id);
        return next;
      });
    },
    [preview, themes],
  );
  return { focusedIndex, move };
}

function useThemePickerSelection(
  picker: IAppThemePickerViewModel,
  screenReader: boolean,
): {
  focusedIndex: number;
  toggles: IThemeToggles;
  numbered: ReturnType<typeof useNumberedSelection>;
} {
  const { themes, select, cancel } = picker;
  const { focusedIndex, move } = useFocusedRow(picker);
  const { toggles, setToggles } = usePendingToggles(picker);
  const togglesRef = React.useRef(toggles);
  togglesRef.current = toggles;
  const applyAt = React.useCallback(
    (index: number): void => {
      const theme = themes[index];
      if (theme) select(theme.id, togglesRef.current);
    },
    [select, themes],
  );

  // CLI-2004: an arrow-key menu gets numbers and a typed answer in the mode. It applies on SELECT
  // rather than on navigation — there is no highlight to hear, so a preview per keystroke would
  // just be repaints a reader has to sit through.
  const numbered = useNumberedSelection({
    enabled: screenReader && themes.length > 0,
    itemCount: themes.length,
    cancellable: true,
    onSelect: applyAt,
    onCancel: cancel,
  });

  const toggle = React.useCallback(
    (key: keyof IThemeToggles): void => {
      setToggles((current) => ({ ...current, [key]: !current[key] }));
    },
    [setToggles],
  );

  useKeybindingActions(
    'theme-picker',
    (actions) => {
      for (const action of actions) {
        if (action === 'previous') move(-1);
        else if (action === 'next') move(1);
        else if (action === 'select') applyAt(focusedIndex);
        else if (action === 'toggle-syntax') toggle('syntaxHighlighting');
        else if (action === 'toggle-motion') toggle('reducedMotion');
        else if (action === 'cancel') cancel();
      }
    },
    { isActive: !screenReader },
  );
  return { focusedIndex, toggles, numbered };
}

function ThemeRows({
  themes,
  activeThemeId,
  focusedIndex,
  screenReader,
}: {
  themes: readonly ITuiTheme[];
  activeThemeId: string;
  focusedIndex: number;
  screenReader: boolean;
}): React.ReactElement {
  if (themes.length === 0) return <Text dimColor>No themes installed</Text>;
  return (
    <>
      {themes.map((theme, index) => (
        <ThemeRow
          key={theme.id}
          theme={theme}
          isFocused={index === focusedIndex}
          isActive={theme.id === activeThemeId}
          {...(screenReader ? { rowNumber: index } : {})}
        />
      ))}
    </>
  );
}

/**
 * Under the colour gate a preview shows nothing, so the picker says so in words rather than letting
 * the user conclude the highlight is broken. The gate is the degradation rule this package has
 * always had; this is the one place that has to ADMIT it.
 */
function ColourGateNotice(): React.ReactElement {
  if (isInteractiveColorTerminal()) return <></>;
  return (
    <Text dimColor>Colour is off for this terminal — themes apply, previews cannot show.</Text>
  );
}

/**
 * The theme files this run found and refused. They are shown, never offered: a row a user cannot
 * pick is still the only place that says why the theme they wrote is not in the list — without it
 * the file just silently is not there, and the startup line has long since scrolled away.
 */
function SkippedRows({ skipped }: { skipped: readonly IThemeSkip[] }): React.ReactElement {
  if (skipped.length === 0) return <></>;
  return (
    <Box flexDirection="column" marginTop={1}>
      {/*
        Keyed by POSITION, not by id. `IThemeSkip.id` is a LABEL and its contract says so: a
        scope-level failure carries one id for a whole scope, and two scopes can both fail, so two
        rows can share it. A duplicate React key would put a warning on stderr from inside the live
        frame, corrupting the frame it is complaining about.

        Recorded limit: no test pins this. Rendering two same-id rows under ink-testing-library
        produced both rows and no warning on `console.error`, so a test asserting the warning's
        ABSENCE is green either way — an unfalsifiable guard, which is worse than none. The reason
        is written here instead of measured.
      */}
      {skipped.map((skip, index) => (
        <Text key={index} dimColor>
          {`${SELECTION_INDICATOR_NONE}Skipped "${skip.fileName}" — ${skip.reason}`}
        </Text>
      ))}
    </Box>
  );
}

function TogglesRow({
  toggles,
  reducedMotionPin,
  screenReader,
}: {
  toggles: IThemeToggles;
  reducedMotionPin?: IAppThemePickerViewModel['reducedMotionPin'];
  screenReader: boolean;
}): React.ReactElement {
  const on = (value: boolean): string => (value ? 'on' : 'off');
  // The pin is admitted here as it is by `/theme list` and `/theme motion` — and it names what THIS
  // RUN does, not only who decided it. The tier alone is not enough: `--no-reduced-motion` is an
  // override too and pins the opposite value, so a row carrying the chosen value beside the tier
  // can read `motion on (pinned by flag)` on a visibly still run.
  const pinned =
    reducedMotionPin === undefined
      ? ''
      : ` (this run: motion ${on(!reducedMotionPin.reducedMotion)}, pinned by ${reducedMotionPin.tier})`;
  return (
    <Box flexDirection="column">
      <Text dimColor>
        {`syntax ${on(toggles.syntaxHighlighting)} · motion ${on(!toggles.reducedMotion)}${pinned}`}
      </Text>
      {/*
        The mode takes a typed answer, so `s` and `m` are not bound in it — but the state above is
        still worth reading before choosing. So the state stays and the AFFORDANCE changes: this
        names a route the mode can actually take, instead of leaving two keys silently inert.
      */}
      {screenReader && (
        <Text dimColor>Change with /theme syntax on|off or /theme motion on|off</Text>
      )}
    </Box>
  );
}

function ThemePickerFooter({
  screenReader,
  itemCount,
  numbered,
}: {
  screenReader: boolean;
  itemCount: number;
  numbered: ReturnType<typeof useNumberedSelection>;
}): React.ReactElement {
  // Footer order: navigate → primary → dismiss, the same as every other picker in this package.
  const footerHints = useKeybindingHints('theme-picker', [
    [['previous', 'next'], 'Preview'],
    ['select', 'Apply'],
    ['toggle-syntax', 'Syntax'],
    ['toggle-motion', 'Motion'],
    ['cancel', 'Cancel'],
  ]);
  if (!screenReader) return <KeyHintFooter hints={footerHints} />;
  return (
    <ScreenReaderThemePrompt
      itemCount={itemCount}
      buffer={numbered.buffer}
      invalid={numbered.invalid}
    />
  );
}

export default function ThemePicker({
  picker,
}: {
  picker: IAppThemePickerViewModel;
}): React.ReactElement {
  const palette = usePalette();
  const screenReader = useScreenReader();
  const { themes, activeThemeId } = picker;
  const { focusedIndex, toggles, numbered } = useThemePickerSelection(picker, screenReader);

  return (
    <Box
      flexDirection="column"
      {...(screenReader
        ? {}
        : { borderStyle: 'round' as const, borderColor: palette.border.focused })}
      paddingX={1}
    >
      <Text color={palette.text.accent} bold>
        Theme
      </Text>
      <ColourGateNotice />
      <TogglesRow
        toggles={toggles}
        reducedMotionPin={picker.reducedMotionPin}
        screenReader={screenReader}
      />
      <Box flexDirection="column" marginTop={1}>
        <ThemeRows
          themes={themes}
          activeThemeId={activeThemeId}
          focusedIndex={focusedIndex}
          screenReader={screenReader}
        />
      </Box>
      <SkippedRows skipped={picker.skipped} />
      <ThemePickerFooter
        screenReader={screenReader}
        itemCount={themes.length}
        numbered={numbered}
      />
    </Box>
  );
}
