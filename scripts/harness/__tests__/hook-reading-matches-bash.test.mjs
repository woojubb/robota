import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

// The corpus is a MODULE now (#1572). It lived in this file, where exactly one consumer could reach
// it — and that consumer measured a FUNCTION. `hook-decoy-text-cannot-move-a-verdict.test.mjs`
// measures the same subject at the level of a hook's decision, and the two must read the same
// shapes or "the reading is right" and "the guards consult it" drift apart again.
import { CORPUS, GENERATED, SQ } from './helpers/command-corpus.mjs';
import { hooksOutsideAWorktree } from './helpers/hooks-outside-a-worktree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LIB = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/command-scan.sh');

/**
 * The guards read a shell command to decide what it will run. Shell quoting is not a regular
 * language — nesting (`$(…)` inside quotes inside `$(…)`) needs a stack — so every masker built out
 * of linear passes is an approximation that holds until someone writes a spelling nobody tried.
 *
 * Measured over four days: `branch-guard.sh` rewritten 26 times, seven distinct instances of this
 * one class, **every one found by a person hitting a new spelling**. Twice the new spelling refused
 * the creation of the branch its own fix lived on.
 *
 * A hand-written case list cannot end that, because the next spelling is by definition not on it.
 * What can is an ORACLE, and there is one sitting right there: bash. Generate the shapes, run each
 * one for real with a recording stub on `PATH`, and ask the shell whether the verb actually ran.
 * Then require the reading to agree.
 *
 * Nothing destructive executes: `git` is a stub that records its argv and exits 0. The commands are
 * about what the SHELL does with the text, not about what git would have done.
 *
 * THE THRESHOLD IS STATED BEFORE THE READING IS BUILT, and it is not a percentage to be negotiated
 * afterwards: every disagreement must be listed in `KNOWN_OPEN` with the item that owns it, and the
 * rate must clear `MIN_AGREEMENT`. A case the reading gets wrong is a bug in the reading, not an
 * exception to add — an entry may only be added here when the shape cannot be read at all by the
 * grammar the tokenizer models, and the entry has to say why.
 */
const MIN_AGREEMENT = 0.98;

const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = makeTemp('reading-');
  scratch.push(dir);
  const bin = path.join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  const log = path.join(dir, 'calls.log');
  // A recorder, not git. It logs the SUBCOMMAND — the first argument that is not a global flag —
  // because `git -C /tmp push` invokes push just as truly as `git push` does, and a recorder that
  // logged the raw argv would call the first token `-C`. Logging the subcommand also means a verb
  // appearing inside a commit MESSAGE is never mistaken for one, which would make the oracle agree
  // with a masker that is wrong.
  const recorder = [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -C|-c|--git-dir|--work-tree|--namespace|--exec-path) shift 2 ;;',
    '    -*) shift ;;',
    `    *) printf '%s\\n' "$1" >> ${JSON.stringify(log)}; exit 0 ;;`,
    '  esac',
    'done',
    'exit 0',
    '',
  ].join('\n');
  writeFileSync(path.join(bin, 'git'), recorder);
  chmodSync(path.join(bin, 'git'), 0o755);
  return { dir, bin, log };
}

// Both readings are memoised so the summary case at the end can restate the whole corpus without
// running it a second time. Two process spawns per shape is the cost of using a real shell as the
// oracle; paying it twice would be the cost of not caching.
const ranCache = new Map();
const seenCache = new Map();

function recorderFor(log) {
  return [
    '#!/bin/sh',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -C|-c|--git-dir|--work-tree|--namespace|--exec-path) shift 2 ;;',
    '    -*) shift ;;',
    `    *) printf '%s\\n' "$1" >> ${JSON.stringify(log)}; exit 0 ;;`,
    '  esac',
    'done',
    'exit 0',
    '',
  ].join('\n');
}

/**
 * Run the corpus once and retain every git subcommand each shape actually invoked. Previously the
 * same shape started a fresh bash for push, commit, and merge independently. A subshell and a
 * distinct directory/recorder per shape preserve the old process and filesystem isolation while
 * a bounded set of parent shells amortises parsing and startup across the corpus.
 */
