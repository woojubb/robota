/**
 * Shared semantic color palette + motion tokens for Ink-rendered components (SCREEN-006).
 *
 * The Ink-side counterpart of `tui-ansi-palette.ts` — same mechanism (plain exported
 * `const` token maps), different encoding and consumer: this module holds Ink/chalk color
 * NAMES (plus hex for the wave ramp) consumed via JSX `color`/`borderColor` props, while
 * `tui-ansi-palette.ts` holds raw SGR escapes for the `marked-terminal` markdown pipeline.
 * `status-glyph.ts` remains the status symbol+color SSOT and sources its colors from
 * `PALETTE.status` (one-way dependency: status-glyph → tui-palette).
 *
 * Rules (docs/SPEC.md "Color & Motion Contract (SCREEN-006)"):
 * - Components never spell color names or hex inline — they consume these tokens
 *   (enforced by `__tests__/palette-consistency.test.ts`).
 * - Token names are semantic slots (accent/muted/attention), never product vocabulary.
 * - The canonical muted/de-emphasis treatment is Ink's `dimColor`; `PALETTE.text.muted`
 *   exists only where an actual color VALUE is required.
 * - No theming framework, no runtime switching, no config surface — values are today's
 *   colors, consolidated. Color/motion degradation stays owned by Ink +
 *   `terminal-capabilities.ts` (no new fallback branch here).
 */

/** Semantic color tokens for Ink components. Values are Ink/chalk color names. */
export const PALETTE = {
  /** Foreground text roles. */
  text: {
    /** Section labels, assistant name, focused option. */
    accent: 'cyan',
    /** Bold labels (e.g. "Tool:"). */
    emphasis: 'white',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    /** Session name in the status bar. */
    session: 'magenta',
    /** Muted foreground where a color VALUE is required; otherwise use `dimColor`. */
    muted: 'gray',
    /** Contrast foreground rendered on top of a token-colored background chip. */
    onAccent: 'black',
  },
  /** Box border roles. */
  border: {
    /** Prompts that demand a response. */
    attention: 'yellow',
    focused: 'cyan',
    active: 'green',
    muted: 'gray',
    error: 'red',
  },
  /** Status colors — consumed by `STATUS_GLYPH` (the status SSOT). */
  status: {
    running: 'yellow',
    success: 'green',
    error: 'red',
    denied: 'yellowBright',
    waiting: 'yellow',
    cancelled: 'yellow',
    idle: 'gray',
  },
} as const;

/**
 * Motion tokens — the WaveText animation is the package's one animation; its ramp and
 * cadence live here so motion is visible to palette audits. The ramp spans #555→#bbb
 * (SCREEN-006: perceptible contrast span at a calm 400ms cadence — perceptibility comes
 * from the wider ramp, not faster flicker).
 */
export const MOTION = {
  waveColors: ['#555555', '#777777', '#999999', '#bbbbbb'],
  waveIntervalMs: 400,
  waveCharsPerGroup: 4,
} as const;
