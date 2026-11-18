/** The pre-write park on the built CLI, observed through a real PTY. */

import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnTui, writeTuiProviderSettings } from './pty-driver.js';

import type { IPtySession } from './pty-driver.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const REPLAY_FIXTURE = join(FIXTURES, 'replay-conversation.jsonl');

const WAIT_MS = 30_000;
const CASE_TIMEOUT_MS = 120_000;
/** The zero and off cases verify that replay latency stays below this interval. */
const PARK_MS = 1000;
/** Sampling period; the gap resolution is twice this. */
const SAMPLE_MS = 5;
/** OS and PTY jitter allowance on the asserted interval. */
const SLACK_MS = 60;
/** Startup frames settle for this long before the keystroke is measured against a quiet stream. */
const STARTUP_SETTLE_MS = 750;
const OPEN_WINDOW = '\x1b[?2026h';
const CLOSE_WINDOW = '\x1b[?2026l';
const ANSWER = 'REPLAYED_ANSWER_42';
const RESPONSE = /REPLAYED_ANSWER_42[\s\S]*Type a message/;
/* eslint-disable no-control-regex -- matching the escapes IS the point here */
const OSC_133 = /\x1b\]133;[ABCD]\x07/g;
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]/g;
/* eslint-enable no-control-regex */

interface IGrowth {
  at: number;
  bytes: string;
}

const visible = (bytes: string): string => bytes.replace(ESCAPES, '');

function answerWindow(output: string): string | undefined {
  const answer = output.indexOf(ANSWER);
  if (answer < 0) return undefined;
  const previousClose = output.lastIndexOf(CLOSE_WINDOW, answer);
  const start = output.indexOf(
    OPEN_WINDOW,
    previousClose < 0 ? 0 : previousClose + CLOSE_WINDOW.length,
  );
  if (start < 0 || start > answer) throw new Error('Answer has no open synchronized-output window');
  const close = output.indexOf(CLOSE_WINDOW, answer);
  const nested = output.indexOf(OPEN_WINDOW, start + OPEN_WINDOW.length);
  const inside = output.slice(start + OPEN_WINDOW.length, close < 0 ? undefined : close);
  if ((nested >= 0 && (close < 0 || nested < close)) || inside.match(OSC_133) !== null)
    throw new Error('Interleaved synchronized-output windows');
  return close < 0 ? undefined : output.slice(start, close + CLOSE_WINDOW.length);
}

async function sampleUntil(
  session: Pick<IPtySession, 'raw'>,
  since: number,
  budgetMs: number,
  requireWindow = false,
): Promise<IGrowth[]> {
  const growths: IGrowth[] = [];
  let seen = since;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const raw = session.raw();
    if (raw.length > seen) {
      growths.push({ at: Date.now(), bytes: raw.slice(seen) });
      seen = raw.length;
    }
    const output = raw.slice(since);
    const window = requireWindow ? answerWindow(output) : output;
    if (window !== undefined && RESPONSE.test(visible(window))) return growths;
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
  throw new Error(
    `PTY output did not reach ${String(RESPONSE)}${requireWindow ? ' in a complete window' : ''}: ${JSON.stringify(session.raw().slice(-2000))}`,
  );
}

function visibleAt(growths: IGrowth[], text: string): number {
  let output = '';
  for (const growth of growths) {
    output += growth.bytes;
    if (visible(output).includes(text)) return growth.at;
  }
  throw new Error(`PTY did not emit ${JSON.stringify(text)}`);
}

/** The mount-time prompt-start must precede the answer. */
function expectMarksOrderedWithTheTurn(raw: string): void {
  const marks = [...raw.matchAll(OSC_133)].map((match) => ({
    code: match[0],
    at: match.index ?? 0,
  }));
  const answerAt = raw.indexOf('REPLAYED_ANSWER_42');
  const promptStarts = marks.filter((mark) => mark.code.includes('133;A'));
  expect(promptStarts.length).toBeGreaterThanOrEqual(1);
  expect(promptStarts[0]?.at).toBeLessThan(answerAt);
}

interface ITurnTiming {
  typedAt: number;
  echoAt: number;
  answerAt: number;
}

