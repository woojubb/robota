import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  applyLabelPlan,
  auditOpenIssues,
  classifyOpenIssues,
  collectOpenTaskCandidates,
  finalizeIssueConversion,
  planLabelReconciliation,
  readExaminedLiveLabelCount,
  readExaminedOpenIssueCount,
  resolveOpenTaskLinks,
  scanLiveLabelReconciliation,
  scanOpenIssues,
  taskMarker,
} from '../github-issue-triage.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('live GitHub label reconciliation', () => {
  it('plans declared creates and updates while preserving unexpected live labels', () => {
    const declared = [
      { name: 'bug', color: 'd73a4a', description: 'Broken behavior' },
      { name: 'priority:P0', color: 'b60205', description: 'Interrupt candidate' },
    ];
    const live = [
      { name: 'bug', color: 'ffffff', description: 'Old description' },
      { name: 'legacy', color: '000000', description: 'Historical label' },
    ];

    expect(planLabelReconciliation(declared, live)).toEqual({
      create: [declared[1]],
      update: [{ declared: declared[0], live: live[0] }],
      unexpected: [live[1]],
      delete: [],
      examined: 2,
    });
    scanLiveLabelReconciliation(declared, live);
    expect(readExaminedLiveLabelCount()).toBe(2);
    scanLiveLabelReconciliation(declared, live);
    expect(readExaminedLiveLabelCount()).toBe(2);
  });

  it('applies only declared create/update actions and never touches unexpected labels', async () => {
    const calls = [];
    await applyLabelPlan(
      {
        create: [{ name: 'priority:P0', color: 'b60205', description: 'Interrupt' }],
        update: [
          {
            declared: { name: 'bug', color: 'd73a4a', description: 'Broken' },
            live: { name: 'bug', color: 'ffffff', description: 'Old' },
          },
        ],
        unexpected: [{ name: 'legacy', color: '000000', description: 'Preserve' }],
        delete: [],
      },
      { repo: 'owner/repo', runGh: async (args) => calls.push(args) },
    );

    expect(calls).toEqual([
      [
        'label',
        'create',
        'priority:P0',
        '--repo',
        'owner/repo',
        '--color',
        'b60205',
        '--description',
        'Interrupt',
        '--force',
      ],
      [
        'label',
        'create',
        'bug',
        '--repo',
        'owner/repo',
        '--color',
        'd73a4a',
        '--description',
        'Broken',
        '--force',
      ],
    ]);
    expect(JSON.stringify(calls)).not.toContain('legacy');
  });
});

describe('read-only open-Issue audit', () => {
  it('collects every open Task citation instead of keeping the traversal-order winner', () => {
    const root = makeTemp('robota-issue-triage-');
    const directory = path.join(root, '.agents/tasks');
    mkdirSync(directory, { recursive: true });
    for (const name of ['AGREEMENT-004-parent.md', 'FLOW-008-child.md']) {
      writeFileSync(
        path.join(directory, name),
        '---\nissue: https://github.com/woojubb/robota/issues/1987\nstatus: todo\n---\n',
      );
    }

    const candidates = collectOpenTaskCandidates(root);

    expect(candidates.get(1987).map(({ taskPath }) => taskPath)).toEqual([
      '.agents/tasks/AGREEMENT-004-parent.md',
      '.agents/tasks/FLOW-008-child.md',
    ]);
  });

  it('uses the exact AGREEMENT parent marker when several Tasks cite one Issue', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const childPath = '.agents/tasks/FLOW-008-child.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: parentPath,
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: childPath,
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);

    const resolved = resolveOpenTaskLinks([issue], candidates);

    expect(resolved.links.get(1987)).toBe(parentPath);
    expect(resolved.problems).toEqual(new Map());
  });

  it('classifies the marker-owned AGREEMENT parent through the audit path', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const result = auditOpenIssues(
      [issue],
      new Map([
        [
          1987,
          [
            {
              taskPath: parentPath,
              taskText:
                '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
            },
            {
              taskPath: '.agents/tasks/FLOW-008-child.md',
              taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
            },
          ],
        ],
      ]),
    );

    expect(result.converted[0].taskPath).toBe(parentPath);
    expect(result.malformed).toEqual([]);
  });

  it('reports multiple Task citations without a parent marker as malformed', () => {
    const issue = { number: 1987, labels: [{ name: 'bug' }], comments: [] };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: '.agents/tasks/AGREEMENT-004-parent.md',
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: '.agents/tasks/FLOW-008-child.md',
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);
    const resolved = resolveOpenTaskLinks([issue], candidates);

    const result = classifyOpenIssues([issue], resolved.links, resolved.problems);

    expect(result.malformed[0].reason).toMatch(/parent marker/i);
  });

  it('rejects conflicting parent and child markers instead of choosing one', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const childPath = '.agents/tasks/FLOW-008-child.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [
        { body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) },
        { body: taskMarker({ id: 'FLOW-008', taskPath: childPath }) },
      ],
    };
    const candidates = new Map([
      [
        1987,
        [
          {
            taskPath: parentPath,
            taskText:
              '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [FLOW-008]\n---\n',
          },
          {
            taskPath: childPath,
            taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
          },
        ],
      ],
    ]);

    const resolved = resolveOpenTaskLinks([issue], candidates);

    expect(resolved.links.has(1987)).toBe(false);
    expect(resolved.problems.get(1987)).toMatch(/conflicting|one AGREEMENT parent marker/i);
  });

  it('rejects a parent marker whose declared children do not match the Issue candidates', () => {
    const parentPath = '.agents/tasks/AGREEMENT-004-parent.md';
    const issue = {
      number: 1987,
      labels: [{ name: 'bug' }],
      comments: [{ body: taskMarker({ id: 'AGREEMENT-004', taskPath: parentPath }) }],
    };
    const resolved = resolveOpenTaskLinks(
      [issue],
      new Map([
        [
          1987,
          [
            {
              taskPath: parentPath,
              taskText:
                '---\nissue: https://github.com/woojubb/robota/issues/1987\nchildren: [API-999]\n---\n',
            },
            {
              taskPath: '.agents/tasks/FLOW-008-child.md',
              taskText: '---\nissue: https://github.com/woojubb/robota/issues/1987\n---\n',
            },
          ],
        ],
      ]),
    );

    expect(resolved.links.has(1987)).toBe(false);
    expect(resolved.problems.get(1987)).toMatch(/children|candidate/i);
  });

  it('classifies every Issue exactly once without guessing missing metadata', () => {
    const issue = (number, labels) => ({
      number,
      title: `Issue ${number}`,
      labels: labels.map((name) => ({ name })),
    });
    const result = classifyOpenIssues(
      [
        issue(1, ['bug', 'status:needs-triage']),
        issue(2, ['enhancement', 'priority:P1']),
        issue(3, ['documentation']),
        issue(4, []),
      ],
      new Map([[3, '.agents/tasks/RULE-003-example.md']]),
    );

    expect(result.intake.map(({ issue: item }) => item.number)).toEqual([1]);
    expect(result.candidates.map(({ issue: item }) => item.number)).toEqual([2]);
    expect(result.converted.map(({ issue: item }) => item.number)).toEqual([3]);
    expect(result.malformed.map(({ issue: item }) => item.number)).toEqual([4]);
    expect([
      ...result.intake,
      ...result.candidates,
      ...result.converted,
      ...result.malformed,
    ]).toHaveLength(4);
    scanOpenIssues(
      [
        issue(1, ['bug', 'status:needs-triage']),
        issue(2, ['enhancement', 'priority:P1']),
        issue(3, ['documentation']),
        issue(4, []),
      ],
      new Map([[3, '.agents/tasks/RULE-003-example.md']]),
    );
    expect(readExaminedOpenIssueCount()).toBe(4);
    scanOpenIssues([issue(6, []), issue(7, [])], new Map());
    expect(readExaminedOpenIssueCount()).toBe(2);
  });
});

