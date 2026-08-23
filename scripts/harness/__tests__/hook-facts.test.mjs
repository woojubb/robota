import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

// One owner for the farm too. Both this file and `hook-json-reader-agrees.test.mjs` need "a PATH
// where jq genuinely does not exist", and a second copy of the thing that decides WHICH ARM RUNS,
// in a directory whose subject is one-rule-not-one-per-tool, is the defect wearing the fix.
import { pathWithout } from './helpers/path-without.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');
const FACTS_LIB = path.join(HOOKS_DIR, 'lib/hook-facts.sh');

/**
 * One owner for each fact a hook computes (INFRA-077).
 *
 * An audit of `.claude/hooks/**` on 2026-08-01 ran every hook against scratch repositories and
 * found five facts computed by separate code in two or more hooks, with the copies DISAGREEING.
 * Each disagreement below was measured, and none of them was visible to the suite as it stood: no
 * test set `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_PREFIX` for any hook invocation, none
 * ran a hook with `jq` absent, and none fed an escaped or backslashed path. The three gaps are the
 * first three cases here, because a consolidation that lands without them lands unproven.
 *
 * The five facts, and what disagreeing about each one cost:
 *
 *   1. the payload's `file_path` — hand-rolled `grep -o '"file_path"…"[^"]*"'` truncates at the
 *      first escaped quote, so a file whose name contains one is silently never formatted.
 *   2. reading a JSON field at all — three hooks carry a `read_json()` with jq and no python3
 *      fallback, so on a host without jq half the hooks go silently off while the rest keep working.
 *   3. which repository the command acts on — four resolutions under two rules. The validating one
 *      validates with a BARE `git -C`, which an exported `GIT_DIR` makes answer "yes" for any
 *      directory that exists, so the guard adopts a non-repository as the repo it judges.
 *   4. the current branch — `git branch --show-current` exits 0 with EMPTY output on a detached
 *      HEAD, so every `|| echo unknown` in this directory is dead code and detached sessions log "".
 *   5. git invoked with a scrubbed environment — two hooks scrub, ~20 bare `git -C` call sites do
 *      not, so with `GIT_DIR` exported a guard reads the OUTER repository's branch and waves
 *      through the very commit it exists to refuse.
 *
 * Two divergences are DELIBERATE and must survive as named modes rather than be flattened:
 * `worktree-cwd-guard` resolves first-non-empty (a fail-safe: it would rather name nothing and not
 * block than validate its way onto a repository the command does not run in), and `branch-guard`'s
 * base check deliberately ignores `git -C` because a branch lands where the session is. Both are
 * pinned below so unifying them breaks loudly.
 */

