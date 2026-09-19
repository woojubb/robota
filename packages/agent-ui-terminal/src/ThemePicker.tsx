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
function useThemePickerSelection(
  picker: IAppThemePickerViewModel,
  screenReader: boolean,
): {
  focusedIndex: number;
  toggles: IThemeToggles;
  numbered: ReturnType<typeof useNumberedSelection>;
} {
  const { themes, activeThemeId, preview, select, cancel } = picker;
  const [focusedIndex, setFocusedIndex] = React.useState(() =>
    focusedIndexOf(themes, activeThemeId),
  );
  // Pending, not applied: the toggles travel with the selection and are submitted WITH it, so
  // escape abandons them exactly as it abandons the previewed theme.
  const [toggles, setToggles] = React.useState<IThemeToggles>(() => ({
    syntaxHighlighting: picker.syntaxHighlighting,
    reducedMotion: picker.reducedMotion,
  }));
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

  useKeybindingActions(
    'theme-picker',
    (actions) => {
      for (const action of actions) {
        if (action === 'previous') move(-1);
        else if (action === 'next') move(1);
        else if (action === 'select') applyAt(focusedIndex);
        else if (action === 'toggle-syntax')
          setToggles((current) => ({
            ...current,
            syntaxHighlighting: !current.syntaxHighlighting,
          }));
        else if (action === 'toggle-motion')
          setToggles((current) => ({ ...current, reducedMotion: !current.reducedMotion }));
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

function TogglesRow({ toggles }: { toggles: IThemeToggles }): React.ReactElement {
  const on = (value: boolean): string => (value ? 'on' : 'off');
  return (
    <Text dimColor>
      {`syntax ${on(toggles.syntaxHighlighting)} · motion ${on(!toggles.reducedMotion)}`}
    </Text>
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
      <TogglesRow toggles={toggles} />
      <Box flexDirection="column" marginTop={1}>
        <ThemeRows
          themes={themes}
          activeThemeId={activeThemeId}
          focusedIndex={focusedIndex}
          screenReader={screenReader}
        />
      </Box>
      <ThemePickerFooter
        screenReader={screenReader}
        itemCount={themes.length}
        numbered={numbered}
      />
    </Box>
  );
}
