/**
 * SCREEN-2002 — the four built-in themes, as data.
 *
 * `dark` is today's colour, gathered from the four places that used to decide it: `PALETTE`/`MOTION`
 * (Ink), `ANSI` (the markdown diff rows), `marked-terminal`'s own chalk defaults and `cli-highlight`'s
 * `DEFAULT_THEME`. Making those defaults explicit is what lets a theme change them at all; it is also
 * why a user who sets nothing sees the same colours as before.
 *
 * Over the 300-line file ceiling, deliberately. The file is ONE concern — four colour tables of the
 * same shape — and the ceiling exists to break up files that do several things. Splitting per theme
 * would put the dark and light values that must correspond in different files, which is the drift
 * the token model was built to stop.
 *
 * The daltonized pair is specified in hex rather than colour names on purpose: a name is whatever the
 * terminal says it is, so a colour-vision-deficiency simulation cannot compute it, and the guard
 * REFUSES what it cannot simulate. Their status and diff pairs avoid red/green entirely — blue for
 * "good", orange for "bad" — the distinction protanopes and deuteranopes retain.
 *
 * This module is the only file in the package allowed to hold a colour VALUE; the consistency test
 * ratchets on both that import and on direct `chalk.<colour>(` calls elsewhere.
 */
import type { ITuiTheme } from './theme-contracts.js';

/** Today's values, name for name. */
export const DARK_THEME: ITuiTheme = {
  id: 'dark',
  name: 'Dark',
  appearance: 'dark',
  source: 'built-in',
  colors: {
    text: {
      accent: 'cyan',
      emphasis: 'white',
      success: 'green',
      warning: 'yellow',
      error: 'red',
      session: 'magenta',
      muted: 'gray',
      onAccent: 'black',
    },
    border: {
      attention: 'yellow',
      focused: 'cyan',
      active: 'green',
      muted: 'gray',
      error: 'red',
    },
    status: {
      running: 'yellow',
      success: 'green',
      error: 'red',
      denied: 'yellowBright',
      waiting: 'yellow',
      cancelled: 'yellow',
      idle: 'gray',
    },
  },
  // marked-terminal's own defaults, written down so a theme can change them.
  markdown: {
    heading: 'green',
    firstHeading: 'magenta',
    code: 'yellow',
    codespan: 'yellow',
    link: 'blue',
    href: 'blue',
    blockquote: 'gray',
    del: 'gray',
    html: 'gray',
    // The former `ANSI.lightGreen` / `lightRed` / `darkGreenBackground` / `darkRedBackground`.
    diffAdded: 'ansi256(120)',
    diffRemoved: 'ansi256(210)',
    diffAddedBackground: 'ansi256(22)',
    diffRemovedBackground: 'ansi256(52)',
    diffHunk: 'cyan',
  },
  // cli-highlight's DEFAULT_THEME, written down for the same reason.
  syntax: {
    keyword: 'blue',
    built_in: 'cyan',
    type: 'cyan',
    literal: 'blue',
    number: 'green',
    regexp: 'red',
    string: 'red',
    class: 'blue',
    function: 'yellow',
    comment: 'green',
    doctag: 'green',
    meta: 'gray',
    tag: 'gray',
    name: 'blue',
    attr: 'cyan',
    addition: 'green',
    deletion: 'red',
  },
  motion: { wave: ['#555555', '#777777', '#999999', '#bbbbbb'] },
};

/** The same roles against a light background: darker foregrounds, light diff backgrounds. */
export const LIGHT_THEME: ITuiTheme = {
  id: 'light',
  name: 'Light',
  appearance: 'light',
  source: 'built-in',
  colors: {
    text: {
      accent: 'ansi256(24)',
      emphasis: 'black',
      success: 'ansi256(28)',
      warning: 'ansi256(130)',
      error: 'ansi256(124)',
      session: 'ansi256(90)',
      muted: 'ansi256(243)',
      onAccent: 'white',
    },
    border: {
      attention: 'ansi256(130)',
      focused: 'ansi256(24)',
      active: 'ansi256(28)',
      muted: 'ansi256(249)',
      error: 'ansi256(124)',
    },
    status: {
      running: 'ansi256(130)',
      success: 'ansi256(28)',
      error: 'ansi256(124)',
      denied: 'ansi256(166)',
      waiting: 'ansi256(130)',
      cancelled: 'ansi256(130)',
      idle: 'ansi256(243)',
    },
  },
  markdown: {
    heading: 'ansi256(28)',
    firstHeading: 'ansi256(90)',
    code: 'ansi256(94)',
    codespan: 'ansi256(94)',
    link: 'ansi256(26)',
    href: 'ansi256(26)',
    blockquote: 'ansi256(243)',
    del: 'ansi256(243)',
    html: 'ansi256(243)',
    diffAdded: 'ansi256(22)',
    diffRemoved: 'ansi256(52)',
    diffAddedBackground: 'ansi256(194)',
    diffRemovedBackground: 'ansi256(224)',
    diffHunk: 'ansi256(24)',
  },
  syntax: {
    keyword: 'ansi256(26)',
    built_in: 'ansi256(24)',
    type: 'ansi256(24)',
    literal: 'ansi256(26)',
    number: 'ansi256(28)',
    regexp: 'ansi256(124)',
    string: 'ansi256(124)',
    class: 'ansi256(26)',
    function: 'ansi256(94)',
    comment: 'ansi256(28)',
    doctag: 'ansi256(28)',
    meta: 'ansi256(243)',
    tag: 'ansi256(243)',
    name: 'ansi256(26)',
    attr: 'ansi256(24)',
    addition: 'ansi256(22)',
    deletion: 'ansi256(52)',
  },
  motion: { wave: ['#bbbbbb', '#999999', '#777777', '#555555'] },
};

