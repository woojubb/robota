/**
 * CLI-2004 TC-01 — the screen-reader enablement resolver and its flag pair.
 *
 * The precedence here is a DELIBERATE inversion of `resolveMemoryEnablement`'s env-wins rule:
 * settings ← env ← flag (flag wins). A per-invocation flag must be able to turn the mode on for one
 * run on a machine whose environment has it off, which is the SSH/remote case the accessibility
 * references call out. The two resolvers are therefore asserted against each other's shape here so
 * the divergence is visible rather than assumed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectScreenReaderHint,
  readScreenReaderSetting,
  resolveScreenReaderEnablement,
  resolveScreenReaderRenderFields,
} from '../screen-reader-enablement.js';
import { parseCliArgs, printHelp } from '../../utils/cli-args.js';

describe('resolveScreenReaderEnablement — CLI-2004 TC-01', () => {
  it('is OFF with no settings, env or flag', () => {
    expect(resolveScreenReaderEnablement({})).toEqual({ enabled: false, channel: undefined });
  });

  it('the setting alone enables the mode via the settings channel', () => {
    expect(resolveScreenReaderEnablement({ settings: true })).toEqual({
      enabled: true,
      channel: 'settings',
    });
  });

  it('ROBOTA_SCREEN_READER=1 alone enables the mode via the env channel', () => {
    expect(resolveScreenReaderEnablement({ env: '1' })).toEqual({
      enabled: true,
      channel: 'env',
    });
  });

  it('INK_SCREEN_READER=true alone enables the mode as an equal env-tier input', () => {
    expect(resolveScreenReaderEnablement({ inkEnv: 'true' })).toEqual({
      enabled: true,
      channel: 'env',
    });
  });

  it('INK_SCREEN_READER only matches the literal "true" (Ink\'s own contract), never "1"', () => {
    expect(resolveScreenReaderEnablement({ inkEnv: '1' })).toEqual({
      enabled: false,
      channel: undefined,
    });
  });

  it('ROBOTA_SCREEN_READER=0 keeps the mode off against a true setting', () => {
    expect(resolveScreenReaderEnablement({ settings: true, env: '0' })).toEqual({
      enabled: false,
      channel: undefined,
    });
  });

  it('--screen-reader wins over ROBOTA_SCREEN_READER=0 AND a false setting', () => {
    expect(resolveScreenReaderEnablement({ settings: false, env: '0', flagEnabled: true })).toEqual(
      { enabled: true, channel: 'flag' },
    );
  });

  it('--no-screen-reader wins over every enabling input', () => {
    expect(
      resolveScreenReaderEnablement({
        settings: true,
        env: '1',
        inkEnv: 'true',
        flagEnabled: false,
      }),
    ).toEqual({ enabled: false, channel: undefined });
  });

  it('an unrecognised ROBOTA_SCREEN_READER value leaves the lower tier standing', () => {
    expect(resolveScreenReaderEnablement({ settings: true, env: 'yes' })).toEqual({
      enabled: true,
      channel: 'settings',
    });
  });
});

describe('readScreenReaderSetting', () => {
  it('reads the boolean `screenReader` key from a raw settings record', () => {
    expect(readScreenReaderSetting({ screenReader: true })).toBe(true);
    expect(readScreenReaderSetting({ screenReader: false })).toBe(false);
  });

  it('returns undefined for an absent, malformed or non-boolean key (never a throw)', () => {
    expect(readScreenReaderSetting(undefined)).toBeUndefined();
    expect(readScreenReaderSetting({})).toBeUndefined();
    expect(readScreenReaderSetting({ screenReader: 'yes' })).toBeUndefined();
  });
});

describe("detectScreenReaderHint — the advisory line's only trigger", () => {
  it('fires when INK_SCREEN_READER is set to a non-"true" value', () => {
    expect(detectScreenReaderHint({ INK_SCREEN_READER: '1' })).toBe(true);
  });

  it('fires on a reader-shaped environment variable', () => {
    expect(detectScreenReaderHint({ NVDA: '1' })).toBe(true);
    expect(detectScreenReaderHint({ JAWS_HOME: 'C:/jaws' })).toBe(true);
    expect(detectScreenReaderHint({ VOICEOVER_ENABLED: '1' })).toBe(true);
  });

  it('does not fire on an empty or unrelated environment', () => {
    expect(detectScreenReaderHint({})).toBe(false);
    expect(detectScreenReaderHint({ TERM: 'xterm-256color', HOME: '/root' })).toBe(false);
  });

  it("does not fire when INK_SCREEN_READER already reads as Ink's enabling literal", () => {
    expect(detectScreenReaderHint({ INK_SCREEN_READER: 'true' })).toBe(false);
  });
});

describe('the advisory line is withheld from an operator who said no', () => {
  const READER_ENV = { NVDA: '1' };

  it('offers the flag when the mode is merely off by default', () => {
    expect(resolveScreenReaderRenderFields(undefined, undefined, READER_ENV)).toMatchObject({
      screenReader: false,
      screenReaderHint: true,
    });
  });

  it('says nothing after --no-screen-reader — the operator just used the flag it would name', () => {
    expect(resolveScreenReaderRenderFields(undefined, false, READER_ENV)).toMatchObject({
      screenReader: false,
      screenReaderHint: false,
    });
  });

  it('says nothing under ROBOTA_SCREEN_READER=0, the other explicit off', () => {
    expect(
      resolveScreenReaderRenderFields(undefined, undefined, {
        ...READER_ENV,
        ROBOTA_SCREEN_READER: '0',
      }),
    ).toMatchObject({ screenReader: false, screenReaderHint: false });
  });

  it('never carries a hint while the mode is ON — there is nothing to advise', () => {
    expect(resolveScreenReaderRenderFields(undefined, true, READER_ENV)).toMatchObject({
      screenReader: true,
      screenReaderChannel: 'flag',
      screenReaderHint: false,
    });
  });
});

describe('--screen-reader / --no-screen-reader (§ Solution 2)', () => {
  let originalArgv: string[];

  beforeEach(() => {
    originalArgv = process.argv;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  function parseWith(...flags: string[]): ReturnType<typeof parseCliArgs> {
    process.argv = ['node', 'robota', ...flags];
    return parseCliArgs();
  }

  it('is undefined when neither flag is given (tri-state, no default)', () => {
    expect(parseWith().screenReader).toBeUndefined();
  });

  it('parses --screen-reader as true and --no-screen-reader as false', () => {
    expect(parseWith('--screen-reader').screenReader).toBe(true);
    expect(parseWith('--no-screen-reader').screenReader).toBe(false);
  });

  it('--no-screen-reader wins when both are given', () => {
    expect(parseWith('--screen-reader', '--no-screen-reader').screenReader).toBe(false);
  });

  it('the help catalogue documents both halves of the flag pair', () => {
    expect(printHelp()).toContain('--screen-reader');
    expect(printHelp()).toContain('--no-screen-reader');
  });
});
