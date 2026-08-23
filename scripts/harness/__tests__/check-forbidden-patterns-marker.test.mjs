/**
 * #1664 — the escape marker survives the formatter.
 *
 * The hook demanded `// allow-fallback:` on the catch line; prettier unconditionally moves a
 * comment that follows `{` onto the next line. Measured in #1656: marker on the next line → the
 * Write hook blocks; marker on the same line → prettier moves it; `--check` then fails until it is
 * moved back. Individually satisfiable, jointly not, for any file the repository formats — and the
 * repository's own `routes.ts` already carried two in-block markers that pass every scan.
 * `scan-no-fallback.mjs` (the CI authority) accepts the in-block form; the hook now agrees with
 * the rule it fronts for.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/check-forbidden-patterns.sh');

// The hook appends every refusal to `$CLAUDE_PROJECT_DIR/.agents/evals/local-metrics/blocks.jsonl`.
// Left unset, that falls back to the real workspace, and every status-2 case here writes a
// synthetic block record into the log the lessons pipeline reads. The isolation convention is
// hook-boundary-parity.test.mjs's: point the project dir at a scratch directory.
const SCRATCH = makeTemp('forbidden-marker-');
mkdirSync(path.join(SCRATCH, '.agents/evals/local-metrics'), { recursive: true });
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function writeThrough(content) {
  const payload = JSON.stringify({
    tool_name: 'Write',
    cwd: WORKSPACE_ROOT,
    tool_input: { file_path: path.join(WORKSPACE_ROOT, 'packages/x/src/probe.ts'), content },
  });
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: SCRATCH },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

const SWALLOW = `try {
  risky();
} catch {
  return undefined;
}
`;

describe('the allow-fallback marker, in the places the formatter leaves it', () => {
  it('still blocks a bare swallow', () => {
    const { status, output } = writeThrough(SWALLOW);

    expect(status, 'a markerless swallow went through').toBe(2);
    expect(output).toMatch(/try-catch-fallback/);
  });

  it('accepts the marker on the catch line', () => {
    const { status } = writeThrough(
      SWALLOW.replace('} catch {', '} catch { // allow-fallback: reason'),
    );

    expect(status).toBe(0);
  });

  it('accepts the marker where PRETTIER puts it — the first line inside the block', () => {
    // The #1664 shape: prettier moves the same-line comment here, unconditionally.
    const { status } = writeThrough(
      SWALLOW.replace(
        '} catch {\n',
        '} catch {\n  // allow-fallback: reason the formatter cannot relocate away\n',
      ),
    );

    expect(status, 'the formatter-placed marker was refused').toBe(0);
  });

  it('accepts a marker DEEP in a long catch body — CI scans to the closing brace, so this must too', () => {
    // The 6-line cap on the marker scope was the hook being stricter than the CI authority for a
    // placement CI accepts: anywhere inside the real block. The FALLBACK judgement keeps its own
    // window; only where a marker may sit follows the block.
    const far = `try {
  risky();
} catch {
  a();
  b();
  c();
  d();
  e();
  f();
  // allow-fallback: a reason deep in a long body, valid to the CI authority
  return undefined;
}
`;
    const { status, output } = writeThrough(far);

    expect(status, `a CI-valid deep marker was refused:\n${output}`).toBe(0);
  });

  it('accepts a marker on the line ABOVE the catch — the leading-comment convention CI reads', () => {
    const above = `try {
  risky();
  // allow-fallback: stated before the catch, the leading-comment convention
} catch {
  return undefined;
}
`;
    const { status, output } = writeThrough(above);

    expect(status, `the leading-comment placement was refused:\n${output}`).toBe(0);
  });

  it('accepts a marker when the brace opens on the NEXT line — pre-formatter content', () => {
    // The hook reads tool_input content BEFORE prettier runs, so an Allman-style catch is
    // reachable. Cutting the scope at the signature line would refuse a correctly marked body.
    const allman = `try {
  risky();
} catch (error)
{
  // allow-fallback: reason on a body the brace opens late for
  return undefined;
}
`;
    const { status, output } = writeThrough(allman);

    expect(status, `the late-opening brace cut the marker scope:\n${output}`).toBe(0);
  });

  it('a brace inside a STRING does not hold the block open past its real end', () => {
    // Textual counting read `"missing key {"` as an opening brace, so depth never closed, the
    // scope grew past the real block, and an unrelated marker beyond it was absorbed — the
    // fail-open the counter was claimed not to have.
    const stringBrace = `try {
  risky();
} catch {
  logger.warn("missing key {");
  return undefined;
}

// allow-fallback: about something else entirely
cache.clear();
`;
    const { status } = writeThrough(stringBrace);

    expect(status, "a string's brace let a foreign marker excuse the catch").toBe(2);
  });

  it('a MULTI-LINE template with unbalanced braces does not hold the block open', () => {
    // Inside a template literal, text is prose until the closing backtick — a net-positive brace
    // count across its lines kept depth from closing and grew the scope past the real block.
    const template =
      'try {\n' +
      '  risky();\n' +
      '} catch {\n' +
      '  logger.warn(`missing {\n' +
      '    key {\n' +
      '  `);\n' +
      '  return undefined;\n' +
      '}\n' +
      '\n' +
      '// allow-fallback: about something else entirely\n' +
      'cache.clear();\n';
    const { status } = writeThrough(template);

    expect(status, "a template's braces let a foreign marker excuse the catch").toBe(2);
  });

  it('a BLOCK comment with an unmatched brace does not hold the block open', () => {
    // /* ... */ text is prose too — inline or spanning lines — and an unmatched brace inside one
    // inflated depth past the real closing brace.
    const block = [
      'try {',
      '  risky();',
      '} catch {',
      '  /* see the { section',
      '     of the docs */',
      '  return undefined;',
      '}',
      '',
      '// allow-fallback: about something else entirely',
      'cache.clear();',
      '',
    ].join('\n');
    const { status } = writeThrough(block);

    expect(status, "a block comment's brace let a foreign marker excuse the catch").toBe(2);
  });

  it('a brace inside a regex CHARACTER CLASS does not hold the block open', () => {
    // /[{]/ is prose to the block structure; counting its brace kept depth from closing.
    const regexClass = [
      'try {',
      '  risky();',
      '} catch {',
      '  if (/[{]/.test(x)) mark();',
      '  return undefined;',
      '}',
      '',
      '// allow-fallback: about something else entirely',
      'cache.clear();',
      '',
    ].join('\n');
    const { status } = writeThrough(regexClass);

    expect(status, "a character class's brace let a foreign marker excuse the catch").toBe(2);
  });

  it('still accepts a marked catch whose body quotes a brace', () => {
    const marked = `try {
  risky();
} catch {
  // allow-fallback: reason, body logs a brace
  logger.warn("missing key {");
  return undefined;
}
`;
    const { status, output } = writeThrough(marked);

    expect(status, `the quoted brace broke a correctly marked body:\n${output}`).toBe(0);
  });

  it('does not let a marker AFTER the block end excuse the catch, even inside the window', () => {
    // A catch shorter than the look-ahead window ends before the window does. A marker attached
    // to whatever unrelated code follows the closing brace is inside the window but outside the
    // block — the CI authority matches braces and refuses it, so the hook must too, or the hook
    // passes what CI then blocks.
    const past = `try {
  risky();
} catch {
  return undefined;
}

// allow-fallback: unrelated note about the cache below
cache.clear();
`;
    const { status } = writeThrough(past);

    expect(status, 'a marker past the closing brace excused the catch').toBe(2);
  });
});
