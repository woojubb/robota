/**
 * SCREEN-006 User Execution Test Scenarios — color/motion degradation and palette-token colors on
 * the BUILT robota binary in a real PTY (run by `test:pty`; requires `pnpm build:deps` first).
 *
 * Scenario 1 (NO_COLOR legibility): `NO_COLOR=1` through a replayed conversation → the raw pty
 *   transcript contains ZERO SGR color sequences (30-38/40-48/90-97/100-107 params, incl. 38;5 /
 *   48;5 extended forms). Because NO color code may appear at all, this also proves the repeated
 *   waiting-state frames show zero WaveText color churn (motion is static: the
 *   `isInteractiveColorTerminal()` gate creates no interval under NO_COLOR).
 * Scenario 2 (normal-run consistency): color on → the persisted tool summary renders the
 *   `STATUS_GLYPH.success` glyph in the palette's status color (green, ESC[32m — sourced from
 *   `PALETTE.status` through the status SSOT), the assistant label renders the accent token
 *   (cyan, ESC[36m), and the markdown diff block carries the `tui-ansi-palette` SGR pairs
 *   (38;5;120 on 48;5;22 for added lines).
 *   Reachability note (recorded limit): a permission DENY short-circuits before tool-start, so the
 *   framework emits no tool-summary entry for it — the denied (`yellowBright`) unification is
 *   therefore pinned at component level (`message-list-rendering.test.tsx`), while this scenario
 *   evidences the same STATUS_GLYPH→PALETTE.status sourcing end-to-end via the success kind.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';
import { ANSI } from '../../tui-ansi-palette.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const REPLAY_FIXTURE = join(FIXTURES, 'replay-conversation.jsonl');
const COLORS_FIXTURE = join(FIXTURES, 'screen-006-colors.jsonl');

/** SGR params that set a color (foreground/background, basic/bright/extended). */
const COLOR_PARAM = /^(?:3[0-8]|39|4[0-8]|49|9[0-7]|10[0-7])$/;

/** Every SGR color param present in a raw pty transcript (e.g. ['33', '38;5;210'→'38']). */
function sgrColorParams(raw: string): string[] {
  const params: string[] = [];
  // eslint-disable-next-line no-control-regex -- scanning raw SGR escape bytes by design
  for (const match of raw.matchAll(/\x1b\[([0-9;]*)m/g)) {
    // In an extended sequence (38;5;n / 48;5;n) the payload params are not themselves
    // color-setters, but the leading 38/48 is — flagging it is sufficient and exact.
    for (const param of (match[1] === '' ? '0' : match[1]).split(';')) {
      if (COLOR_PARAM.test(param)) {
        params.push(param);
        break; // one flagged param per sequence is enough evidence
      }
    }
  }
  return params;
}

describe('SCREEN-006 color/motion through the real binary', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'robota-screen006-pty-'));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('S1: NO_COLOR=1 → legible output, zero SGR color sequences, no animation', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--session-log', REPLAY_FIXTURE],
      env: { NO_COLOR: '1' },
    });

    await session.waitFor(/Type a message or \/help/);
    await session.sendKeys('hello');
    await session.pressEnter();

    // The replayed turn completes and the output stays legible (content + labels present).
    await session.waitFor(/REPLAYED_ANSWER_42/, 20_000);
    await session.waitFor(/Type a message or \/help/, 20_000);

    const stripped = session.snapshot();
    expect(stripped).toContain('You:');
    expect(stripped).toContain('REPLAYED_ANSWER_42');

    // Zero SGR color sequences in the ENTIRE raw transcript — which also proves the
    // waiting-state (WaveText) frames carried zero color churn under NO_COLOR.
    expect(sgrColorParams(session.raw())).toEqual([]);
  }, 60_000);

  it('S2: color on → tool summary uses the palette status color, labels use accent, diff uses tui-ansi-palette', async () => {
    session = spawnTui({
      projectDir,
      homeDir: join(projectDir, 'home'),
      args: ['--session-log', COLORS_FIXTURE],
    });

    await session.waitFor(/Type a message or \/help/);
    await session.sendKeys('go');
    await session.pressEnter();

    // The replayed Shell call needs approval in default permission mode → allow it.
    await session.waitFor(/Permission Required/, 20_000);
    await session.sendKeys('y');

    // The turn continues: the second replayed response carries the markdown diff block,
    // and the persisted tool summary lands at turn end.
    await session.waitFor(/SCREEN006_DIFF_DONE/, 20_000);
    await session.waitFor(/✓ Shell/, 10_000);

    const stripped = session.snapshot();
    const raw = session.raw();

    // Persisted tool summary: SSOT glyph + the palette's status color (success → green, ESC[32m)
    // rendered by the SCREEN-006 unified MessageList path (STATUS_GLYPH → PALETTE.status).
    expect(stripped).toContain('✓ Shell');
    // eslint-disable-next-line no-control-regex -- asserting on raw SGR escape bytes by design
    expect(raw).toMatch(/\x1b\[32m[^\x1b]*✓ Shell/);

    // Assistant label renders the accent token (cyan → ESC[36m ... "Robota:").
    // eslint-disable-next-line no-control-regex -- asserting on raw SGR escape bytes by design
    expect(raw).toMatch(/\x1b\[36m(?:\x1b\[[0-9;]*m)*Robota:/);

    // Markdown diff block carries the tui-ansi-palette SGR pairs (added line: light green
    // on dark green background).
    expect(raw).toContain(`${ANSI.darkGreenBackground}${ANSI.lightGreen}`);
    expect(stripped).toContain('+ added line');
  }, 60_000);
});
