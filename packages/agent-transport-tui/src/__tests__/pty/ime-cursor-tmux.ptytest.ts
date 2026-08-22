/**
 * CLI-062 — the one matrix cell where a REAL terminal emulator answers back.
 *
 * Every other cell reads the cursor out of the byte stream our own VT interpreter replays. tmux is
 * a full, independent terminal emulator that can be driven headlessly AND queried: it runs the
 * built robota binary in a real pane, receives the Korean keystrokes through its own input path,
 * and then reports where ITS state machine put the hardware cursor
 * (`#{cursor_x}` / `#{cursor_y}` / `#{cursor_flag}`). That makes this the strongest available
 * confirmation short of macOS hardware: a second implementation agrees the cursor sits on the
 * input row at the composition column — which is the cell an OS IME anchors its window to.
 *
 * Skipped when tmux is not installed; `ROBOTA_TMUX_BIN` overrides the binary. GitHub's ubuntu
 * runner images ship tmux, so this runs in CI rather than quietly evaporating there.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const ROBOTA_BIN = join(REPO_ROOT, 'packages/agent-cli/bin/robota.cjs');
const COLS = 80;
const COMPOSITION = '안녕';
const COMPOSITION_WIDTH = 4;

function resolveTmux(): string | undefined {
  const override = process.env['ROBOTA_TMUX_BIN'];
  if (override !== undefined && override !== '') return override;
  const which = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  const found = which.stdout.trim();
  return found === '' ? undefined : found;
}

const TMUX = resolveTmux();

interface ITmuxProbe {
  cursorX: number;
  cursorY: number;
  /** tmux's own DECTCEM view: is the hardware cursor visible in the pane? */
  cursorVisible: boolean;
  pane: string[];
}

interface ITmuxRun {
  root: string;
  socket: string;
}

/** Run robota inside a real tmux pane and ask tmux where the cursor ended up. */
function runInTmux(run: ITmuxRun, rows: number, imeCursor: string | undefined): ITmuxProbe {
  const tmux = TMUX!;
  const projectDir = join(run.root, 'proj');
  const homeDir = join(run.root, 'home');
  mkdirSync(join(homeDir, '.robota'), { recursive: true });
  writeFileSync(
    join(homeDir, '.robota/settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'tmux-dummy-key' },
      },
    }),
    'utf8',
  );

  // A wrapper keeps the pane's env explicit (never inheriting real provider keys) while letting
  // tmux itself set TERM/TERM_PROGRAM for the pane — the handshake under test.
  const wrapper = join(run.root, 'wrap.sh');
  const imeAssignment = imeCursor === undefined ? '' : `ROBOTA_IME_CURSOR=${imeCursor} `;
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      `cd "${projectDir}"`,
      `exec env -i PATH="$PATH" HOME="${homeDir}" TERM="$TERM" TERM_PROGRAM="$TERM_PROGRAM" ${imeAssignment}` +
        `"${process.execPath}" "${ROBOTA_BIN}" --name tmux-fixture`,
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(wrapper, 0o755);

  const tmuxCall = (...args: string[]): string =>
    execFileSync(tmux, ['-S', run.socket, ...args], { encoding: 'utf8' });

  tmuxCall('new-session', '-d', '-x', String(COLS), '-y', String(rows), wrapper);

  const deadline = Date.now() + 40_000;
  let pane = '';
  while (Date.now() < deadline) {
    pane = tmuxCall('capture-pane', '-p');
    if (pane.includes('Type a message')) break;
    sleepSync(250);
  }
  expect(pane, 'robota never reached the prompt inside tmux').toContain('Type a message');
  sleepSync(400);

  tmuxCall('send-keys', '-l', COMPOSITION);
  sleepSync(1500);

  const [x = '', y = '', flag = ''] = tmuxCall(
    'display-message',
    '-p',
    '#{cursor_x} #{cursor_y} #{cursor_flag}',
  )
    .trim()
    .split(' ');
  return {
    cursorX: Number.parseInt(x, 10),
    cursorY: Number.parseInt(y, 10),
    cursorVisible: flag === '1',
    pane: tmuxCall('capture-pane', '-p').split('\n'),
  };
}

/** Deliberate synchronous wait: tmux is driven through blocking CLI calls, not an event loop. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe.skipIf(TMUX === undefined)(
  'CLI-062 terminal matrix — tmux, a real emulator reporting its own cursor',
  () => {
    let run: ITmuxRun;

    beforeEach(() => {
      const root = mkdtempSync(join(tmpdir(), 'robota-tmux-ime-'));
      run = { root, socket: join(root, 'sock') };
    });

    afterEach(() => {
      if (TMUX !== undefined) {
        spawnSync(TMUX, ['-S', run.socket, 'kill-server'], { stdio: 'ignore' });
      }
      rmSync(run.root, { recursive: true, force: true });
    });

    it('24-row pane: tmux reports the cursor VISIBLE on the input row at the composition column', () => {
      const probe = runInTmux(run, 24, undefined);
      const inputRow = probe.pane.findIndex((line) => line.includes(`> ${COMPOSITION}`));
      expect(inputRow, `no input row in pane:\n${probe.pane.join('\n')}`).toBeGreaterThanOrEqual(0);

      expect(probe.cursorVisible).toBe(true);
      expect(probe.cursorY).toBe(inputRow);
      expect(probe.cursorX).toBe(probe.pane[inputRow]!.indexOf('> ') + 2 + COMPOSITION_WIDTH);
    }, 90_000);

    it('5-row pane (frame ≥ viewport, I2): tmux reports the cursor hidden, never positioned', () => {
      const probe = runInTmux(run, 5, undefined);
      expect(probe.pane.some((line) => line.includes(`> ${COMPOSITION}`))).toBe(true);
      expect(probe.cursorVisible).toBe(false);
    }, 90_000);

    it('ROBOTA_IME_CURSOR=0 kill switch: tmux reports the cursor hidden even at 24 rows', () => {
      const probe = runInTmux(run, 24, '0');
      const inputRow = probe.pane.findIndex((line) => line.includes(`> ${COMPOSITION}`));
      expect(inputRow).toBeGreaterThanOrEqual(0);
      expect(probe.cursorVisible).toBe(false);
      expect(probe.cursorY).not.toBe(inputRow);
    }, 90_000);
  },
);
