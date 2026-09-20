import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const git = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: git }));

import {
  findHistoryFindings,
  findStagedFindings,
  planningPreludeProblems,
} from '../scan-user-execution-plan-order.mjs';

const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const basename = 'AGREEMENT-901-parent.md';
const task = `.agents/tasks/${basename}`;
const draft = `.agents/spec-docs/draft/${basename}`;
const todo = `.agents/spec-docs/todo/${basename}`;
const child = '.agents/tasks/LOCAL-902-child.md';
const issue = 'https://github.com/woojubb/robota/issues/2655';
const projection = `- [ ] LOCAL-902 — todo — \`${child}\``;
const taskText = `---\nstatus: todo\nissue: ${issue}\nchildren: [LOCAL-902]\n---\n# Agreement\n\n## Children\n\n${projection}\n`;
const specText = `---\nstatus: draft\ntype: AGREEMENT\n---\n# Agreement\n\n## Tasks\n\n${projection}\n`;
const childText = `---\nstatus: todo\nissue: ${issue}\n---\n# Child\n`;
const pair = () =>
  new Map([
    [task, taskText],
    [draft, specText],
    [child, childText],
  ]);
const changed = (before, after) =>
  [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file),
  );
let identity = 0;

// Snapshots and all Git responses are memory-only. Unexpected commands never reach a subprocess.
function repository(before, versions = [], staged = null, residue = []) {
  const oid = () => (++identity).toString(16).padStart(40, '0');
  const base = oid();
  const commits = versions.map(() => oid());
  const snapshots = new Map([[base, before], ...commits.map((commit, i) => [commit, versions[i]])]);
  const head = versions.at(-1) ?? before;
  snapshots.set('HEAD', head);
  snapshots.set('', staged ?? head);
  const result = (stdout = '', status = 0) => ({ status, stdout, stderr: '' });
  const unexpected = [];
  git.mockReset();
  git.mockImplementation((command, args) => {
    const key = args.join(' ');
    if (command === 'git') {
      if (key === 'rev-parse --show-toplevel') return result(root);
      if (key === 'branch --show-current') return result('feature\n');
      if (key === 'rev-parse --verify --quiet MERGE_HEAD^{commit}') return result('', 1);
      if (key === 'rev-parse --verify --quiet origin/develop^{commit}') return result(base);
      if (key === 'merge-base HEAD origin/develop') return result(base);
      if (args[0] === 'show' && args.length === 2 && args[1].includes(':')) {
        const colon = args[1].indexOf(':');
        const snapshot = snapshots.get(args[1].slice(0, colon));
        const text = snapshot?.get(args[1].slice(colon + 1));
        return result(text ?? '', text === undefined ? 1 : 0);
      }
      if (key === 'rev-list --reverse HEAD -- .agents/rules/backlog-execution.md') return result();
      if (key === `rev-list --reverse --topo-order --parents ${base}..HEAD`) {
        return result(commits.map((commit, i) => `${commit} ${commits[i - 1] ?? base}`).join('\n'));
      }
      if (key === 'diff-index --cached --name-only -z --no-renames HEAD --') {
        return result(changed(head, staged ?? head).join('\0'));
      }
      if (key === 'diff --name-only -z --no-renames --') return result(residue.join('\0'));
      if (key === 'ls-files --others --exclude-standard -z') return result();
      if (args[0] === 'ls-files' && args[1] === '--stage' && args[2] === '--') {
        return result((staged ?? head).has(args[3]) ? `100644 ${base} 0\t${args[3]}\n` : '');
      }
      if (args[0] === 'ls-tree' && args.length === 4 && args[2] === '--') {
        return result(
          snapshots.get(args[1])?.has(args[3]) ? `100644 blob ${base}\t${args[3]}\n` : '',
        );
      }
      if (args[0] === 'diff' && args.length === 7 && args[4] && args[6] === '--') {
        const from = snapshots.get(args[4]);
        const to = snapshots.get(args[5]);
        if (from && to) return result(changed(from, to).join('\0'));
      }
    }
    unexpected.push(`${command} ${key}`);
    throw new Error(`Refused unmodelled subprocess: ${command} ${key}`);
  });
  return {
    run(mode = 'staged') {
      const findings =
        mode === 'staged'
          ? findStagedFindings(root, 'origin/develop')
          : findHistoryFindings(root, 'origin/develop');
      expect(unexpected).toEqual([]);
      expect(findings.some(({ problem }) => problem.includes('query failed'))).toBe(false);
      return findings;
    },
  };
}