function runBashBatch(commands, root) {
  return new Promise((resolve, reject) => {
    const batch = [
      'exec 3<"$1"',
      "while IFS= read -r -d '' index <&3 && IFS= read -r -d '' command <&3; do",
      '  case_dir="$2/$index"',
      '  (',
      '    cd "$case_dir" || exit 1',
      '    PATH="$case_dir/bin:$3"',
      '    export PATH',
      '    eval "$command"',
      '  ) >/dev/null 2>&1',
      'done',
    ].join('\n');
    const child = spawn('bash', ['-c', batch, '_', commands, root, process.env.PATH], {
      timeout: 30_000,
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `bash oracle batch failed (${signal ?? code}): ${stderr.trim() || 'no diagnostic'}`,
          ),
        );
        return;
      }
      resolve();
    });
  });
}

async function primeBashCorpus() {
  const root = makeTemp('reading-batch-');
  scratch.push(root);

  for (const [index] of CORPUS.entries()) {
    const dir = path.join(root, String(index));
    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const git = path.join(bin, 'git');
    writeFileSync(git, recorderFor(path.join(dir, 'calls.log')));
    chmodSync(git, 0o755);
  }

  const workerCount = Math.min(8, CORPUS.length);
  const shards = Array.from({ length: workerCount }, () => []);
  for (const [index, command] of CORPUS.entries()) {
    shards[index % workerCount].push({ index, command });
  }
  await Promise.all(
    shards.map((shard, shardIndex) => {
      const commands = path.join(root, `commands-${shardIndex}.bin`);
      writeFileSync(
        commands,
        `${shard.map(({ index, command }) => `${index}\0${command}`).join('\0')}\0`,
      );
      return runBashBatch(commands, root);
    }),
  );

  for (const [index, command] of CORPUS.entries()) {
    const log = path.join(root, String(index), 'calls.log');
    const invoked = new Set(
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : [],
    );
    for (const verb of GUARDED_VERBS) {
      ranCache.set(JSON.stringify([verb, command]), invoked.has(verb));
    }
  }
}

beforeAll(async () => {
  await primeBashCorpus();
}, 45_000);

/** Did bash actually invoke `git <verb>`? The oracle — real shell semantics, no parser involved. */
function bashRuns(command, verb) {
  const key = JSON.stringify([verb, command]);
  if (ranCache.has(key)) return ranCache.get(key);
  const { dir, bin, log } = sandbox();
  spawnSync('bash', ['-c', command], {
    cwd: dir,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    encoding: 'utf8',
    timeout: 30_000,
  });
  const answer = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .some((line) => line.trim() === verb)
    : false;
  ranCache.set(key, answer);
  return answer;
}

/**
 * What the shared reading lets a guard see: does the verb survive into the scanned text?
 *
 * The command and the verb arrive as ARGUMENTS, never interpolated into the probe script. An
 * earlier version built the script by substitution, so a corpus entry containing `$(…)` was
 * EXECUTED while being measured — the measurement running the thing it was supposed to be reading.
 * One escape level is the most this can afford, and this is that level.
 */
