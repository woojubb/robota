/**
 * SCREEN-2670 TC-09 — the pre-write park on the BUILT robota binary, in a real PTY.
 *
 * A screen reader sees bytes and time, nothing else, so the claim is checked where both exist: the
 * raw PTY stream is sampled every few milliseconds and each growth is stamped. A COMMIT the park
 * released arrives as one growth (its chunks are written contiguously); the interval shows up as
 * the gap between consecutive printable growths. The same fixture runs three ways — park 250 ms,
 * park 0, mode off — so the interval is attributed to the park and not to the replay.
 *
 * Runs under `test:pty` against the built CLI (`pnpm build` first).
 */

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
/** The park under test — large against the frame cadence, small against the case budget. */
const PARK_MS = 250;
/** Sampling period; the gap resolution is twice this. */
const SAMPLE_MS = 5;
/** OS and PTY jitter allowance on the asserted interval. */
const SLACK_MS = 60;
/** Growths closer than this are one burst: a PTY read can split one contiguous write. */
const COALESCE_MS = 30;

/** Startup frames settle for this long before the keystroke is measured against a quiet stream. */
const STARTUP_SETTLE_MS = 750;
/* eslint-disable no-control-regex -- matching the escapes IS the point here */
const OSC_133 = /\x1b\]133;[ABCD]\x07/g;
const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[=>]/g;
/* eslint-enable no-control-regex */

interface IGrowth {
  at: number;
  bytes: string;
}

/**
 * Sample the raw stream from `since` (an offset taken BEFORE the action — the driver's key pacing
 * means output can land before this loop starts) until `until` matches or the budget ends; return
 * every growth stamped.
 */
interface IMark {
  /** Index into the RAW stream (growth detection). */
  raw: number;
  /** The driver's mark into the STRIPPED transcript (pattern matching) — the two are not the same. */
  stripped: number;
}

function markNow(session: IPtySession): IMark {
  return { raw: session.raw().length, stripped: session.outputOffset() };
}

async function sampleUntil(
  session: IPtySession,
  since: IMark,
  until: RegExp,
  budgetMs: number,
): Promise<IGrowth[]> {
  const growths: IGrowth[] = [];
  let seen = since.raw;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const raw = session.raw();
    if (raw.length > seen) {
      growths.push({ at: Date.now(), bytes: raw.slice(seen) });
      seen = raw.length;
    }
    if (until.test(session.snapshotSince(since.stripped))) break;
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
  return growths;
}

const visible = (bytes: string): string => bytes.replace(ESCAPES, '');

/** Merge growths that landed within `COALESCE_MS` of each other — one contiguous write, one burst. */
function bursts(growths: IGrowth[]): IGrowth[] {
  const merged: IGrowth[] = [];
  for (const growth of growths) {
    const last = merged.at(-1);
    if (last !== undefined && growth.at - last.at < COALESCE_MS) last.bytes += growth.bytes;
    else merged.push({ ...growth });
  }
  return merged;
}

/**
 * The marks travel through the owned path and keep their place. A replayed reply resolves inside
 * one commit, so the turn's own B/C/D/A marks are not observable here (their ordering against a
 * parked batch is pinned by the unit test); what this stream does carry is the mount-time
 * prompt-start, which must precede the answer rather than surface inside the parked gap after it.
 */
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

/**
 * One paced-free line: the echo commit (exempt) and the turn commit (parked) are provoked within
 * milliseconds of each other, so the interval between them is the park and nothing else. The reply
 * itself is replayed as a single chunk, so the turn is ONE commit — which is also what proves the
 * chunks of a commit stay contiguous: the answer arrives inside one synchronized-output window.
 */
interface ITurnTiming {
  typedAt: number;
  echoAt: number;
  answerAt: number;
  answerBytes: string;
}

async function typeAndSubmit(session: IPtySession): Promise<ITurnTiming> {
  const mark = markNow(session);
  const sampling = sampleUntil(session, mark, /REPLAYED_ANSWER_42[\s\S]*Type a message/, WAIT_MS);
  // Characters are paced (a single chunk would be read as a paste); the echo latency is measured
  // from the LAST key, so the driver's per-key pacing is not charged to the park. Enter follows the
  // last echo immediately, so the turn's commit is provoked within milliseconds of an exempt one.
  await session.sendKeys('hell');
  const typedAt = Date.now();
  await session.sendKeys('o');
  session.writeRaw('\r');
  const growths = bursts(await sampling);
  const echo = growths.find((g) => visible(g.bytes).includes('hello'));
  const answer = growths.find((g) => visible(g.bytes).includes('REPLAYED_ANSWER_42'));
  expect(echo, 'the echo of the typed line').toBeDefined();
  expect(answer, 'the replayed answer').toBeDefined();
  return {
    typedAt,
    echoAt: (echo as IGrowth).at,
    answerAt: (answer as IGrowth).at,
    answerBytes: (answer as IGrowth).bytes,
  };
}

function spawnScenario(projectDir: string, mode: 'park' | 'zero' | 'off'): IPtySession {
  const screenReader = mode === 'off' ? [] : ['--screen-reader'];
  const prepark = mode === 'zero' ? '0' : String(PARK_MS);
  return spawnTui({
    projectDir,
    homeDir: join(projectDir, 'home'),
    args: ['--session-log', REPLAY_FIXTURE, ...screenReader, '--name', 'prepark-scenario'],
    env: { ROBOTA_SCREEN_READER_STARTUP_QUIET_MS: '0', ROBOTA_SCREEN_READER_PREPARK_MS: prepark },
  });
}

async function settled(session: IPtySession): Promise<void> {
  await session.waitFor(/Type a message or \/help/, WAIT_MS);
  await new Promise((resolve) => setTimeout(resolve, STARTUP_SETTLE_MS));
}

describe('SCREEN-2670 the pre-write park through the real binary', () => {
  let projectDir: string;
  let session: IPtySession | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'robota-prepark-pty-')));
    writeTuiProviderSettings(projectDir);
  });

  afterEach(async () => {
    await session?.disposeAsync();
    session = undefined;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    'TC-09: the echo is not delayed, the turn commit waits the interval after it, its chunks are contiguous, and the marks stay in order',
    async () => {
      session = spawnScenario(projectDir, 'park');
      await settled(session);

      const timing = await typeAndSubmit(session);
      // The keystroke's commit is exempt: its echo lands well inside the interval.
      expect(timing.echoAt - timing.typedAt).toBeLessThan(PARK_MS - SLACK_MS);
      // The turn's commit is parked: at least the interval after the previous printable release.
      expect(timing.answerAt - timing.echoAt).toBeGreaterThanOrEqual(PARK_MS - SLACK_MS);
      // And it arrived whole: the synchronized-output window opened and closed in one growth.
      expect(timing.answerBytes).toContain('\x1b[?2026h');
      expect(timing.answerBytes).toContain('\x1b[?2026l');
      expectMarksOrderedWithTheTurn(session.raw());
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'TC-09: with the interval 0 no delay is injected',
    async () => {
      session = spawnScenario(projectDir, 'zero');
      await settled(session);
      const timing = await typeAndSubmit(session);
      expect(timing.answerAt - timing.echoAt).toBeLessThan(PARK_MS - SLACK_MS);
    },
    CASE_TIMEOUT_MS,
  );

  it(
    'TC-09: with the mode off the park is absent — no interval, bordered UI as before',
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
