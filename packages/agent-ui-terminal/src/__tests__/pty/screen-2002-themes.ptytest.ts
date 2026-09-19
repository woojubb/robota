/**
 * SCREEN-2002 TC-13 — themes, user theme files and plugin theme files, through the BUILT binary in
 * a real PTY (run by `test:pty`; requires `pnpm build:deps` first).
 *
 * What only this level can show: that the theme a user chooses reaches the terminal's actual bytes
 * without a restart, that a theme FILE they wrote is discovered from their home directory and a
 * plugin's from its own, and that a file the run refused is visible to them — at startup and in the
 * picker — rather than silently missing from the list.
 *
 * The transcript is Ink `<Static>` and is not repainted, so a theme change moves the LIVE region;
 * assertions take an offset mark first and read only what arrived after it.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const THEME_FIXTURE = join(FIXTURES, 'screen-2002-themes.jsonl');

const PROMPT = /Type a message or \/help/;
const SNIPPET_DONE = /SCREEN2002_SNIPPET_DONE/;
const ACCENT = '#56b4e9';

/** Named because a bare number in a call is a lint warning, and because each one means something. */
const BOOT_MS = 30_000;
const STEP_MS = 20_000;
const TURN_MS = 40_000;
const CASE_MS = 150_000;
/** More than the single reset a plain frame carries. */
const MINIMUM_SGR_VARIETY = 1;

/** Every SGR sequence in a slice of the raw transcript, as a set — the frame's colour vocabulary. */
function sgrVocabulary(raw: string): Set<string> {
  const found = new Set<string>();
  // eslint-disable-next-line no-control-regex -- scanning raw SGR escape bytes by design
  for (const match of raw.matchAll(/\x1b\[([0-9;]*)m/g)) found.add(match[1] ?? '');
  return found;
}

/** The raw bytes of the rendered line that holds the snippet, if the frame carried it. */
function snippetLine(raw: string): string {
  return raw.split(/\r?\n/u).find((line) => line.includes('answer') && line.includes('42')) ?? '';
}

function seedThemeFiles(homeDir: string): void {
  const themes = join(homeDir, '.robota', 'themes');
  mkdirSync(themes, { recursive: true });
  writeFileSync(
    join(themes, 'mine.json'),
    JSON.stringify({
      name: 'Mine',
      base: 'dark',
      // Tokens the IDLE frame actually paints with. Overriding `text.accent` alone proves nothing
      // here: the accent labels live in the transcript, which is `<Static>` and is never repainted,
      // so a run with nothing submitted would show the same bytes either way.
      overrides: {
        colors: {
          text: { accent: ACCENT, muted: ACCENT },
          border: { focused: ACCENT, muted: ACCENT },
          status: { idle: ACCENT },
        },
      },
    }),
  );
  writeFileSync(
    join(themes, 'broken.json'),
    JSON.stringify({ overrides: { colors: { text: { accent: 'not-a-colour' } } } }),
  );

  const pluginVersionDir = join(
    homeDir,
    '.robota',
    'plugins',
    'cache',
    'fixtures',
    'theme-fixture',
    '1.0.0',
  );
  mkdirSync(join(pluginVersionDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginVersionDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'theme-fixture',
      version: '1.0.0',
      description: 'a themes-only fixture plugin',
      features: {},
    }),
  );
  mkdirSync(join(pluginVersionDir, 'themes'), { recursive: true });
  writeFileSync(
    join(pluginVersionDir, 'themes', 'plugged.json'),
    JSON.stringify({ name: 'Plugged', base: 'light' }),
  );
}

