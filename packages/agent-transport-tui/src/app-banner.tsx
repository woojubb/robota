/**
 * The startup banner, committed once to the terminal scrollback.
 *
 * Extracted from `App.tsx` under CLI-2004: the art is ASCII, not box-drawing, so a
 * no-box-drawing sweep passes over it unchanged — it needs its own suppression AND its own
 * assertion, and neither is reviewable while the glyphs live inline in a 600-line component.
 * `BANNER_GLYPHS` is the set a test asserts is absent in screen-reader mode.
 */

import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { PALETTE } from './tui-palette.js';

/** The ASCII art itself. */
export const BANNER_ART = `
  ____   ___  ____   ___ _____  _
 |  _ \\ / _ \\| __ ) / _ \\_   _|/ \\
 | |_) | | | |  _ \\| | | || | / _ \\
 |  _ <| |_| | |_) | |_| || |/ ___ \\
 |_| \\_\\\\___/|____/ \\___/ |_/_/   \\_\\
`;

/**
 * The characters the art is drawn from. None is a box-drawing character, which is exactly why the
 * banner needs a suppression test of its own.
 */
export const BANNER_GLYPHS: readonly string[] = ['_', '|', '\\', '/', '<'];

/** The banner as it is committed to scrollback: the art plus the version line. */
export function AppBanner({ version }: { version: string }): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color={PALETTE.text.accent} bold>
        {BANNER_ART}
      </Text>
      <Text dimColor> v{version}</Text>
    </Box>
  );
}