/** Blue "good" / orange "bad": the pair protanopes and deuteranopes keep apart. */
export const DARK_DALTONIZED_THEME: ITuiTheme = {
  id: 'dark-daltonized',
  name: 'Dark (daltonized)',
  appearance: 'dark',
  source: 'built-in',
  colors: {
    text: {
      accent: '#56b4e9',
      emphasis: '#ffffff',
      success: '#56b4e9',
      warning: '#e69f00',
      error: '#d55e00',
      session: '#cc79a7',
      muted: '#999999',
      onAccent: '#000000',
    },
    border: {
      attention: '#e69f00',
      focused: '#56b4e9',
      active: '#56b4e9',
      muted: '#999999',
      error: '#d55e00',
    },
    status: {
      running: '#e69f00',
      success: '#56b4e9',
      error: '#d55e00',
      denied: '#f0e442',
      waiting: '#e69f00',
      cancelled: '#cc79a7',
      idle: '#999999',
    },
  },
  markdown: {
    heading: '#56b4e9',
    firstHeading: '#cc79a7',
    code: '#e69f00',
    codespan: '#e69f00',
    link: '#56b4e9',
    href: '#56b4e9',
    blockquote: '#999999',
    del: '#999999',
    html: '#999999',
    diffAdded: '#8ecdf5',
    diffRemoved: '#ffb066',
    diffAddedBackground: '#00335c',
    diffRemovedBackground: '#5c3000',
    diffHunk: '#56b4e9',
  },
  syntax: {
    keyword: '#56b4e9',
    built_in: '#8ecdf5',
    type: '#8ecdf5',
    literal: '#56b4e9',
    number: '#e69f00',
    regexp: '#d55e00',
    string: '#d55e00',
    class: '#56b4e9',
    function: '#f0e442',
    comment: '#999999',
    doctag: '#999999',
    meta: '#999999',
    tag: '#999999',
    name: '#56b4e9',
    attr: '#8ecdf5',
    addition: '#8ecdf5',
    deletion: '#ffb066',
  },
  motion: { wave: ['#3d3d3d', '#5c5c5c', '#7a7a7a', '#999999'] },
};

export const LIGHT_DALTONIZED_THEME: ITuiTheme = {
  id: 'light-daltonized',
  name: 'Light (daltonized)',
  appearance: 'light',
  source: 'built-in',
  colors: {
    text: {
      accent: '#0072b2',
      emphasis: '#000000',
      success: '#0072b2',
      warning: '#b35900',
      error: '#8c3d00',
      session: '#a8477f',
      muted: '#5c5c5c',
      onAccent: '#ffffff',
    },
    border: {
      attention: '#b35900',
      focused: '#0072b2',
      active: '#0072b2',
      muted: '#a3a3a3',
      error: '#8c3d00',
    },
    status: {
      running: '#b35900',
      success: '#0072b2',
      error: '#8c3d00',
      denied: '#8a7500',
      waiting: '#b35900',
      cancelled: '#a8477f',
      idle: '#5c5c5c',
    },
  },
  markdown: {
    heading: '#0072b2',
    firstHeading: '#a8477f',
    code: '#8a5a00',
    codespan: '#8a5a00',
    link: '#0072b2',
    href: '#0072b2',
    blockquote: '#5c5c5c',
    del: '#5c5c5c',
    html: '#5c5c5c',
    diffAdded: '#004c77',
    diffRemoved: '#7a3300',
    diffAddedBackground: '#d6ecf9',
    diffRemovedBackground: '#fbe5cd',
    diffHunk: '#0072b2',
  },
  syntax: {
    keyword: '#0072b2',
    built_in: '#004c77',
    type: '#004c77',
    literal: '#0072b2',
    number: '#b35900',
    regexp: '#8c3d00',
    string: '#8c3d00',
    class: '#0072b2',
    function: '#8a7500',
    comment: '#5c5c5c',
    doctag: '#5c5c5c',
    meta: '#5c5c5c',
    tag: '#5c5c5c',
    name: '#0072b2',
    attr: '#004c77',
    addition: '#004c77',
    deletion: '#7a3300',
  },
  motion: { wave: ['#c7c7c7', '#a3a3a3', '#7a7a7a', '#5c5c5c'] },
};

export const BUILT_IN_THEMES: readonly ITuiTheme[] = [
  DARK_THEME,
  LIGHT_THEME,
  DARK_DALTONIZED_THEME,
  LIGHT_DALTONIZED_THEME,
];

/** The theme a run uses when nothing is configured: today's colours. */
export const DEFAULT_THEME_ID = DARK_THEME.id;

/**
 * The catalogue, as a function rather than the array itself. A caller outside `src/theme/` — the
 * theme registry a picker reads — needs to ENUMERATE the built-ins, which is a different act from
 * reaching into one of them for a colour; the floor refuses the second by refusing the DATA's names,
 * so the first gets an accessor of its own instead of an exemption.
 */
export function listBuiltInThemes(): readonly ITuiTheme[] {
  return BUILT_IN_THEMES;
}

/**
 * The one place "no theme was resolved" is answered. A caller outside `src/theme/` asks this instead
 * of importing the built-in data, so the anti-drift floor can keep the colour DATA inside this
 * module and still let a non-React entry point — `renderMarkdown`, which is called with a theme or
 * without one — render at all.
 */
export function resolveTheme(theme: ITuiTheme | undefined): ITuiTheme {
  return theme ?? DARK_THEME;
}