describe('SCREEN-2002 themes through the real binary', () => {
  let projectDir: string;
  let homeDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-screen2002-pty-')));
    writeTuiProviderSettings(projectDir);
    homeDir = join(projectDir, 'home');
    seedThemeFiles(homeDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'S1: lists user and plugin themes, refuses a broken file out loud, and switches without a restart',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir,
        args: ['--session-log', THEME_FIXTURE],
        env: { FORCE_COLOR: '3' },
      });

      // The refused file says so ONCE, at startup, with the path that refused it.
      await session.waitFor(
        /Skipped theme "broken\.json": \$\.overrides\.colors\.text\.accent/,
        BOOT_MS,
      );
      await session.waitFor(PROMPT, BOOT_MS);

      // `/theme list` sees the built-ins AND both files, each with where it came from.
      const listMark = session.outputOffset();
      await session.sendKeys('/theme list');
      await session.pressEnter();
      await session.waitForSince(listMark, /Available themes:/, STEP_MS);
      const listed = session.snapshotSince(listMark);
      expect(listed).toContain('dark — Dark');
      expect(listed).toContain('custom:mine — Mine (dark, user)');
      expect(listed).toContain('custom:theme-fixture:plugged — Plugged (light, plugin)');

      // Applying the user's own theme puts ITS accent colour on the wire, with no restart.
      const applyMark = session.outputOffset();
      // A RAW mark of its own: `outputOffset()` indexes the ANSI-STRIPPED transcript, so slicing
      // `raw()` with it lands at an unrelated byte.
      const applyRawMark = session.raw().length;
      await session.sendKeys('/theme custom:mine');
      await session.pressEnter();
      await session.waitForSince(applyMark, /Applied: theme Mine/, STEP_MS);
      await session.waitForSince(applyMark, PROMPT, STEP_MS);
      // `#56b4e9` as this terminal encodes it. The PTY is `xterm-256color` with no `COLORTERM`, so
      // the depth is 256 and the hex downsamples to index 117 — asserting truecolor here would be
      // asserting the harness's terminal rather than the theme.
      expect(session.raw().slice(applyRawMark)).toContain('38;5;117');
    },
    CASE_MS,
  );

  it(
    'S2: the picker previews on move, restores on escape, and shows the refused file as a row',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir,
        args: ['--session-log', THEME_FIXTURE],
        env: { FORCE_COLOR: '3' },
      });
      await session.waitFor(PROMPT, BOOT_MS);

      const openMark = session.outputOffset();
      const openRawMark = session.raw().length;
      await session.sendKeys('/theme');
      await session.pressEnter();
      await session.waitForSince(openMark, /Theme/, STEP_MS);
      // The refused file is a row that carries its reason — the startup line has long since scrolled.
      await session.waitForSince(openMark, /Skipped "broken\.json"/, STEP_MS);

      // Moving the highlight repaints the live region in the previewed theme: new SGR appears that
      // the frame did not carry before the move. The arrow goes through `writeRaw` — `sendKeys`
      // paces per character, so the leading Escape would arrive alone and CANCEL the picker.
      const before = sgrVocabulary(session.raw().slice(openRawMark));
      const moveMark = session.outputOffset();
      const moveRawMark = session.raw().length;
      session.writeRaw('\x1b[B');
      await session.waitForSince(moveMark, /> Light — light, built-in/, STEP_MS);
      const after = sgrVocabulary(session.raw().slice(moveRawMark));
      expect([...after].some((sequence) => !before.has(sequence))).toBe(true);

      // Escape leaves the persisted theme in place. Not only "nothing was applied": the colours the
      // PREVIEW introduced are gone from the frame, which is what "restores" has to mean when the
      // preview was visible rather than merely recorded.
      const previewed = [...after].filter((sequence) => !before.has(sequence));
      expect(previewed.length).toBeGreaterThan(0);
      const escapeMark = session.outputOffset();
      const escapeRawMark = session.raw().length;
      session.pressEscape();
      await session.waitForSince(escapeMark, PROMPT, STEP_MS);
      const restored = sgrVocabulary(session.raw().slice(escapeRawMark));
      expect(previewed.filter((sequence) => restored.has(sequence))).toEqual([]);
      expect(session.snapshotSince(escapeMark)).not.toContain('Applied: theme');
    },
    CASE_MS,
  );

  it(
    'S3: syntax highlighting is switched off for later renders and the scrollback keeps its own',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir,
        args: ['--session-log', THEME_FIXTURE],
        env: { FORCE_COLOR: '3' },
      });
      await session.waitFor(PROMPT, BOOT_MS);

      const firstMark = session.outputOffset();
      const firstRawMark = session.raw().length;
      await session.sendKeys('show me a snippet');
      await session.pressEnter();
      await session.waitForSince(firstMark, SNIPPET_DONE, TURN_MS);
      const highlighted = session.raw().slice(firstRawMark);
      // The TEXT is read from the stripped transcript: a highlighted block carries SGR BETWEEN its
      // tokens, so the source line is not contiguous in the raw bytes — which is the point.
      expect(session.snapshotSince(firstMark)).toContain('const answer = 42;');
      // cli-highlight coloured the keyword: the block carries SGR the plain text would not.
      expect(sgrVocabulary(highlighted).size).toBeGreaterThan(MINIMUM_SGR_VARIETY);

      const offMark = session.outputOffset();
      await session.sendKeys('/theme syntax off');
      await session.pressEnter();
      await session.waitForSince(offMark, /syntax highlighting off/, STEP_MS);

      const secondMark = session.outputOffset();
      const secondRawMark = session.raw().length;
      await session.sendKeys('show me a snippet');
      await session.pressEnter();
      await session.waitForSince(secondMark, SNIPPET_DONE, TURN_MS);

      // The same source, rendered again. Asserting only that the TEXT is there would pass whether
      // or not `/theme syntax off` reached a render site — which is the defect this package has
      // already shipped once — so the assertion is on the line's own SGR: the second render of the
      // same line carries strictly fewer distinct sequences than the highlighted first.
      const plain = session.raw().slice(secondRawMark);
      expect(session.snapshotSince(secondMark)).toContain('const answer = 42;');
      const highlightedLine = sgrVocabulary(snippetLine(highlighted));
      const plainLine = sgrVocabulary(snippetLine(plain));
      expect(highlightedLine.size).toBeGreaterThan(plainLine.size);
      expect([...highlightedLine].some((sequence) => !plainLine.has(sequence))).toBe(true);
    },
    CASE_MS,
  );

  it(
    'S4: --reduced-motion stops the animation while colour stays on',
    async () => {
      session = spawnTui({
        projectDir,
        homeDir,
        args: ['--session-log', THEME_FIXTURE, '--reduced-motion'],
        env: { FORCE_COLOR: '3' },
      });
      await session.waitFor(PROMPT, BOOT_MS);

      const mark = session.outputOffset();
      const rawMark = session.raw().length;
      await session.sendKeys('/theme list');
      await session.pressEnter();
      await session.waitForSince(mark, /Available themes:/, STEP_MS);
      const listed = session.snapshotSince(mark);
      // The pin is reported, not silently obeyed.
      // What THIS RUN does, and what is saved — two facts, never one in place of the other. This
      // line is the defect TC-13 found: it read `reduced motion: off (… pinned by flag)`.
      expect(listed).toContain('reduced motion: on for this run (pinned by flag; saved off)');
      // Colour is untouched by the motion decision.
      expect(sgrVocabulary(session.raw().slice(rawMark)).size).toBeGreaterThan(MINIMUM_SGR_VARIETY);
    },
    CASE_MS,
  );
});