describe('existing Agreement planning prelude', () => {
  it('routes an existing parent pair through ordinary planning without new children', () => {
    const before = pair();
    const after = new Map(before)
      .set(task, `${taskText}\nRevised plan.\n`)
      .set(draft, `${specText}\nRevised scope.\n`);
    expect(repository(before, [], after).run()).toEqual([]);
  });
});

const revised = () =>
  pair().set(task, `${taskText}\nRevised plan.\n`).set(draft, `${specText}\nRevised scope.\n`);
const move = (snapshot, target, status) => {
  const text = snapshot.get(draft);
  snapshot.delete(draft);
  return snapshot.set(target, text.replace('status: draft', `status: ${status}`));
};

// A real L1 transition selects the second history branch; its validators are not mocked.
function checkpoint(snapshot) {
  const next = new Map(snapshot);
  for (const folder of ['draft', 'backlog']) next.delete(`.agents/spec-docs/${folder}/${basename}`);
  next.set(
    task,
    `${taskText}\n## User Execution Test Scenarios\n\n**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`\n`,
  );
  next.set(
    todo,
    `---\nstatus: approved\nlane: L1\ntype: AGREEMENT\n---\n# Agreement\n\n## Tasks\n\n- [ ] \`${task}\`\n\n## Evidence Log\n\n### [GATE-PLAN] — ✅ PASS | 2026-09-13\n\n**Status upgrade:** draft → approved\n\n- GATE-WRITE — Task record: \`${task}\` exists.\n- GATE-WRITE — user-execution PLAN terminal outcome: Task records \`SCENARIO DRAFTED: not-applicable | 0\`.\n`,
  );
  return next;
}

function through(mode, before, after) {
  if (mode === 'staged') return repository(before, [], after).run();
  const versions = mode === 'history before checkpoint' ? [after, checkpoint(after)] : [after];
  return repository(before, versions).run('history');
}