describe('Issue to Task conversion finalization', () => {
  it('reads back an idempotent Task marker before removing priority labels', async () => {
    const taskPath = '.agents/tasks/RULE-018-example.md';
    const taskText = `---\nissue: https://github.com/woojubb/robota/issues/18\nurgency: soon\n---\n`;
    const marker = taskMarker({ id: 'RULE-018', taskPath });
    const events = [];
    let posted = false;
    let removed = false;
    const getIssue = async () => {
      events.push('get');
      return {
        labels: removed ? [{ name: 'bug' }] : [{ name: 'bug' }, { name: 'priority:P1' }],
        comments: posted ? [{ body: marker }] : [],
      };
    };

    await finalizeIssueConversion({
      repo: 'woojubb/robota',
      issueNumber: 18,
      taskPath,
      taskText,
      getIssue,
      postComment: async (body) => {
        events.push('post');
        expect(body).toBe(marker);
        posted = true;
      },
      removeLabels: async (labels) => {
        events.push('remove');
        expect(labels).toEqual(['priority:P1']);
        removed = true;
      },
    });

    expect(events).toEqual(['get', 'post', 'get', 'remove', 'get']);
  });

  it('does not remove priority when Task-marker write-back fails', async () => {
    let removeCalled = false;
    await expect(
      finalizeIssueConversion({
        repo: 'woojubb/robota',
        issueNumber: 18,
        taskPath: '.agents/tasks/RULE-018-example.md',
        taskText: '---\nissue: https://github.com/woojubb/robota/issues/18\nurgency: now\n---\n',
        getIssue: async () => ({
          labels: [{ name: 'bug' }, { name: 'priority:P0' }],
          comments: [],
        }),
        postComment: async () => {
          throw new Error('write failed');
        },
        removeLabels: async () => {
          removeCalled = true;
        },
      }),
    ).rejects.toThrow('write failed');
    expect(removeCalled).toBe(false);
  });

  it('rejects a Task that cites the same Issue number in a different repository', async () => {
    await expect(
      finalizeIssueConversion({
        repo: 'woojubb/robota',
        issueNumber: 18,
        taskPath: '.agents/tasks/RULE-018-example.md',
        taskText:
          '---\nissue: https://github.com/different/repository/issues/18\nurgency: now\n---\n',
        getIssue: async () => ({
          labels: [{ name: 'bug' }, { name: 'priority:P0' }],
          comments: [],
        }),
        postComment: async () => {},
        removeLabels: async () => {},
      }),
    ).rejects.toThrow('Task source issue does not match');
  });
});

describe('the rule owns policy and the skill owns procedure', () => {
  it('pins the authority handoff and the commands that execute it', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const skill = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/skills/github-issue-triage/SKILL.md'),
      'utf8',
    );

    expect(rule).toContain('GitHub Issue Intake and Conversion Queue');
    expect(rule).toContain('Task `priority` and `urgency` are the sole execution authority');
    expect(rule).toContain('P2 must be promoted to P1 before conversion');
    expect(skill).toContain('github-issue-triage.mjs audit');
    expect(skill).toContain('github-issue-triage.mjs convert');
    expect(skill).toContain('github-issue-triage.mjs labels');
  });
});