function maskerSees(command, verb) {
  const key = JSON.stringify([verb, command]);
  if (seenCache.has(key)) return seenCache.get(key);
  const probe = [
    'source "$1"',
    'scanned=$(hook_verb_scan "$2")',
    'printf \'%s\' "$scanned" | grep -qE "(^|[;&|({\\"\'\\`]|[[:space:]])[[:space:]]*([^[:space:]]+=[^[:space:]]+[[:space:]]+)*git[[:space:]]+((-C|-c)[[:space:]]+[^[:space:]]+[[:space:]]+)*$3([^-[:alnum:]_]|$)"',
  ].join('\n');
  const result = spawnSync('bash', ['-c', probe, '_', LIB, command, verb], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  const answer = result.status === 0;
  seenCache.set(key, answer);
  return answer;
}

/**
 * Known-open disagreements, each naming the item that owns it. An exemption carries a reason and an
 * ID — an unexplained one is how a corpus becomes decorative.
 */
const ARGUMENT_POSITION =
  'INFRA-075, deliberately unmodelled — the verb is an ARGUMENT the shell never runs as a ' +
  'command. Hiding it means masking every word that is not the first of a simple command, and ' +
  'then `sudo git push`, `xargs git push`, `env git push`, `timeout 5 git push` and every other ' +
  'exec-style wrapper not on some list goes unseen. An unmodelled wrapper is a silent BYPASS; a ' +
  'mention read as a command is a refusal that announces itself. The trade is taken in the ' +
  'direction that fails loudly.';

const KNOWN_OPEN = new Map([
  ['echo git push', ARGUMENT_POSITION],
  [`eval ${SQ}echo git push${SQ}`, ARGUMENT_POSITION],
  [
    'echo \\"git push\\"',
    `${ARGUMENT_POSITION} Here the escaped quotes leave the verb as two bare words in an argument ` +
      'list, which is the same problem wearing a different spelling.',
  ],
]);

describe('the reading of a command matches what bash does with it', () => {
  it('has a corpus and an oracle', () => {
    // Fail closed: an emptied corpus or a stub that never records would make every case below pass
    // over nothing.
    expect(CORPUS.length).toBeGreaterThan(150);
    expect(GENERATED.length).toBeGreaterThan(50);
    expect(bashRuns('git push', 'push'), 'the oracle did not observe an obvious push').toBe(true);
    expect(bashRuns(`echo ${SQ}git push${SQ}`, 'push'), 'the oracle saw a push in an echo').toBe(
      false,
    );
  });

  it('pins every exemption to a shape the corpus actually contains', () => {
    // An exemption for a shape nobody tests is an exemption that can never be retired.
    for (const command of KNOWN_OPEN.keys()) {
      expect(CORPUS, `exempted shape is not in the corpus: ${JSON.stringify(command)}`).toContain(
        command,
      );
    }
  });

  for (const command of CORPUS) {
    const known = KNOWN_OPEN.get(command);
    it(`${known ? '[known-open] ' : ''}${JSON.stringify(command)}`, () => {
      const actuallyRan = bashRuns(command, 'push');
      const wasSeen = maskerSees(command, 'push');

      if (known) {
        // Pinned as a disagreement, so closing it turns this case red and the exemption gets removed
        // rather than outliving its reason.
        expect(wasSeen, `${known} — if this now agrees, delete the exemption`).not.toBe(
          actuallyRan,
        );
        return;
      }

      expect(
        wasSeen,
        actuallyRan
          ? 'bash RAN git push and the reading did not see it — a guard reading this text is blind ' +
              'to a real invocation, which is a bypass'
          : 'bash did NOT run git push and the reading saw one — a guard reading this text refuses ' +
              'correct work, which is how a guard gets disabled',
      ).toBe(actuallyRan);
    });
  }

  it(`agrees with bash on at least ${Math.round(MIN_AGREEMENT * 100)}% of the corpus`, () => {
    // The rate is a floor under the whole corpus, not a per-case verdict, so a future change cannot
    // trade a batch of new disagreements for one new exemption and still look green. Both readings
    // are memoised above, so this restates the measurement rather than repeating it.
    const disagreements = CORPUS.filter(
      (command) => bashRuns(command, 'push') !== maskerSees(command, 'push'),
    );
    const rate = (CORPUS.length - disagreements.length) / CORPUS.length;
    expect(
      rate,
      `${disagreements.length} of ${CORPUS.length} shapes disagree with bash:\n` +
        disagreements.map((c) => `  ${JSON.stringify(c)}`).join('\n'),
    ).toBeGreaterThanOrEqual(MIN_AGREEMENT);
    expect(
      disagreements.sort(),
      'every disagreement must be a listed known-open shape',
    ).toStrictEqual([...KNOWN_OPEN.keys()].sort());
  });
});

/**
 * The same corpus, run through a GUARD'S VERDICT rather than through a function (#1572, step 4).
 *
 * As it stood, this file proved the tokenizer is right and said nothing about whether the guards
 * consult it — and that is exactly the gap that let a second, weaker reading survive #1565 wired
 * into live checks. A corpus that measures a function can stay green while every decision built on
 * the other string stays as wrong as it was.
 *
 * `branch-guard.sh` on a scratch repository checked out on `main` refuses exactly three verbs —
 * `push`, `commit` and `merge` — and permits everything else, so its exit code is the answer to
 * "did this guard see one of those run". The oracle is asked the same question, verb by verb, and
 * the two answers must match for every shape. The claim the cases above make about a shell
 * function, asked of a process.
 *
 * Asking only about `push` is what the first version of this did, and four corpus shapes then
 * "disagreed" because they carry a real `git commit -m "…"` that the guard refuses on `main` for a
 * reason that is correct. A measurement whose expectation is narrower than the thing measured
 * reports the subject as broken; the fix is a complete expectation, not an exemption.
 */
const GUARDED_VERBS = ['push', 'commit', 'merge'];
describe('the guards VERDICT on the same corpus matches what bash does with it', () => {
  const hooks = hooksOutsideAWorktree();
  const repo = makeTemp('verdict-corpus-');
  const guardCache = new Map();
  scratch.push(repo);
  for (const args of [
    ['init', '-q', '--initial-branch=main'],
    ['config', 'user.email', 'harness@example.test'],
    ['config', 'user.name', 'Harness'],
    ['commit', '-q', '--allow-empty', '-m', 'chore: root'],
  ]) {
    spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  }

  function runGuardBatch(hook, payloads) {
    return new Promise((resolve, reject) => {
      const worker = [
        'exec 3<"$2"',
        "while IFS= read -r -d '' payload <&3; do",
        '  if ( source "$1" <<< "$payload" ) >/dev/null 2>&1; then',
        "    printf '0\\n'",
        '  else',
        '    printf \'%s\\n\' "$?"',
        '  fi',
        'done',
      ].join('\n');
      const child = spawn('bash', ['-c', worker, '_', hook, payloads], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: repo },
        timeout: 60_000,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        if (code !== 0) {
          reject(
            new Error(
              `guard batch failed (${signal ?? code}): ${stderr.trim() || 'no diagnostic'}`,
            ),
          );
          return;
        }
        resolve(stdout.split('\n').filter(Boolean).map(Number));
      });
    });
  }

  async function primeGuardCorpus() {
    const workerCount = Math.min(8, CORPUS.length);
    const shards = Array.from({ length: workerCount }, () => []);
    for (const [index, command] of CORPUS.entries()) {
      shards[index % workerCount].push({ index, command });
    }

    const results = await Promise.all(
      shards.map(async (shard, shardIndex) => {
        const payloads = path.join(repo, `guard-payloads-${shardIndex}.bin`);
        writeFileSync(
          payloads,
          `${shard
            .map(({ command }) =>
              JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command } }),
            )
            .join('\0')}\0`,
        );
        const statuses = await runGuardBatch(path.join(hooks, 'branch-guard.sh'), payloads);
        expect(statuses, `guard worker ${shardIndex} lost a corpus verdict`).toHaveLength(
          shard.length,
        );
        return shard.map(({ index, command }, resultIndex) => ({
          index,
          command,
          refused: statuses[resultIndex] === 2,
        }));
      }),
    );

    for (const { command, refused } of results.flat().sort((a, b) => a.index - b.index)) {
      guardCache.set(command, refused);
    }
  }

  beforeAll(async () => {
    await primeGuardCorpus();
  }, 60_000);

  function guardRefuses(command) {
    if (guardCache.has(command)) return guardCache.get(command);
    const result = spawnSync('bash', [path.join(hooks, 'branch-guard.sh')], {
      input: JSON.stringify({ tool_name: 'Bash', cwd: repo, tool_input: { command } }),
      encoding: 'utf8',
      // Scrubbed: an override reaching this from the developer's shell would silence the guard for
      // every shape at once and the whole describe would pass over nothing.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_PROJECT_DIR: repo },
      timeout: 60_000,
    });
    return result.status === 2;
  }

  it('the fixture refuses each guarded verb on main and permits ordinary work', () => {
    // Fail closed: without this the agreement below is satisfied by a guard that decides nothing.
    for (const verb of GUARDED_VERBS) {
      expect(guardRefuses(`git ${verb} something`), `bare git ${verb} on main`).toBe(true);
    }
    expect(guardRefuses('echo hello')).toBe(false);
    expect(guardRefuses('git status')).toBe(false);
  });

  it('agrees with bash on every corpus shape it is not already pinned as open on', () => {
    const disagreements = CORPUS.filter((command) => {
      if (KNOWN_OPEN.has(command)) return false;
      const ranGuarded = GUARDED_VERBS.some((verb) => bashRuns(command, verb));
      return ranGuarded !== guardRefuses(command);
    });
    expect(
      disagreements,
      `${disagreements.length} of ${CORPUS.length} shapes are DECIDED differently from what bash ` +
        'does with them. A reading that agrees with bash while the guard built on it does not is ' +
        'the defect #1572 was filed for:\n' +
        disagreements.map((c) => `  ${JSON.stringify(c)}`).join('\n'),
    ).toStrictEqual([]);
    // One hook process and three oracle runs per shape. The default 10s budget is for a case that
    // computes; this one SPAWNS, and spawning is the price of asking a real guard a real question
    // instead of asking a function what it would have said.
  }, 300_000);
});