const routes = ['staged', 'history without checkpoint', 'history before checkpoint'];
const implementEvidence = `\n## Evidence Log\n\n### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-13\n\n**Status upgrade:** approved → in-progress\n\n- Task artifact: \`${task}\` exists and maps the completion criteria.\n- Subject-bound PLAN terminal result: \`SCENARIO DRAFTED: not-applicable | 0\` is recorded with its concrete reason.\n- Whole-worktree precondition: only \`${task}\` and \`${todo}\` are present; no implementation path exists.\n`;
describe.each(routes)('existing Agreement — %s', (mode) => {
  it('resumes an already approved todo spec without recreating its parent or children', () => {
    const before = move(pair(), todo, 'approved');
    const after = new Map(before).set(todo, `${before.get(todo)}\nRevised scope.\n`);
    expect(through(mode, before, after)).toEqual([]);
  });
  it.each([
    ['pair edit', revised],
    ['spec-only edit', () => pair().set(draft, `${specText}\nRevised scope.\n`)],
    [
      'draft to backlog move',
      () => move(pair(), `.agents/spec-docs/backlog/${basename}`, 'review-ready'),
    ],
    ['draft to todo move', () => move(pair(), todo, 'approved')],
  ])('accepts %s without newly staged children', (_name, after) => {
    expect(through(mode, pair(), after())).toEqual([]);
  });

  it.each([
    [
      'extra source',
      (after) => after.set('scripts/harness/unplanned.mjs', 'export {};'),
      /non-planning/,
    ],
    [
      'unrelated Task',
      (after) => after.set('.agents/tasks/LOCAL-903-other.md', childText),
      /non-planning/,
    ],
    [
      'wrong Task status',
      (after) => after.set(task, taskText.replace('todo', 'in-progress')),
      /status/,
    ],
    [
      'wrong spec status',
      (after) => after.set(draft, specText.replace('draft', 'approved')),
      /status/,
    ],
    ['deleted Task', (after) => after.delete(task), /deletes Task/],
    ['deleted spec without destination', (after) => after.delete(draft), /deletes spec/],
    [
      'wrong-basename move',
      (after) => move(after, '.agents/spec-docs/backlog/AGREEMENT-901-other.md', 'review-ready'),
      /deletes spec/,
    ],
    [
      'malformed ledger',
      (after) => after.set('.agents/loop-runs/backlog-pipeline.jsonl', 'not JSON\n'),
      /not a pure append/,
    ],
    [
      'premature IMPLEMENT evidence',
      (after) => after.set(draft, `${specText}${implementEvidence}`),
      /GATE-IMPLEMENT PASS/,
    ],
    [
      'incomplete PLAN evidence',
      (after) =>
        after.set(
          draft,
          `${specText.replace('type: AGREEMENT', 'type: AGREEMENT\nlane: L1')}\n## Evidence Log\n\n### [GATE-PLAN] — ✅ PASS | 2026-09-13\n`,
        ),
      /GATE-PLAN PASS/,
    ],
  ])('retains generic rejection: %s', (_name, mutate, expected) => {
    const before = pair();
    const after = revised();
    mutate(after);
    expect(
      planningPreludeProblems(
        changed(before, after),
        basename,
        (file) => after.get(file) ?? null,
        (file) => before.get(file) ?? null,
      ).join('\n'),
    ).toMatch(expected);
    const findings = through(mode, before, after);
    expect(findings.length).toBeGreaterThan(0);
    const problems = findings.map(({ problem }) => problem).join('\n');
    if (_name === 'wrong-basename move') expect(problems).toMatch(/exact same basename/);
    else expect(problems).not.toMatch(/atomic AGREEMENT/);
  });

  it('rejects rewritten ledger history rather than exempting the existing pair', () => {
    const ledger = '.agents/loop-runs/backlog-pipeline.jsonl';
    const before = pair().set(ledger, '{"terminal":"converged","ref":"old"}\n');
    const after = revised().set(ledger, '{"terminal":"converged","ref":"rewritten"}\n');
    expect(through(mode, before, after).length).toBeGreaterThan(0);
  });
});

