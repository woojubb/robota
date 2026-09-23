/** FLOW-2006 TC-06 — the wiring: the pre-parse step runs before the parser, and `--help` says so. */
import { describe, expect, it } from 'vitest';

import { printHelp } from '../../utils/cli-help.js';
import { OPEN_SUBCOMMAND } from '../open-invocation.js';

describe('TC-06: `open` is wired where it must be, and claimed nowhere else', () => {
  it('shared CLI bootstrap consults the launch invocation before it reads the cwd or parses argv', () => {
    const cli = new URL('../../cli-core.ts', import.meta.url);
    const source = readFileSyncUtf8(cli);
    const launch = source.indexOf('applyLaunchInvocation()');
    const cwd = source.indexOf('const cwd = process.cwd()');
    const parse = source.indexOf('parseCliArgs()');
    expect(launch).toBeGreaterThan(-1);
    expect(launch).toBeLessThan(cwd);
    expect(launch).toBeLessThan(parse);
  });

  it('the help catalogue documents the form, including that it takes exactly one link', () => {
    const help = printHelp();
    expect(help).toContain(`robota ${OPEN_SUBCOMMAND}`);
    expect(help).toContain('robota://open?v=1');
    expect(help.replace(/\s+/g, ' ')).toContain('It takes exactly one link');
  });

  it('`open` is not also claimed by the terminating subcommand router', () => {
    const routing = new URL('../../startup/preparsed-command-routing.ts', import.meta.url);
    expect(readFileSyncUtf8(routing)).not.toContain(`=== '${OPEN_SUBCOMMAND}'`);
  });
});

function readFileSyncUtf8(url: URL): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- a source-shape assertion
  return require('node:fs').readFileSync(url, 'utf8') as string;
}
