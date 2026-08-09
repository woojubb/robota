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
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/check-forbidden-patterns.sh');

function writeThrough(content) {
  const payload = JSON.stringify({
    tool_name: 'Write',
    cwd: WORKSPACE_ROOT,
    tool_input: { file_path: path.join(WORKSPACE_ROOT, 'packages/x/src/probe.ts'), content },
  });
  const result = spawnSync('bash', [HOOK], { input: payload, encoding: 'utf8' });
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

  it('does not let a marker BEYOND the judged window excuse the catch', () => {
    // The marker is read within the same 6-line window the fallback judgement reads, so the two
    // readings cannot disagree about scope — a marker further away is a comment about something else.
    const far = `try {
  risky();
} catch {
  a();
  b();
  c();
  d();
  e();
  f();
  // allow-fallback: too far away to be about this catch
  return undefined;
}
`;
    const { status } = writeThrough(far);

    expect(status, 'a distant marker excused the catch').toBe(2);
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