/** Scratch trees created during the run, removed in `afterAll` so probes leave no litter. */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix) {
  const dir = realpathSync(makeTemp(prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A throwaway repository on a named branch.
 *
 * Never the real working tree: these probes make guards run their real work against whatever they
 * resolve, and the verdict would otherwise depend on a developer's local state.
 */
function initRepo(dir, branch) {
  mkdirSync(dir, { recursive: true });
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

/**
 * `spawnSync`, not `execFileSync`: hooks speak on stderr, and `execFileSync`'s success path returns
 * stdout only — a hook that spoke and exited 0 would read as silence.
 */
function runHook(hookFile, payload, { cwd = WORKSPACE_ROOT, env = {} } = {}) {
  const result = spawnSync('/bin/bash', [path.join(HOOKS_DIR, hookFile)], {
    input: JSON.stringify(payload),
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Run a snippet against the shared fact library, the way a hook uses it. */
function runLib(snippet, env = {}) {
  const result = spawnSync(
    '/bin/bash',
    ['-c', `set -euo pipefail\nsource "${FACTS_LIB}"\n${snippet}`],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

/** Hook sources, comments stripped, for the "nobody hand-rolls this any more" assertions. */
function hookSourcesWithoutComments() {
  return readdirSync(HOOKS_DIR)
    .filter((name) => name.endsWith('.sh'))
    .map((name) => ({
      name,
      text: readFileSync(path.join(HOOKS_DIR, name), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n'),
    }));
}

describe('fact 1 — the payload file_path has one reader', () => {
  /**
   * Signal: the PostToolUse payload's `tool_input.file_path`, sent by the tool host on every
   * Write/Edit. `post-tool-format` read it with `grep -o '"file_path"…"[^"]*"'`, which stops at the
   * first escaped quote, so `/tmp/a b/we"ird.ts` was read as `/tmp/a b/we\` — a path that does not
   * exist, so the hook exited at its `-f` test and the file was never formatted. Silently: the hook
   * exits 0 either way, which is why nothing noticed.
   *
   * `npx` is shimmed rather than left real, so the case asserts WHICH PATH the hook forwards
   * instead of whether prettier happened to change the file.
   */
  function formatterProbe(fileName) {
    const projectDir = scratchDir('hook-facts-fmt-');
    const shimDir = scratchDir('hook-facts-shim-');
    const log = path.join(shimDir, 'npx.log');
    writeFileSync(
      path.join(shimDir, 'npx'),
      `#!/bin/bash\nprintf '%s\\n' "$@" >> ${JSON.stringify(log)}\n`,
      {
        mode: 0o755,
      },
    );
    const target = path.join(projectDir, fileName);
    writeFileSync(target, '# heading\n');
    const run = runHook(
      'post-tool-format.sh',
      { tool_name: 'Write', tool_input: { file_path: target } },
      {
        cwd: projectDir,
        env: { CLAUDE_PROJECT_DIR: projectDir, PATH: `${shimDir}:${process.env.PATH}` },
      },
    );
    let forwarded = '';
    try {
      forwarded = readFileSync(log, 'utf8');
    } catch {
      forwarded = '';
    }
    return { run, forwarded, target };
  }

  it('forwards an ordinary path to the formatter', () => {
    // The control. Without it a green "quoted path" case could mean the shim never ran at all.
    const { forwarded, target } = formatterProbe('plain.md');
    expect(forwarded).toContain(target);
  });

  it('forwards a path whose name contains an escaped quote', () => {
    const { forwarded, target } = formatterProbe('we"ird.md');
    expect(forwarded).toContain(target);
  });

  it('forwards a path whose name contains a backslash', () => {
    const { forwarded, target } = formatterProbe('back\\slash.md');
    expect(forwarded).toContain(target);
  });

  it('leaves no hook hand-rolling a file_path grep', () => {
    const offenders = hookSourcesWithoutComments()
      .filter(({ text }) => /grep[^\n]*"file_path"/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

describe('fact 2 — reading a JSON field has one reader', () => {
  /**
   * Signal: the UserPromptSubmit payload, sent by the tool host on every user turn. Three hooks
   * carried an identical `read_json()` that calls `jq` and has no python3 fallback, while
   * `lib/command-scan.sh` — which the Bash guards use — falls back. On a host without jq the two
   * halves of this directory therefore disagree about whether the payload is readable at all:
   * `branch-guard` keeps guarding and `spec-first-gate` prints nothing.
   */
  const noJq = pathWithout(['jq']);

  it('the farm hides jq and keeps python3', () => {
    // Stated because every case below is vacuous if the farm is wrong.
    expect(
      spawnSync('/bin/bash', ['-c', 'command -v jq'], { env: { PATH: noJq } }).status,
    ).not.toBe(0);
    expect(
      spawnSync('/bin/bash', ['-c', 'command -v python3'], { env: { PATH: noJq } }).status,
    ).toBe(0);
  });

  it('spec-first-gate still injects the SPEC-GATE reminder without jq', () => {
    const run = runHook(
      'spec-first-gate.sh',
      { prompt: 'please implement a new command for the CLI', session_id: 'user-1' },
      { env: { PATH: noJq } },
    );
    expect(run.output).toContain('SPEC-GATE');
  });

  it('correction-detect still records a correction without jq', () => {
    const projectDir = scratchDir('hook-facts-corr-');
    runHook(
      'correction-detect.sh',
      { prompt: 'no, not that — try again', session_id: 'user-1' },
      { env: { PATH: noJq, CLAUDE_PROJECT_DIR: projectDir } },
    );
    const log = path.join(projectDir, '.agents/evals/local-metrics/corrections.jsonl');
    const line = readFileSync(log, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line)).toMatchObject({ pattern: 'user-correction', session_id: 'user-1' });
  });

  it('eval-log-stop still records a session without jq', () => {
    // It carried no `read_json()`, so the floor below does not see it — and it read `.session_id`
    // with a bare `jq -r` and wrote its record with `jq -cn` all the same. Same defect, different
    // spelling, which is why this case is executed rather than inferred from the floor.
    const dir = initRepo(path.join(scratchDir('hook-facts-eval-'), 'repo'), 'feature/work');
    runHook(
      'eval-log-stop.sh',
      { session_id: 'user-1' },
      {
        cwd: dir,
        env: { PATH: noJq, CLAUDE_PROJECT_DIR: dir, ROBOTA_DISABLE_LESSONS_DIGEST: '1' },
      },
    );
    const log = path.join(dir, '.agents/evals/local-metrics/sessions.jsonl');
    const line = readFileSync(log, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line)).toMatchObject({ branch: 'feature/work', session_id: 'user-1' });
  });

  /**
   * The payload is handed to the snippet through the ENVIRONMENT, never interpolated into the
   * command line: a JSON document is full of quotes and braces, and building one into a shell
   * string is how a probe ends up measuring its own quoting instead of the function.
   */
  function promptOf(payload, env = {}) {
    return runLib('printf "%s" "$(hook_prompt_of "$PAYLOAD")"', {
      PAYLOAD: JSON.stringify(payload),
      ...env,
    }).stdout;
  }

  it('reads a prompt to the same answer whether or not jq is installed', () => {
    // The reported finding one function to the left, and the same class this file exists for.
    // `hook_json_string`'s two arms USED TO DISAGREE on a field that is not a string: measured,
    // `jq -r` on `{"message": {...}}` printed the object's pretty-printed JSON while the python3 arm
    // wrote "". So `hook_prompt_of` returned a JSON blob as "the user's prompt" on a host with jq and
    // nothing on a host without — and `{"message": {"role": …, "content": …}}` is the ordinary
    // transcript shape, not an exotic one. correction-detect would then grep a JSON blob for
    // correction keywords and log it as `prompt_excerpt`; spec-first-gate would scan it for
    // implementation intent. A structured node is not prompt TEXT, so the answer is "" — on both
    // hosts. INFRA-081 (#1574) closed that in `hook_json_string` itself; this case stays because the
    // property it pins is the reader's contract, not the history of one defect.
    const payload = { message: { role: 'user', content: 'hello' } };
    const withJq = promptOf(payload);
    const withoutJq = promptOf(payload, { PATH: noJq });
    expect(withJq).toBe(withoutJq);
    expect(withJq).toBe('');
  });

  it('reads a file_path to the same answer whether or not jq is installed', () => {
    // The sibling reader, asked the same question. Every field this directory reads as TEXT is read
    // the same way on both hosts, so the rule is one rule rather than one-per-function.
    const payload = { tool_input: { file_path: 123 } };
    const read = (env) =>
      runLib('printf "%s" "$(hook_file_path_of "$PAYLOAD")"', {
        PAYLOAD: JSON.stringify(payload),
        ...env,
      }).stdout;
    expect(read({})).toBe(read({ PATH: noJq }));
    expect(read({})).toBe('');
  });

  it('takes the first key that carries TEXT, not the first key that is present', () => {
    // DECIDED, not inherited. jq's `//` yields the left operand whenever it is neither null nor
    // false — an empty string is truthy there — so `.prompt // .user_prompt` on
    // `{"prompt": "", "user_prompt": "hello"}` returned "" and this returns "hello". Measured, and
    // that payload is the only shape that tells the two rules apart.
    //
    // Fall-through is kept, for a reason the reader can check: `hook_json_string` CANNOT express
    // jq's distinction. Measured on both arms, it returns "" with exit 0 for an absent key and for
    // a present-but-empty one alike, so reproducing `//` exactly would mean adding a
    // presence-distinguishing reader whose only consumer is a payload shape no host emits. And of
    // the two rules, "the first key that carries text" is the one that never goes blind on text
    // that is plainly there — which is the failure this whole change exists to remove.
    expect(promptOf({ prompt: '', user_prompt: 'hello' })).toBe('hello');
    expect(promptOf({ prompt: '', user_prompt: '', message: 'hi' })).toBe('hi');
    expect(promptOf({ prompt: 'first', user_prompt: 'second' })).toBe('first');
    expect(promptOf({})).toBe('');
  });

  it('memory-mirror-reminder still fires for a memory path with a quote in it, without jq', () => {
    // Fact 1's SECOND hook, executed rather than inferred from the source-level floor. Its jq arm
    // was right and the "tolerant grep" beside it was not, so on a host without jq a memory file
    // named with a quote was read as a truncated path, matched none of its cases, and the reminder
    // never printed — the only thing this hook does.
    const run = runHook(
      'memory-mirror-reminder.sh',
      {
        tool_name: 'Write',
        tool_input: { file_path: '/home/t/.claude/projects/x/memory/we"ird.md' },
      },
      { env: { PATH: noJq } },
    );
    expect(run.output).toContain('MEMORY MIRRORING');
  });

  it('revert-detect still records a fix-or-revert commit without jq', () => {
    // Fact 2's third hook. Its git-history signal needs no transcript, so this reaches the record
    // writer — which was `jq -cn` and therefore wrote nothing at all on a host without jq.
    const dir = initRepo(path.join(scratchDir('hook-facts-revert-'), 'repo'), 'feature/work');
    writeFileSync(path.join(dir, 'patch.txt'), 'x\n');
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'fix: something that regressed'], {
      encoding: 'utf8',
    });
    runHook(
      'revert-detect.sh',
      { session_id: 'user-1' },
      { cwd: dir, env: { PATH: noJq, CLAUDE_PROJECT_DIR: dir } },
    );
    const log = path.join(dir, '.agents/evals/local-metrics/reverts.jsonl');
    const line = readFileSync(log, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line)).toMatchObject({
      pattern: 'fix-or-revert-commit',
      session_id: 'user-1',
    });
  });

  it('check-forbidden-patterns still records the block it just made, without jq', () => {
    // The fourth hook with a `jq -cn` writer, and the one where losing the record is worst: it
    // REFUSES the edit either way, so without jq the refusal happened and the evidence for it did
    // not. A block nobody can count is a block nobody can review.
    const projectDir = scratchDir('hook-facts-forbidden-');
    const target = path.join(projectDir, 'packages/p/src/a.ts');
    mkdirSync(path.dirname(target), { recursive: true });
    const run = runHook(
      'check-forbidden-patterns.sh',
      {
        tool_name: 'Write',
        session_id: 'user-1',
        tool_input: {
          file_path: target,
          content: 'try {\n  go();\n} catch (e) {\n  return null;\n}\n',
        },
      },
      { cwd: projectDir, env: { PATH: noJq, CLAUDE_PROJECT_DIR: projectDir } },
    );
    expect(run.status).toBe(2);
    const log = path.join(projectDir, '.agents/evals/local-metrics/blocks.jsonl');
    const line = readFileSync(log, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line)).toMatchObject({ pattern: 'try-catch-fallback', session_id: 'user-1' });
  });

  it('leaves no hook reading a payload field with a bare jq call', () => {
    const offenders = hookSourcesWithoutComments()
      .filter(({ text }) => /read_json\(\)/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

describe('fact 3 — which repository the command acts on', () => {
  /**
   * Four resolutions under two rules. They are consolidated into ONE function with NAMED MODES,
   * because two of the divergences are deliberate and flattening them would remove a fail-safe.
   */
  function repos() {
    const root = scratchDir('hook-facts-repo-');
    const session = initRepo(path.join(root, 'session'), 'main');
    const other = initRepo(path.join(root, 'other'), 'feature/other');
    const plain = path.join(root, 'plain');
    mkdirSync(plain, { recursive: true });
    return { root, session, other, plain };
  }

  it('the validated mode rejects a git -C target that is not a work tree', () => {
    const { session, plain } = repos();
    const got = runLib(`hook_effective_repo validated "${plain}" "${session}" "${session}"`);
    expect(got.stdout).toBe(session);
  });

  it('the validated mode is not fooled by an ambient GIT_DIR', () => {
    // The measured defect: `git -C <any existing dir> rev-parse --is-inside-work-tree` exits 0 when
    // GIT_DIR is exported, so the bare validation in branch-guard and pre-push-check answered "yes"
    // for a directory that is not a repository at all.
    const { session, other, plain } = repos();
    const got = runLib(`hook_effective_repo validated "${plain}" "${session}" "${session}"`, {
      GIT_DIR: path.join(other, '.git'),
      GIT_WORK_TREE: other,
    });
    expect(got.stdout).toBe(session);
  });

  it('the first-nonempty mode keeps worktree-cwd-guard fail-safe: it names the -C target unvalidated', () => {
    // DELIBERATE divergence, pinned so unifying it breaks loudly. worktree-cwd-guard would rather
    // name a directory it cannot resolve — and then decline to block — than validate its way onto
    // the session repository and block a destructive command aimed somewhere else entirely.
    const { session } = repos();
    const got = runLib(
      `hook_effective_repo first-nonempty "/no/such/dir" "${session}" "${session}"`,
    );
    expect(got.stdout).toBe('/no/such/dir');
  });

  it('the session mode ignores git -C, which is where branch-guard reads a branch base', () => {
    // DELIBERATE divergence: a branch is created where the session is, so a `-C` belonging to some
    // other invocation in the same compound command must not redirect the base check.
    const { session, other } = repos();
    const got = runLib(`hook_effective_repo session "${other}" "${session}" "${session}"`);
    expect(got.stdout).toBe(session);
  });

  it('branch-guard judges the session repository when the -C target is not a repository', () => {
    const { session, other, plain } = repos();
    const run = runHook(
      'branch-guard.sh',
      {
        tool_name: 'Bash',
        cwd: session,
        tool_input: { command: `git -C ${plain} commit -m "chore: x"` },
      },
      {
        cwd: session,
        env: {
          CLAUDE_PROJECT_DIR: session,
          GIT_DIR: path.join(other, '.git'),
          GIT_WORK_TREE: other,
        },
      },
    );
    expect(run.status).toBe(2);
    expect(run.output).toContain('protected branch');
  });

  it('branch-guard refuses a commit when no repository can be read at all', () => {
    // A guard fails CLOSED. When the fact it judges cannot be read, "I verified this is fine" and
    // "I could not verify" are the two states it must never conflate — and it did: with nothing
    // resolvable, the branch came back empty and the hook exited 0, which the hook protocol reads
    // as a pass. A detached HEAD is the case that looks identical and is NOT this one: there the
    // repository is readable and the branch is genuinely nameless, so it still falls through.
    const plain = scratchDir('hook-facts-norepo-');
    const run = runHook(
      'branch-guard.sh',
      { tool_name: 'Bash', cwd: plain, tool_input: { command: 'git commit -m "chore: x"' } },
      { cwd: plain, env: { CLAUDE_PROJECT_DIR: plain } },
    );
    expect(run.status).toBe(2);
    expect(run.output).toContain('no git repository');
  });

  it('branch-guard still falls through on a detached HEAD, which is readable and nameless', () => {
    const dir = initRepo(path.join(scratchDir('hook-facts-detach-'), 'repo'), 'main');
    writeFileSync(path.join(dir, 'second.txt'), 'x\n');
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'chore: second'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'checkout', '--quiet', '--detach'], { encoding: 'utf8' });
    const run = runHook(
      'branch-guard.sh',
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'git commit -m "chore: x"' } },
      { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } },
    );
    expect(run.status).toBe(0);
  });

  it('pre-push-check refuses a push when no repository can be read at all', () => {
    // The SIBLING of the case above, and the failure this whole change exists to end: a fact fixed
    // in one hook and not in the one beside it. branch-guard learned to refuse an unreadable
    // repository; pre-push-check took the same `validated` resolution and the same branch reader and
    // did not, so `CUR_BRANCH` came back "" for BOTH a detached HEAD and "not a repository at all"
    // and the `""` arm of its hygiene switch — written for the first — silently skipped the
    // foreign-merge check for the second. The lockfile check further down then refused anyway and
    // named pnpm-lock.yaml: a refusal that misstates why, after a check that never ran.
    const plain = scratchDir('hook-facts-push-norepo-');
    const run = runHook(
      'pre-push-check.sh',
      { tool_name: 'Bash', cwd: plain, tool_input: { command: 'git push -u origin feat/probe' } },
      { cwd: plain, env: { CLAUDE_PROJECT_DIR: plain } },
    );
    expect(run.status).toBe(2);
    expect(run.output).toContain('no git repository');
    expect(run.output).not.toContain('pnpm-lock.yaml');
  });

  it('pre-push-check still falls through on a detached HEAD, which is readable and nameless', () => {
    // Pinned so the refusal above cannot drift into swallowing this. A detached HEAD has a readable
    // repository and no branch name, and this hook has its OWN considered answer for it further
    // down — a refusal keyed to the missing review record. The new refusal must not reach it first.
    const dir = initRepo(path.join(scratchDir('hook-facts-push-detach-'), 'repo'), 'main');
    writeFileSync(path.join(dir, 'second.txt'), 'x\n');
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'chore: second'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'checkout', '--quiet', '--detach'], { encoding: 'utf8' });
    const run = runHook(
      'pre-push-check.sh',
      { tool_name: 'Bash', cwd: dir, tool_input: { command: 'git push -u origin feat/probe' } },
      { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir } },
    );
    expect(run.output).not.toContain('no git repository');
    expect(run.output).toContain('detached HEAD');
  });

  it('leaves no hook hand-rolling the work-tree validation ladder', () => {
    const offenders = hookSourcesWithoutComments()
      .filter(({ text }) => /rev-parse --is-inside-work-tree/.test(text))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

describe('fact 4 — the current branch, with the default on the VALUE', () => {
  /**
   * `git branch --show-current` exits 0 and prints NOTHING on a detached HEAD, so every
   * `$(git branch --show-current || echo unknown)` in this directory is dead code: the `||` arm
   * never runs and the caller gets "". `eval-log-stop` logged `"branch": ""` for every detached
   * session as a result.
   */
  function detachedRepo() {
    const dir = initRepo(path.join(scratchDir('hook-facts-head-'), 'repo'), 'main');
    writeFileSync(path.join(dir, 'second.txt'), 'x\n');
    spawnSync('git', ['-C', dir, 'add', '-A'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'commit', '--quiet', '-m', 'chore: second'], { encoding: 'utf8' });
    spawnSync('git', ['-C', dir, 'checkout', '--quiet', '--detach'], { encoding: 'utf8' });
    return dir;
  }

  it('applies the caller-named default when the value is empty', () => {
    const dir = detachedRepo();
    expect(runLib(`hook_current_branch "${dir}" unknown`).stdout).toBe('unknown');
  });

  it('lets a caller ask for the empty value, which is how a guard detects a detached HEAD', () => {
    // branch-guard and pre-push-check both KEY on emptiness to recognise a detached HEAD, so the
    // default is the caller's to name, not the function's to impose.
    const dir = detachedRepo();
    expect(runLib(`printf '[%s]' "$(hook_current_branch "${dir}" "")"`).stdout).toBe('[]');
  });

  it('eval-log-stop records a named branch for a detached session', () => {
    const dir = detachedRepo();
    runHook(
      'eval-log-stop.sh',
      { session_id: 'user-1' },
      { cwd: dir, env: { CLAUDE_PROJECT_DIR: dir, ROBOTA_DISABLE_LESSONS_DIGEST: '1' } },
    );
    const log = path.join(dir, '.agents/evals/local-metrics/sessions.jsonl');
    const line = readFileSync(log, 'utf8').trim().split('\n').at(-1);
    expect(JSON.parse(line).branch).not.toBe('');
  });
});

describe('fact 5 — git runs with a scrubbed environment', () => {
  /**
   * `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and `GIT_PREFIX` outrank `-C`: with `GIT_DIR`
   * exported, `git -C <scratch> branch --show-current` reports the OUTER repository's branch. Two
   * hooks scrubbed it through a `git_project()` copied byte-for-byte between them; every guard did
   * not. So a guard could read one repository's branch while judging another's command — and a
   * commit on `main` walked past the guard that exists to refuse it.
   */
  function pair() {
    const root = scratchDir('hook-facts-env-');
    return {
      session: initRepo(path.join(root, 'session'), 'main'),
      elsewhere: initRepo(path.join(root, 'elsewhere'), 'feature/elsewhere'),
      root,
    };
  }

  it('branch-guard still refuses a commit on main when GIT_DIR names another repository', () => {
    const { session, elsewhere } = pair();
    const run = runHook(
      'branch-guard.sh',
      { tool_name: 'Bash', cwd: session, tool_input: { command: 'git commit -m "chore: x"' } },
      {
        cwd: session,
        env: {
          CLAUDE_PROJECT_DIR: session,
          GIT_DIR: path.join(elsewhere, '.git'),
          GIT_WORK_TREE: elsewhere,
        },
      },
    );
    expect(run.status).toBe(2);
    expect(run.output).toContain('protected branch');
  });

  it('branch-guard still refuses a push on main when GIT_INDEX_FILE and GIT_PREFIX are exported', () => {
    const { session, elsewhere } = pair();
    const run = runHook(
      'branch-guard.sh',
      { tool_name: 'Bash', cwd: session, tool_input: { command: 'git push origin main' } },
      {
        cwd: session,
        env: {
          CLAUDE_PROJECT_DIR: session,
          GIT_DIR: path.join(elsewhere, '.git'),
          GIT_WORK_TREE: elsewhere,
          GIT_INDEX_FILE: path.join(elsewhere, '.git/index'),
          GIT_PREFIX: '',
        },
      },
    );
    expect(run.status).toBe(2);
    expect(run.output).toContain('protected branch');
  });

  it('worktree-cwd-guard still sees the MAIN checkout when GIT_DIR names a worktree', () => {
    const root = scratchDir('hook-facts-wt-');
    const main = initRepo(path.join(root, 'main-clone'), 'main');
    const worktree = initRepo(path.join(root, '.claude/worktrees/wt'), 'feat/wt');
    const run = runHook(
      'worktree-cwd-guard.sh',
      { tool_name: 'Bash', cwd: main, tool_input: { command: 'git reset --hard' } },
      {
        cwd: main,
        env: {
          CLAUDE_PROJECT_DIR: main,
          ROBOTA_AGENT_WORKTREE: worktree,
          GIT_DIR: path.join(worktree, '.git'),
          GIT_WORK_TREE: worktree,
        },
      },
    );
    expect(run.status).toBe(2);
    // The REASON changed, and the case says which one it now is. This fixture builds two independent
    // repositories, so the ambient `GIT_DIR` names a DIFFERENT one — and that block runs first,
    // because deferring it to the main-checkout judgement below was a measured bypass: that block
    // resolves its directory with the scrub, so it can never see a redirect. The scrub property this
    // case exists for is still what makes the refusal correct; it is now reported by the block that
    // can actually see the redirect.
    //
    // Named exactly, not as an alternation. Review pointed out that `/DIFFERENT repository|MAIN
    // checkout/` still passes if the deferral comes back: the ambient block would be skipped and the
    // main-checkout block would answer instead, and the OR accepts that answer. The whole point of
    // this case is WHICH block refused, so it asserts that and nothing else.
    expect(run.output).toMatch(/DIFFERENT repository/);
  });

  it('leaves no hook calling git without the scrub', () => {
    // Message lines are excluded: `echo "… git -C <path> …"` is advice printed to a human, not an
    // invocation, and refusing it would push the fix into rewording refusals rather than call sites.
    const offenders = hookSourcesWithoutComments()
      .filter(({ text }) =>
        text
          .split('\n')
          .some((line) => /\bgit\s+-C\b/.test(line) && !/^\s*(echo|printf|cat)\b/.test(line)),
      )
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});