describe.each(['staged', 'history without checkpoint'])('new atomic Agreement — %s', (mode) => {
  it('accepts the complete newly added parent/child manifest', () => {
    expect(through(mode, new Map(), pair())).toEqual([]);
  });
  it.each([
    ['missing parent Task', (before, after) => after.delete(task), /exactly one parent Task/],
    ['missing parent spec', (before, after) => after.delete(draft), /exactly one parent Task/],
    [
      'mismatched parent basename',
      (before, after) => move(after, '.agents/spec-docs/draft/AGREEMENT-901-other.md', 'draft'),
      /exact same basename/,
    ],
    [
      'ordinary Task reclassified as Agreement',
      (before) => before.set(task, childText),
      /both be newly added/,
    ],
    [
      'existing parent spec',
      (before) => before.set(draft, `${specText}\nEarlier spec.\n`),
      /both be newly added/,
    ],
    ['missing child', (before, after) => after.delete(child), /exactly one staged Task/],
    [
      'existing child',
      (before) => before.set(child, `${childText}\nEarlier child.\n`),
      /must be newly added/,
    ],
    [
      'non-todo child',
      (before, after) => after.set(child, childText.replace('todo', 'in-progress')),
      /must have status `todo`/,
    ],
    [
      'nested child',
      (before, after) =>
        after.set(child, childText.replace('status: todo', 'status: todo\nchildren: [LOCAL-904]')),
      /nested AGREEMENT/,
    ],
    [
      'duplicate children',
      (before, after) => after.set(task, taskText.replace('[LOCAL-902]', '[LOCAL-902, LOCAL-902]')),
      /must be unique/,
    ],
    [
      'invalid parent issue',
      (before, after) => after.set(task, taskText.replace(issue, 'Issue 2655')),
      /concrete GitHub source issue/,
    ],
    [
      'invalid child issue',
      (before, after) => after.set(child, childText.replace(issue, 'Issue 2655')),
      /concrete GitHub source issue/,
    ],
    [
      'wrong parent status',
      (before, after) => after.set(task, taskText.replace('status: todo', 'status: done')),
      /parent Task must have status/,
    ],
    [
      'wrong spec status',
      (before, after) => after.set(draft, specText.replace('status: draft', 'status: approved')),
      /spec in draft/,
    ],
    [
      'Children projection mismatch',
      (before, after) => after.set(task, taskText.replace('- [ ]', '- [x]')),
      /Children must exactly project/,
    ],
    [
      'Tasks projection mismatch',
      (before, after) => after.set(draft, specText.replace('- [ ]', '- [x]')),
      /Tasks must exactly project/,
    ],
    [
      'extra source',
      (before, after) => after.set('scripts/harness/unplanned.mjs', 'export {};'),
      /unrelated path/,
    ],
  ])('rejects %s', (_name, mutate, expected) => {
    const before = new Map();
    const after = pair();
    mutate(before, after);
    expect(
      through(mode, before, after)
        .map(({ problem }) => problem)
        .join('\n'),
    ).toMatch(expected);
  });
});

describe('planning order remains enforced', () => {
  it('retains a valid new atomic prelude before a later checkpoint', () => {
    expect(through('history before checkpoint', new Map(), pair())).toEqual([]);
  });
  it.each(['staged', 'history'])('rejects conflicting pending unit in %s', (mode) => {
    const before = pair();
    const pending = new Map(before).set('.agents/tasks/LOCAL-903-other.md', childText);
    const after = new Map(pending).set(draft, `${specText}\nRevised scope.\n`);
    const fixture =
      mode === 'staged'
        ? repository(before, [pending], after)
        : repository(before, [pending, after]);
    expect(
      fixture
        .run(mode)
        .map(({ problem }) => problem)
        .join('\n'),
    ).toMatch(/no planning checkpoint/);
  });
  it.each(['staged', 'history'])('rejects a checkpoint for another pending unit in %s', (mode) => {
    const before = pair();
    const pending = new Map(before).set('.agents/tasks/LOCAL-903-other.md', childText);
    const after = checkpoint(pending);
    const fixture =
      mode === 'staged'
        ? repository(before, [pending], after)
        : repository(before, [pending, after]);
    expect(
      fixture
        .run(mode)
        .map(({ problem }) => problem)
        .join('\n'),
    ).toMatch(
      mode === 'staged' ? /does not match pending planning unit/ : /invalid-lifecycle path/,
    );
  });
  it('does not grant implementation authority to an accepted existing prelude', () => {
    const after = revised();
    const source = new Map(after).set('scripts/harness/unplanned.mjs', 'export {};');
    expect(
      repository(pair(), [after, source])
        .run('history')
        .map(({ problem }) => problem)
        .join('\n'),
    ).toMatch(/no planning checkpoint/);
  });
  it('rejects unstaged residue even after accepting the existing prelude', () => {
    expect(
      repository(pair(), [], revised(), ['scripts/harness/unplanned.mjs'])
        .run()
        .map(({ problem }) => problem)
        .join('\n'),
    ).toMatch(/unstaged or untracked/);
  });
});
