import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { pathWithout } from './helpers/path-without.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');
// `hook-facts.sh`, not `command-scan.sh`: it sources the other, so one probe reaches all three
// readers — and whether `hook_json_text` still answers as `hook_json_string` does is exactly the
// invariant that stops them forking again.
const LIB = path.join(HOOKS_DIR, 'lib/hook-facts.sh');

/**
 * INFRA-081 (#1574) — one reader, one answer, whatever the host happens to have installed.
 *
 * `hook_json_string` had two implementations of one question, picked by `command -v`. They agreed on
 * the shape that actually arrives and disagreed on every other, and the disagreement reached a
 * VERDICT: measured on `branch-guard.sh` against a scratch repository, same payload both times,
 * only `PATH` differing, `{"tool_input":{"command":{"a":"git push origin main"}}}` exited 0 with jq
 * installed and 2 without. One host permitted and the other refused, and neither answer was reached
 * by a decision.
 *
 * The cases below are written against the READERS and against a real hook's VERDICT, because
 * #1572 exists precisely because a corpus that measures a function says nothing about whether the
 * guards consult it.
 *
 * Ten of the seventeen shapes below disagreed before the fix. They are not all exotic: the trailing
 * newline `jq -r` appends and python3 does not is on EVERY read, including `tool_name` and the
 * ordinary string command.
 */

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  scratch.push(dir);
  return dir;
}

const noJq = pathWithout(['jq']);

/**
 * The probe writes the exit status on its own first line and then the reader's output BYTE FOR
 * BYTE, so a difference of one trailing newline is a difference this case can see. Comparing
 * `$(…)`-captured values would have hidden it, because command substitution strips exactly that.
 *
 * The payload reaches the probe through the ENVIRONMENT, never interpolated into a command line: a
 * JSON document is full of quotes and braces, and building one into a shell string is how a probe
 * ends up measuring its own quoting instead of the function.
 */
const PROBE = path.join(scratchDir('json-reader-probe-'), 'probe.sh');
writeFileSync(
  PROBE,
  [
    'source "$1"',
    'out=$(mktemp)',
    'case "$2" in',
    '  string) hook_json_string "$PAYLOAD" "$3" > "$out" ;;',
    '  text) hook_json_text "$PAYLOAD" "$3" > "$out" ;;',
    '  *) hook_edit_content_of "$PAYLOAD" > "$out" ;;',
    'esac',
    'rc=$?',
    'printf \'%s\\n\' "$rc"',
    'cat "$out"',
    'rm -f "$out"',
    '',
  ].join('\n'),
);

function read(payload, reader, field, env = {}) {
  const result = spawnSync('/bin/bash', [PROBE, LIB, reader, field], {
    encoding: 'utf8',
    env: { ...process.env, PAYLOAD: JSON.stringify(payload), ...env },
  });
  return result.stdout ?? '';
}

/** Every shape below is a JSON document a payload could carry, not a shape invented for the test. */
const SHAPES = [
  [
    'command as a string — the shape that really arrives',
    { tool_input: { command: 'git push' } },
    'string',
    'tool_input.command',
  ],
  [
    'command as an object',
    { tool_input: { command: { a: 'git push origin main' } } },
    'string',
    'tool_input.command',
  ],
  ['command as a number', { tool_input: { command: 123 } }, 'string', 'tool_input.command'],
  [
    'command as an array',
    { tool_input: { command: ['git', 'push'] } },
    'string',
    'tool_input.command',
  ],
  ['command as null', { tool_input: { command: null } }, 'string', 'tool_input.command'],
  ['command absent', { tool_input: {} }, 'string', 'tool_input.command'],
  ['the path walks through a non-object', { tool_input: 'x' }, 'string', 'tool_input.command'],
  ['the path walks through an array', { tool_input: ['x'] }, 'string', 'tool_input.command'],
  ['the whole payload is an array', ['x'], 'string', 'tool_input.command'],
  ['tool_name as a string', { tool_name: 'Bash' }, 'string', 'tool_name'],
  ['cwd absent', { tool_name: 'Bash' }, 'string', 'cwd'],
  ['content as a string', { tool_input: { content: 'x' } }, 'content', ''],
  [
    'content as a number, with a real new_string beside it',
    { tool_input: { content: 5, new_string: 'real' } },
    'content',
    '',
  ],
  [
    'an edit whose new_string is not a string',
    { tool_input: { edits: [{ new_string: 'a' }, { new_string: 7 }] } },
    'content',
    '',
  ],
  ['edits that is not a list', { tool_input: { edits: 'nope' } }, 'content', ''],
  ['tool_input that is not an object', { tool_input: 'nope' }, 'content', ''],
  [
    'edits as they normally arrive',
    { tool_input: { edits: [{ new_string: 'a' }, { new_string: 'b' }] } },
    'content',
    '',
  ],
];