async function typeAndSubmit(session: IPtySession, requireWindow = false): Promise<ITurnTiming> {
  const sampling = sampleUntil(session, session.raw().length, WAIT_MS, requireWindow);
  // Measure from the last paced key so input pacing is not charged to the park.
  await session.sendKeys('hell');
  const typedAt = Date.now();
  await session.sendKeys('o');
  session.writeRaw('\r');
  const growths = await sampling;
  return {
    typedAt,
    echoAt: visibleAt(growths, 'hello'),
    answerAt: visibleAt(growths, ANSWER),
  };
}

function spawnScenario(projectDir: string, mode: 'park' | 'zero' | 'off'): IPtySession {
  const screenReader = mode === 'off' ? [] : ['--screen-reader'];
  const prepark = mode === 'zero' ? '0' : String(PARK_MS);
  return spawnTui({
    projectDir,
    homeDir: join(projectDir, 'home'),
    args: ['--session-log', REPLAY_FIXTURE, ...screenReader, '--name', 'prepark-scenario'],
    env: { PRODUCT_SCREEN_READER_STARTUP_QUIET_MS: '0', PRODUCT_SCREEN_READER_PREPARK_MS: prepark },
  });
}

/** Deliver the echo, answer, and closing marker in separate PTY reads. */
function fragmentOutput(session: IPtySession): IPtySession {
  let echoAt: number | undefined;
  let answerAt: number | undefined;
  let closeAt: number | undefined;
  return {
    ...session,
    raw() {
      const output = session.raw();
      const echo = output.indexOf('hello');
      if (echo >= 0) {
        echoAt ??= Date.now() + 75;
        if (Date.now() < echoAt) return output.slice(0, echo + 2);
      }
      const answer = output.indexOf(ANSWER);
      if (answer < 0) return output;
      answerAt ??= Date.now() + 75;
      if (Date.now() < answerAt) return output.slice(0, answer + 12);
      const close = output.indexOf(CLOSE_WINDOW, answer);
      if (close < 0) return output;
      closeAt ??= Date.now() + 150;
      return Date.now() < closeAt ? output.slice(0, close) : output;
    },
  };
}

async function settled(session: IPtySession): Promise<void> {
  await session.waitFor(/Type a message or \/help/, WAIT_MS);
  await new Promise((resolve) => setTimeout(resolve, STARTUP_SETTLE_MS));
}

describe('the pre-write park through the real binary', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-prepark-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'the echo is not delayed, the turn commit waits the interval after it, its chunks are contiguous, and the marks stay in order',
    async () => {
      session = spawnScenario(projectDir, 'park');
      await settled(session);

      const fragmented = fragmentOutput(session);
      const timing = await typeAndSubmit(fragmented, true);
      expect(timing.echoAt - timing.typedAt).toBeLessThan(PARK_MS - SLACK_MS);
      expect(timing.answerAt - timing.echoAt).toBeGreaterThanOrEqual(PARK_MS - SLACK_MS);
      expect(answerWindow(fragmented.raw())).toBeDefined();
      expectMarksOrderedWithTheTurn(session.raw());
      const incomplete = `${OPEN_WINDOW}${ANSWER} Type a message`;
      await expect(sampleUntil({ raw: () => incomplete }, 0, 25, true)).rejects.toThrow(
        'complete window',
      );
      expect(() => answerWindow(`${ANSWER}${CLOSE_WINDOW}`)).toThrow('no open');
      expect(() => answerWindow(`${OPEN_WINDOW}${incomplete}${CLOSE_WINDOW}`)).toThrow(
        'Interleaved',
      );
      expect(() => answerWindow(`${incomplete}${OPEN_WINDOW}${CLOSE_WINDOW}`)).toThrow(
        'Interleaved',
      );
      expect(() => answerWindow(`${incomplete}\x1b]133;A\x07${CLOSE_WINDOW}`)).toThrow(
        'Interleaved',
      );
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'with the interval 0 no delay is injected',
    async () => {
      session = spawnScenario(projectDir, 'zero');
      await settled(session);
      const timing = await typeAndSubmit(session);
      expect(timing.answerAt - timing.echoAt).toBeLessThan(PARK_MS - SLACK_MS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'with the mode off the park is absent — no interval, bordered UI as before',
    async () => {
      session = spawnScenario(projectDir, 'off');
      await settled(session);
      const timing = await typeAndSubmit(session);
      expect(timing.answerAt - timing.echoAt).toBeLessThan(PARK_MS - SLACK_MS);
      expect(session.snapshot()).toMatch(/[│─╭╮╰╯┌┐└┘]/u);
    },
    CASE_TIMEOUT_MS,
  );
});