describe('a redirection is not a statement separator', () => {
  // `2>&1` is one of the most common things in any command line, and its `&` was splitting the
  // statement in two. Every guard that reads per statement then judged a truncated fragment with an
  // unclosed `$(` in it — measured on branch-guard, where `git commit --no-verify -m "$(…2>&1)"` had
  // its real flag thrown away with the discarded prefix. Found while chasing a review finding on
  // #1588 whose stated cause was elsewhere. (INFRA-085)
  const cases = [
    { command: 'git commit -m x 2>&1', statements: 1 },
    { command: 'echo a 2>&1; echo b', statements: 2 },
    { command: 'git push origin main 2>&1', statements: 1 },
    { command: 'cmd 1>&2', statements: 1 },
    { command: 'cmd >&2', statements: 1 },
    // `&>` and `&>>` put the ampersand BEFORE the arrow. Looking only at what precedes it caught
    // `2>&1` and missed these — and bash accepts a redirection between arguments, so
    // `git commit -m "x" &> /dev/null --no-verify` really runs with the flag. (#1588 review)
    { command: 'cmd &> /dev/null', statements: 1 },
    { command: 'cmd &>> log', statements: 1 },
    { command: 'git commit -m "x" &> /dev/null --no-verify', statements: 1 },
    // A real background `&` and a real `&&` still split.
    { command: 'sleep 1 & echo done', statements: 2 },
    { command: 'a && b', statements: 2 },
    { command: 'a & b & c', statements: 3 },
    // A separator INSIDE a substitution is a separator, and the guards depend on it: the `.husky`
    // whitelist checks the LEADING verb of each command position, so `$(echo x; rm .husky/pre-push)`
    // is only refused because the `rm` starts a statement of its own. Reported as a bypass in review
    // of #1588 on the assumption that it does not split; it does. Pinned so the assumption cannot
    // quietly become true.
    { command: 'echo "$(echo x; rm .husky/pre-push)"', statements: 2 },
    { command: 'echo "$(echo x && rm -rf .husky)"', statements: 2 },
    { command: 'echo "$(echo x | rm .husky/pre-push)"', statements: 2 },
    // And with NO separator inside, it is one statement — which is why the chmod reading has to ask
    // for the substitution-INCLUDING word list rather than relying on the split.
    { command: 'echo "$(chmod -x .husky/pre-push)"', statements: 1 },
  ];

  for (const { command, statements } of cases) {
    it(`splits ${JSON.stringify(command)} into ${statements}`, () => {
      const result = spawnSync(
        'bash',
        [
          '-c',
          `source .claude/hooks/lib/command-scan.sh && hook_statement_ranges "$1"`,
          '_',
          command,
        ],
        { cwd: WORKSPACE_ROOT, encoding: 'utf8' },
      );
      const lines = (result.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
      expect(lines.length, `ranges: ${JSON.stringify(lines)}`).toBe(statements);
    });
  }
});