describe('a JSON field reads the same whether or not jq is installed (INFRA-081)', () => {
  it('the farm hides jq and keeps python3', () => {
    // Stated because every case below is vacuous if the farm is wrong: with jq still reachable both
    // sides would run the same arm and agree for the wrong reason.
    expect(
      spawnSync('/bin/bash', ['-c', 'command -v jq'], { env: { PATH: noJq } }).status,
    ).not.toBe(0);
    expect(
      spawnSync('/bin/bash', ['-c', 'command -v python3'], { env: { PATH: noJq } }).status,
    ).toBe(0);
    expect(spawnSync('/bin/bash', ['-c', 'command -v jq']).status).toBe(0);
  });

  for (const [name, payload, reader, field] of SHAPES) {
    it(name, () => {
      expect(read(payload, reader, field, { PATH: noJq })).toBe(read(payload, reader, field));
    });
  }

  it('reads the ordinary string command as itself, so the agreement is not agreement on nothing', () => {
    // A reader that returned "" for everything would satisfy every case above. This one pins the
    // answer, not just its consistency.
    const payload = { tool_input: { command: 'git push origin main' } };
    expect(read(payload, 'string', 'tool_input.command')).toBe('0\ngit push origin main');
    expect(read(payload, 'string', 'tool_input.command', { PATH: noJq })).toBe(
      '0\ngit push origin main',
    );
  });

  it('gives `hook_json_text` and `hook_json_string` the same answer for every shape', () => {
    // The two readers were two implementations of one rule, in two files, because #1566 could not
    // reach the one it needed. #1574 gave that rule a single owner and left `hook_json_text` as the
    // NAME four hooks call. This case is what stops them forking again — it compares the readers
    // themselves, on both hosts, over the shapes that used to tell them apart.
    for (const [name, payload, reader, field] of SHAPES) {
      if (reader !== 'string') continue;
      expect(read(payload, 'text', field), name).toBe(read(payload, 'string', field));
      expect(read(payload, 'text', field, { PATH: noJq }), name).toBe(
        read(payload, 'string', field, { PATH: noJq }),
      );
    }
  });

  it('answers "" for a field that is not a string, on both hosts', () => {
    // The DECISION, pinned. A field that is not a string is not that field — the rule
    // `hook_json_text` already states for the text fields, rather than a second rule for this one.
    // The verdict stays fail-closed because the CALLER names what empty means for it, which is the
    // reader/caller split `hook-facts.sh` states: `hook_command_of` refuses an empty command.
    const payload = { tool_input: { command: { a: 'git push origin main' } } };
    expect(read(payload, 'string', 'tool_input.command')).toBe('0\n');
    expect(read(payload, 'string', 'tool_input.command', { PATH: noJq })).toBe('0\n');
  });
});

describe('the VERDICT of a real guard does not depend on the installed tool (INFRA-081)', () => {
  function repoOn(branch) {
    const dir = path.join(scratchDir('json-reader-repo-'), 'repo');
    mkdirSync(dir, { recursive: true });
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    git('init', '--quiet', `--initial-branch=${branch}`);
    git('config', 'user.email', 'harness@example.test');
    git('config', 'user.name', 'Harness');
    git('commit', '--quiet', '--allow-empty', '-m', 'chore: root');
    return dir;
  }

  function branchGuard(command, cwd, env = {}) {
    const result = spawnSync('/bin/bash', [path.join(HOOKS_DIR, 'branch-guard.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
    });
    return result.status ?? 1;
  }

  it('refuses a command it cannot read as a command, with jq and without it', () => {
    // The measured divergence, end to end. `command` arrives as an OBJECT: with jq the guard used to
    // receive that object pretty-printed, whose `git push` sits inside quotes, so the tokenizer
    // masked it as data, no verb was found, and the call was ALLOWED. Without jq the guard refused.
    const repo = repoOn('main');
    expect(branchGuard({ a: 'git push origin main' }, repo)).toBe(2);
    expect(branchGuard({ a: 'git push origin main' }, repo, { PATH: noJq })).toBe(2);
  });

  it('still refuses the bare control and still permits ordinary work, on both hosts', () => {
    // Controls, so the case above is not "this guard refuses everything now".
    const onMain = repoOn('main');
    expect(branchGuard('git push origin main', onMain)).toBe(2);
    expect(branchGuard('git push origin main', onMain, { PATH: noJq })).toBe(2);

    const onFeature = repoOn('feat/x');
    expect(branchGuard('git commit -m "ordinary work"', onFeature)).toBe(0);
    expect(branchGuard('git commit -m "ordinary work"', onFeature, { PATH: noJq })).toBe(0);
  });
});
