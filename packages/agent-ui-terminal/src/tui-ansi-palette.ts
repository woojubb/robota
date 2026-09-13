/**
 * Raw ANSI SGR escape codes for terminal markdown rendering.
 *
 * `marked-terminal` consumes raw escape sequences (not Ink/chalk color names),
 * so these live here as the single source for the markdown renderer instead of
 * being scattered as inline string literals (SCREEN-006). Ink-rendered
 * components use named colors via `status-glyph.ts` — a separate color system.
 */
const ESC = String.fromCharCode(27);

export const ANSI = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  cyan: `${ESC}[36m`,
  lightRed: `${ESC}[38;5;210m`,
  lightGreen: `${ESC}[38;5;120m`,
  darkRedBackground: `${ESC}[48;5;52m`,
  darkGreenBackground: `${ESC}[48;5;22m`,
} as const;
