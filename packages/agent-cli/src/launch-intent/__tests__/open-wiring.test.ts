import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/** Local launch resolution precedes workspace/parser composition; hosted admission is separate. */
import { describe, expect, it } from 'vitest';

import { printHelp } from '../../utils/cli-help.js';
import { OPEN_SUBCOMMAND } from '../open-invocation.js';

describe('TC-06: `open` is wired where it must be, and claimed nowhere else', () => {
  it('local CLI bootstrap resolves launch before any local cwd read or argv parse', () => {
    const cli = new URL('../../cli-core.ts', import.meta.url);
    const source = readFileSyncUtf8(cli);
    const launch = source.indexOf('applyLaunchInvocation(productRuntime)');
    const cwd = source.indexOf('const cwd = process.cwd()');
    const parse = source.indexOf('parseCliArgs()');
    expect(launch).toBeGreaterThan(-1);
    expect(launch).toBeLessThan(cwd);
    expect(launch).toBeLessThan(parse);
  });

  it('the help catalogue documents the form, including that it takes exactly one link', () => {
    const help = printHelp(createTestProductRuntime());
    expect(help).toContain(`test-product ${OPEN_SUBCOMMAND}`);
    expect(help).toContain('test-product://open?v=1');
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
